import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv,Env,Actor} from '../../platform/env'
import {admitMessage,messageAuthority} from '../conversations/admission'
import {stageEmailMessageOptions} from '../integrations/email-command-options'
import {messageData} from '../management/dashboard-data'
import {auditStatement,requestSource} from '../audit/record'
import {publishResolution} from '../outcomes/state'
import {access} from './access'
import {ticket} from './context'
import {text,type Action} from './model'
/** A human approves the exact customer text. The normal native admission owns frontier, privacy, channel and idempotency. */
export function confirmations(onMessage:(env:Env,message:Record<string,unknown>,actor:Actor)=>Promise<unknown>){
 const routes=new Hono<AppEnv>()
 routes.post(ticket+'/actions/:actionId/send',async c=>{
  const {actor,conversation}=await access(c,'conversations.reply'),body=await c.req.json(),content=text(body.content,'customer confirmation',2000)
  const action=await c.env.DB.prepare("SELECT * FROM business_actions WHERE id=? AND project_id=? AND conversation_id=? AND state='succeeded'").bind(c.req.param('actionId'),actor.projectId,conversation.id).first<Action>()
  if(!action||!['shopify','stripe'].includes(JSON.parse(action.preview_json).provider))throw new HTTPException(409,{message:'A provider-confirmed commerce or billing result is required'})
  const localId='business:'+action.id
  await stageEmailMessageOptions(c.env,actor,conversation,{...body,localId})
  const result=await admitMessage(c.env,{projectId:actor.projectId,conversationId:conversation.id,actor,sessionHash:c.get('sessionHash'),localId,content,expectedRevision:body.expectedRevision,expectedLastMessageId:body.expectedLastMessageId,mediaIds:[],authoring:{kind:'human'},requireAvailableRequester:true,[messageAuthority]:{sql:"EXISTS(SELECT 1 FROM business_actions a WHERE a.id=? AND a.project_id=? AND a.conversation_id=? AND a.state='succeeded')",args:[action.id,actor.projectId,conversation.id]}})
  if(!result.accepted)return c.json(result,409)
  if(!result.duplicate){await auditStatement(c.env.DB,{projectId:actor.projectId,category:'approval',action:'business.customer_confirmation_sent',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'business_action',id:action.id},detail:{messageId:result.message.id}}).run();try{await onMessage(c.env,result.message,actor)}catch{/* Native delivery state owns an uncertain channel result; never repeat admission. */}}
  await Promise.all([publishResolution(c.env,actor.projectId,conversation.id),...[conversation.id,`project:${actor.projectId}`].map(key=>c.env.CONVERSATIONS.get(c.env.CONVERSATIONS.idFromName(key)).fetch('https://conversation.internal/broadcast',{method:'POST'}))])
  return c.json({...result,dashboardMessage:await messageData(c.env,result.message)})
 })
 return routes
}
