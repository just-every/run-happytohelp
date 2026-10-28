import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv,Env} from '../../platform/env'
import {admitMessage,messageAuthority} from '../conversations/admission'
import {decryptToken} from '../integrations/secrets'
import {publishActivity} from '../conversations/activity'
import {access,prefix,thread,text,connection,liveConnection} from './model'
import {providerJson} from './network'
import {blocker,channelMessage,type Continuation} from './outbound'
async function approved(env:Env,t:any){
 const row=await connection(env,t.connection_id);if(row.provider!=='whatsapp')throw new HTTPException(400)
 const token=await decryptToken(env,row.project_id,row.token_cipher!)
 const data=await providerJson(`https://graph.facebook.com/v23.0/${encodeURIComponent(row.account)}/message_templates?fields=id,name,status,language,category,components&limit=100`,{headers:{Authorization:'Bearer '+token}})
 // Text-only utility continuations. Marketing, authentication and interactive/media headers are never repurposed.
 return (Array.isArray(data.data)?data.data:[]).filter((v:any)=>v.status==='APPROVED'&&v.category==='UTILITY'&&typeof v.id==='string'&&typeof v.name==='string'&&typeof v.language==='string'&&Array.isArray(v.components)&&v.components.length===1&&v.components[0].type==='BODY'&&typeof v.components[0].text==='string').map((v:any)=>({id:v.id,name:v.name,language:v.language,text:v.components[0].text}))
}
export const templateRoutes=new Hono<AppEnv>()
const path=prefix+'/conversations/:conversationId/templates'
templateRoutes.get(path,async c=>{const actor=await access(c,'conversations.reply'),t=await thread(c.env,actor.projectId,c.req.param('conversationId')!);if(!t)throw new HTTPException(404);return c.json({data:await approved(c.env,t)})})
templateRoutes.post(path,async c=>{
 const actor=await access(c,'conversations.reply'),id=c.req.param('conversationId')!,t=await thread(c.env,actor.projectId,id);if(!t)throw new HTTPException(404)
 const b=await c.req.json(),reason=blocker(t,Date.now(),true);if(reason)throw new HTTPException(409,{message:reason})
 const template=(await approved(c.env,t)).find((v:any)=>v.id===b.template_id);if(!template)throw new HTTPException(409,{message:'Choose a currently approved utility template from this account'})
 const slots=[...template.text.matchAll(/\{\{(\d+)\}\}/g)].map((m:any)=>Number(m[1])),count=Math.max(0,...slots),parameters=b.parameters??[]
 if(count>10||!Array.isArray(parameters)||parameters.length!==count||parameters.some((v:any)=>typeof v!=='string'||!v.trim()||v.length>500)||slots.some((n:number)=>n<1)||Array.from({length:count},(_,i)=>i+1).some(n=>!slots.includes(n)))throw new HTTPException(400,{message:'Provide each template parameter once, in order'})
 const content=template.text.replace(/\{\{(\d+)\}\}/g,(_:string,n:string)=>parameters[Number(n)-1]),localId='channel-template:'+text(b.local_id,'reply identity',120)
 const current=await connection(c.env,t.connection_id)
 const result=await admitMessage(c.env,{projectId:actor.projectId,conversationId:id,actor,sessionHash:c.get('sessionHash'),localId,content,expectedRevision:b.expected_revision,authoring:{kind:'human'},requireAvailableRequester:true,[messageAuthority]:{sql:`EXISTS(SELECT 1 FROM support_channel_threads WHERE id=? AND opted_out=0 AND template_opted_out=0 AND template_consent=1) AND EXISTS(SELECT 1 FROM support_channel_connections WHERE id=? AND token_cipher=? AND ${liveConnection})`,args:[t.id,t.connection_id,current.token_cipher]}})
 if(!result.accepted)throw new HTTPException(409,{message:'Ticket changed; reload before sending the continuation'})
 const payload:Continuation={name:template.name,language:{code:template.language},...(parameters.length?{components:[{type:'body',parameters:parameters.map((value:string)=>({type:'text',text:value}))}]}:{})}
 if(!result.duplicate)await channelMessage(c.env,result.message!,actor,payload)
 await publishActivity(c.env,actor.projectId,id,'message')
 return c.json(result)
})
