import type {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import {type ApiEnv,jsonBody,requireBearer} from './http'

// Fixed native doors only. Tool arguments never select an origin, tenant,
// authorization header or arbitrary route. Native scope/write guards run again.
const object=(properties:Record<string,unknown>,required:string[]=[])=>({type:'object',properties,required,additionalProperties:false})
const string={type:'string'},id={type:'string',minLength:1,maxLength:200}
const paging={limit:{type:'integer',minimum:1,maximum:100},cursor:string}
const tools=[
 {name:'list_conversations',description:'Page conversations in the token workspace.',scope:'conversations:read',method:'GET',path:'/conversations',inputSchema:object({...paging,status:{type:'string',enum:['all','open','resolved']},updated_since:string,tag:string})},
 {name:'get_conversation',description:'Read one permitted conversation.',scope:'conversations:read',method:'GET',path:'/conversations/:id',inputSchema:object({id},['id'])},
 {name:'list_messages',description:'Read a conversation and its current reply frontier.',scope:'conversations:read',method:'GET',path:'/conversations/:id/messages',inputSchema:object({id,...paging},['id'])},
 {name:'list_contacts',description:'Page non-erased contacts.',scope:'contacts:read',method:'GET',path:'/contacts',inputSchema:object(paging)},
 {name:'list_articles',description:'Page workspace articles.',scope:'articles:read',method:'GET',path:'/articles',inputSchema:object(paging)},
 {name:'reply',description:'Send a guarded public reply. Read the frontier first; retain localId on retry. Requires explicit write scope.',scope:'messages:write',method:'POST',path:'/conversations/:id/messages',inputSchema:object({id,localId:string,content:string,expectedRevision:{type:'integer',minimum:0},expectedLastMessageId:{type:['string','null']}},['id','localId','content','expectedRevision'])},
 {name:'resolve_conversation',description:'Resolve one conversation with native authority checks.',scope:'conversations:write',method:'POST',path:'/conversations/:id/resolve',inputSchema:object({id},['id'])},
] as const
function validArguments(value:unknown,schema:ReturnType<typeof object>):value is Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))return false
 const args=value as Record<string,unknown>
 if(schema.required.some(key=>!(key in args))||Object.keys(args).some(key=>!(key in schema.properties)))return false
 for(const [key,input] of Object.entries(args)){
  const rule=schema.properties[key] as {type:string|string[];enum?:unknown[];minimum?:number;maximum?:number;minLength?:number;maxLength?:number}
  const types=Array.isArray(rule.type)?rule.type:[rule.type]
  if(!types.some(type=>type==='null'?input===null:type==='integer'?Number.isSafeInteger(input):typeof input===type))return false
  if(rule.enum&&!rule.enum.includes(input))return false
  if(typeof input==='number'&&(rule.minimum!==undefined&&input<rule.minimum||rule.maximum!==undefined&&input>rule.maximum))return false
  if(typeof input==='string'&&(input.length>(rule.maxLength??100000)||input.length<(rule.minLength??0)))return false
 }
 return true
}
export function managedTools(api:Hono<ApiEnv>){
 api.use('/mcp',async(c,next)=>{
  const origin=c.req.header('Origin')
  if(origin&&origin!==new URL(String(c.env.APP_ORIGIN||c.req.url)).origin)throw new HTTPException(403,{message:'Origin not permitted'})
  await next()
 })
 for(const method of ['get','delete'] as const)api[method]('/mcp',requireBearer(),c=>c.json({error:{code:'method_not_allowed',message:'Stateless MCP uses POST'}},405))
 api.post('/mcp',requireBearer(),async c=>{
  const body=await jsonBody(c),requestId=body.id??null
  const error=(code:number,message:string)=>c.json({jsonrpc:'2.0',id:requestId,error:{code,message}})
  if(body.jsonrpc!=='2.0'||typeof body.method!=='string'||requestId!==null&&typeof requestId!=='string'&&typeof requestId!=='number')return error(-32600,'Invalid request')
  if(body.method==='notifications/initialized'&&body.id===undefined)return c.body(null,202)
  if(body.method==='initialize'){
   if(typeof body.params?.protocolVersion!=='string')return error(-32602,'Protocol version required')
   const protocolVersion=['2025-03-26','2025-06-18'].includes(body.params.protocolVersion)?body.params.protocolVersion:'2025-06-18'
   return c.json({jsonrpc:'2.0',id:requestId,result:{protocolVersion,capabilities:{tools:{listChanged:false}},serverInfo:{name:'happytohelp',version:'1.0.0'}}})
  }
  if(body.method==='ping')return c.json({jsonrpc:'2.0',id:requestId,result:{}})
  if(body.method==='tools/list')return c.json({jsonrpc:'2.0',id:requestId,result:{tools:tools.filter(tool=>c.get('tokenScopes').includes(tool.scope)).map(({name,description,inputSchema})=>({name,description,inputSchema}))}})
  if(body.method!=='tools/call')return error(-32601,'Method not found')
  const tool=tools.find(tool=>tool.name===body.params?.name)
  if(!tool)return error(-32602,'Unknown tool')
  const args=body.params?.arguments??{}
  if(!validArguments(args,tool.inputSchema))return error(-32602,'Invalid tool arguments')
  const path=tool.path.replace(':id',encodeURIComponent(String(args.id))),input=Object.fromEntries(Object.entries(args).filter(([key])=>key!=='id'))
  const url=new URL('https://native.invalid'+path)
  if(tool.method==='GET')for(const [key,value] of Object.entries(input))url.searchParams.set(key,String(value))
  const response=await api.fetch(new Request(url,{method:tool.method,headers:{Authorization:c.req.header('Authorization')!,'Content-Type':'application/json'},...(tool.method==='POST'?{body:JSON.stringify(input)}:{})}),c.env,c.executionCtx)
  const result=await response.json()
  return c.json({jsonrpc:'2.0',id:requestId,result:{content:[{type:'text',text:JSON.stringify(result)}],isError:!response.ok}})
 })
}
