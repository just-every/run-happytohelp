import {HTTPException} from 'hono/http-exception'
import type {Actor,Env} from '../../platform/env'
import {hashToken} from '../../platform/auth'
import {requireTicketScope} from '../access/ticket-scope'
import {blocker,type Continuation} from '../support-channels/outbound'
import {approved} from '../support-channels/templates'
import type {OutboundTicketInput} from './outbound-ticket-input'

/** Consent is provider-authenticated evidence, never an operator-created contact.
 * Reuse the unique (connection_id, channel_id, thread_key) thread and its customer.
 * Commands link new tickets to that thread; no second thread/customer is inserted.
 * SMS uses consented text; WhatsApp requires an approved utility template.
 */
export async function outboundChannel(env:Env,actor:Actor,input:OutboundTicketInput){
 if(input.kind!=='sms'&&input.kind!=='whatsapp')return null
 const recipient=input.kind==='sms'?input.requesterPhone!:input.requesterPhone!.slice(1),identity=await hashToken(recipient)
 const t=await env.DB.prepare(`SELECT t.*,c.provider,c.account,c.sender,c.registered,c.token_cipher,c.revoked_at,ct.metadata_json,ct.email FROM support_channel_threads t JOIN support_channel_connections c ON c.id=t.connection_id AND c.project_id=t.project_id JOIN contacts ct ON ct.id=t.contact_id AND ct.project_id=t.project_id WHERE t.project_id=? AND t.connection_id=? AND t.identity_hash=? AND c.provider=? LIMIT 1`).bind(actor.projectId,input.connectionId,identity,input.kind).first<any>()
 if(!t){
  const c=await env.DB.prepare('SELECT 1 FROM support_channel_connections WHERE id=? AND project_id=? AND provider=? AND revoked_at IS NULL AND token_cipher IS NOT NULL').bind(input.connectionId,actor.projectId,input.kind).first()
  throw new HTTPException(409,{message:c?'No recorded customer consent for this number and channel':'Channel disconnected; reconnect in Settings → Support channels'})
 }
 await requireTicketScope(env,actor.id,actor.projectId,t.conversation_id)
 if(['is_erasing','is_erased','is_deleted','is_blocked'].some(key=>JSON.parse(t.metadata_json??'{}')[key]))throw new HTTPException(409,{message:'Requester is unavailable'})
 const reason=blocker(t,Date.now(),input.kind==='whatsapp')
 if(reason)throw new HTTPException(409,{message:reason})
 const consent=await env.DB.prepare("SELECT 1 FROM support_channel_consent WHERE connection_id=? AND identity_hash=? AND channel_id=? AND contact_id=? AND kind=?").bind(t.connection_id,identity,t.channel_id,t.contact_id,input.kind==='sms'?'start':'continuation').first()
 if(!consent)throw new HTTPException(409,{message:'No recorded customer consent for this number and channel'})
 let continuation:Continuation|undefined,content=input.content
 if(input.kind==='whatsapp'){
  const template=(await approved(env,t)).find((v:any)=>v.id===input.templateId)
  if(!template)throw new HTTPException(409,{message:'Choose a currently approved utility template from this account'})
  const slots=[...template.text.matchAll(/\{\{(\d+)\}\}/g)].map((m:any)=>Number(m[1])),count=Math.max(0,...slots),parameters=input.parameters!
  if(count>10||parameters.length!==count||slots.some((n:number)=>n<1)||Array.from({length:count},(_,i)=>i+1).some(n=>!slots.includes(n)))throw new HTTPException(400,{message:'Provide each template parameter once, in order'})
  content=template.text.replace(/\{\{(\d+)\}\}/g,(_:string,n:string)=>parameters[Number(n)-1])
  continuation={name:template.name,language:{code:template.language},...(count?{components:[{type:'body',parameters:parameters.map(text=>({type:'text',text}))}]}:{})}
 }
 const sql=`EXISTS(SELECT 1 FROM support_channel_threads t JOIN support_channel_connections sc ON sc.id=t.connection_id JOIN support_channel_consent f ON f.connection_id=t.connection_id AND f.identity_hash=t.identity_hash AND f.channel_id=t.channel_id AND f.contact_id=t.contact_id WHERE t.id=? AND t.opted_out=0 AND sc.revoked_at IS NULL AND sc.token_cipher=? AND sc.registered=? AND f.kind=? ${input.kind==='whatsapp'?'AND t.template_consent=1 AND t.template_opted_out=0':'AND sc.registered=1'} AND NOT EXISTS(SELECT 1 FROM support_channel_fences WHERE connection_id=t.connection_id AND identity_hash=t.identity_hash))`
 return {thread:t,content,continuation,sql,args:[t.id,t.token_cipher,t.registered,input.kind==='sms'?'start':'continuation']}
}
