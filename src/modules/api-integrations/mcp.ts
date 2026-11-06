import type {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {ApiScope} from '../../platform/integration-authority'
import {authorized,bearerScopes} from './managed'
import {jsonBody,type ApiEnv} from './http'
const tool=(name:string,scope:ApiScope,method:string,path:string,properties:Record<string,unknown>={},required:string[]=[])=>({name,scope,method,path,inputSchema:{type:'object',properties,required,additionalProperties:false}})
const str={type:'string'},id={id:str}
const tools=[
 tool('list_conversations','conversations:read','GET','/conversations',{limit:{type:'integer',minimum:1,maximum:100},cursor:str,updated_since:str,tag:str}),
 tool('get_conversation','conversations:read','GET','/conversations/{id}',id,['id']),
 tool('list_messages','conversations:read','GET','/conversations/{id}/messages',id,['id']),
 tool('list_contacts','contacts:read','GET','/contacts',{limit:{type:'integer'},cursor:str,email:str}),
 tool('create_contact','contacts:write','POST','/contacts',{name:str,email:str,external_id:str}),
 tool('update_contact','contacts:write','PUT','/contacts/{id}',{...id,name:str},['id']),
 tool('list_articles','articles:read','GET','/articles',{limit:{type:'integer'},cursor:str}),
 tool('draft_article','articles:write','POST','/articles',{title:str,content:str,slug:str},['title','content']),
 tool('reply','messages:write','POST','/conversations/{id}/messages',{...id,localId:str,content:str,expectedRevision:{type:'integer'}},['id','localId','content','expectedRevision']),
 tool('resolve','conversations:write','POST','/conversations/{id}/resolve',id,['id'])
]
export function mcpApi(app:Hono<ApiEnv>){
 app.post('/mcp',async c=>{
  const b=await jsonBody(c),scopes=await bearerScopes(c)
  // Session-free HTTP MCP; cookies, native users and Help Scout keys confer no authority.
  if(b.jsonrpc!=='2.0'||typeof b.method!=='string'||!(b.id===undefined||typeof b.id==='string'||typeof b.id==='number'))throw new HTTPException(400,{message:'Invalid JSON-RPC request'})
  if(b.method==='tools/call'){
   const entry=tools.find(t=>t.name===b.params?.name)
   if(!entry)return authorized(c,scopes[0]??'conversations:read',async()=>c.json({jsonrpc:'2.0',id:b.id??null,error:{code:-32602,message:'Unknown tool'}}))
   const args=b.params?.arguments??{}
   if(!args||Array.isArray(args)||typeof args!=='object'||Object.keys(args).some(key=>!(key in entry.inputSchema.properties))||entry.inputSchema.required.some(key=>args[key]===undefined))throw new HTTPException(400)
   const path=entry.path.replace('{id}',encodeURIComponent(args.id??'')),params=new URLSearchParams(Object.entries(args).filter(([key])=>key!=='id').map(([key,value])=>[key,String(value)])),read=entry.method==='GET'
   const response=await app.fetch(new Request('https://managed.internal'+path+(read&&params.size?'?'+params:''),{method:entry.method,headers:{Authorization:c.req.header('Authorization')??'','Content-Type':'application/json'},...(read?{}:{body:JSON.stringify(Object.fromEntries(Object.entries(args).filter(([key])=>key!=='id')))})}),c.env,c.executionCtx)
   if(response.status===401||response.status===429)return response
   return c.json({jsonrpc:'2.0',id:b.id??null,result:{content:[{type:'text',text:await response.text()}],isError:!response.ok}})
  }
  return authorized(c,scopes[0]??'conversations:read',async()=>{
   if(b.method==='notifications/initialized')return c.body(null,204)
   if(b.method==='initialize')return c.json({jsonrpc:'2.0',id:b.id??null,result:{protocolVersion:'2025-03-26',capabilities:{tools:{listChanged:false}},serverInfo:{name:'HappyToHelp',version:'1.0.0'}}})
   if(b.method==='tools/list')return c.json({jsonrpc:'2.0',id:b.id??null,result:{tools:tools.filter(t=>scopes.includes(t.scope)).map(({name,inputSchema})=>({name,description:name.replaceAll('_',' '),inputSchema}))}})
   return c.json({jsonrpc:'2.0',id:b.id??null,error:{code:-32601,message:'Method not found'}})
  })
 })
}
