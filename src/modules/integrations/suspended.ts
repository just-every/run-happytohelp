import {ticketScopeSql} from '../access/ticket-scope'
import {inboundAttachmentsOverLimit} from './email-limits'
import {releaseApiHold} from '../api-integrations/holds'
import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv,Actor} from '../../platform/env'
import {scope,text} from '../management/common'
import {auditStatement,requestSource} from '../audit/record'
import {publishActivity} from '../conversations/activity'
import {emailAddress} from './inbound-routing'
import {expireSuspendedEmails,deleteSuspendedObjects} from './suspended-store'
import {receiveEmail,type IncomingEmail} from './inbound-service'
import {emailActor} from './inbound-authority'
import {memberAccess} from '../access/gate'
import {newRecoveryTicket} from './suspended-recovery'

export const suspendedRoutes=new Hono<AppEnv>()
const base='/projects/:projectId/suspended'
async function reviewScope(c:any){const actor=await scope(c);const access=await memberAccess(c.env.DB,actor.projectId,actor.id);if(!access?.permissions.has('conversations.manage'))throw new HTTPException(403,{message:'Your role cannot review suspended mail'});return {...actor,role:actor.role as Actor['role']}}
suspendedRoutes.get(base,async c=>{
 const actor=await reviewScope(c);await expireSuspendedEmails(c.env)
 const cursor=c.req.query('cursor'),after=cursor?await c.env.DB.prepare('SELECT id,created_at FROM suspended_emails WHERE id=? AND project_id=?').bind(cursor,actor.projectId).first<any>():null
 if(cursor&&!after)throw new HTTPException(400,{message:'Suspended mail cursor expired; refresh the list'})
 const rows=(await c.env.DB.prepare(`SELECT s.id,s.from_address,s.subject,s.reason,s.auth_json,c.id candidate_conversation_id,s.created_at,s.expires_at FROM suspended_emails s LEFT JOIN conversations c ON c.id=s.candidate_conversation_id AND c.project_id=s.project_id AND ${ticketScopeSql('?')} WHERE s.project_id=? AND (? IS NULL OR s.created_at<? OR s.created_at=? AND s.id>?) ORDER BY s.created_at DESC,s.id LIMIT 101`).bind(actor.id,actor.projectId,after?.id??null,after?.created_at??0,after?.created_at??0,after?.id??'').all()).results
 const data=rows.slice(0,100)
 const counts=await c.env.DB.prepare('SELECT count(*) count,min(created_at) oldest_at FROM suspended_emails WHERE project_id=?').bind(actor.projectId).first<any>()
 const reasons=(await c.env.DB.prepare('SELECT reason,count(*) count FROM suspended_emails WHERE project_id=? GROUP BY reason ORDER BY reason').bind(actor.projectId).all()).results
 return c.json({data,...counts,reasons,next_cursor:rows.length>100?data.at(-1)?.id:null})
})
suspendedRoutes.get(`${base}/:id`,async c=>{
 const actor=await reviewScope(c);await expireSuspendedEmails(c.env)
 const data=await c.env.DB.prepare(`SELECT s.*,c.id scoped_candidate_id FROM suspended_emails s LEFT JOIN conversations c ON c.id=s.candidate_conversation_id AND c.project_id=s.project_id AND ${ticketScopeSql('?')} WHERE s.project_id=? AND s.id=?`).bind(actor.id,actor.projectId,c.req.param('id')).first<any>()
 if(!data)throw new HTTPException(404)
 const {input_json,scoped_candidate_id,...visible}=data
 visible.candidate_conversation_id=scoped_candidate_id
 const attachments=(JSON.parse(input_json).attachments||[]).map((file:any,index:number)=>({index,filename:file.filename,contentType:file.contentType,size:file.size}))
 return c.json({data:{...visible,attachments}})
})
suspendedRoutes.get(`${base}/:id/attachments/:index`,async c=>{
 const actor=await reviewScope(c),row=await c.env.DB.prepare('SELECT input_json FROM suspended_emails WHERE project_id=? AND id=? AND expires_at>?').bind(actor.projectId,c.req.param('id'),Date.now()).first<{input_json:string}>()
 const index=Number(c.req.param('index')),file=row&&Number.isSafeInteger(index)&&index>=0?JSON.parse(row.input_json).attachments?.[index]:null
 if(!file)throw new HTTPException(404)
 const object=await c.env.FILES.get(file.objectKey);if(!object)throw new HTTPException(404)
 const preview=/^(text\/plain|application\/json)$/i.test(file.contentType)&&object.size<=65536?await object.text():null
 return c.json({filename:file.filename,contentType:file.contentType,size:object.size,text:preview})
})
suspendedRoutes.delete(`${base}/:id`,async c=>{
 const actor=await reviewScope(c),key=c.req.param('id')
 const row=await c.env.DB.prepare('SELECT input_json FROM suspended_emails WHERE project_id=? AND id=?').bind(actor.projectId,key).first<{input_json:string}>();if(!row)throw new HTTPException(404)
 await deleteSuspendedObjects(c.env,row)
 await c.env.DB.batch([c.env.DB.prepare("UPDATE inbound_emails SET evidence_json=json_object('reasons',json(coalesce(json_extract(evidence_json,'$.reasons'),'[]'))),state='deleted' WHERE project_id=? AND id=(SELECT receipt_id FROM suspended_emails WHERE project_id=? AND id=?)").bind(actor.projectId,actor.projectId,key),c.env.DB.prepare('DELETE FROM suspended_emails WHERE project_id=? AND id=?').bind(actor.projectId,key),auditStatement(c.env.DB,{projectId:actor.projectId,category:'integration',action:'email.suspended_deleted',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'suspended_email',id:key}})])
 return c.json({deleted:true})
})
suspendedRoutes.post('/projects/:projectId/sender-rules',async c=>{
 const actor=await scope(c,true),body=await c.req.json(),raw=typeof body.address==='string'?body.address.trim().toLowerCase():'',address=raw.startsWith('@')&&/^@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(raw)?raw:emailAddress(raw)
 if(!address||!['allow','block','remove'].includes(body.action))throw new HTTPException(400,{message:'Choose a valid sender and action'})
 await c.env.DB.batch([
  body.action==='remove'?c.env.DB.prepare('DELETE FROM email_sender_rules WHERE project_id=? AND address=?').bind(actor.projectId,address):c.env.DB.prepare('INSERT INTO email_sender_rules VALUES(?,?,?,?,?) ON CONFLICT(project_id,address) DO UPDATE SET action=excluded.action,created_by=excluded.created_by,created_at=excluded.created_at').bind(actor.projectId,address,body.action,actor.id,Date.now()),
  auditStatement(c.env.DB,{projectId:actor.projectId,category:'integration',action:`email.sender_${body.action}`,actor:{type:'user',id:actor.id},source:requestSource(c),detail:{}}),
 ])
 return c.json({updated:true})
})
suspendedRoutes.get('/projects/:projectId/sender-rules',async c=>{const actor=await scope(c,true);return c.json({data:(await c.env.DB.prepare('SELECT address,action,created_at FROM email_sender_rules WHERE project_id=? ORDER BY address').bind(actor.projectId).all()).results})})
suspendedRoutes.post(`${base}/:id/recover`,async c=>{
 const actor=await reviewScope(c),key=c.req.param('id'),body=await c.req.json()
 const row=await c.env.DB.prepare('SELECT * FROM suspended_emails WHERE project_id=? AND id=? AND expires_at>?').bind(actor.projectId,key,Date.now()).first<any>()
 if(!row)throw new HTTPException(404)
 const input=JSON.parse(row.input_json),auth=JSON.parse(row.auth_json)
 if(input.api_request)return c.json(await releaseApiHold(c.env,actor,c.get('sessionHash'),row))
 // Refuse before creating a recovery ticket or changing the receipt. A public
 // recovery cannot turn an over-limit message into a partial ticket.
 if(body.asNote!==true&&inboundAttachmentsOverLimit((input.attachments||[]).map((file:any)=>file.size)))throw new HTTPException(409,{message:'Mail exceeds the attachment limits. Retain it as a private note or request a smaller replacement.'})
 if(body.asNote!==true&&(!auth.verified||auth.failed||auth.from_unusable))throw new HTTPException(409,{message:'Sender authority is unproven. Recover as a private note after reviewing the message.'})
 const chosen=text(body.conversationId===undefined?row.candidate_conversation_id||'':body.conversationId,200)
 const conversation=chosen?await c.env.DB.prepare(`SELECT c.* FROM conversations c WHERE c.project_id=? AND c.id=? AND ${ticketScopeSql('?')}`).bind(actor.projectId,chosen,actor.id).first<any>():await newRecoveryTicket(c.env,actor,row,body.asNote===true)
 if(!conversation)throw new HTTPException(404,{message:'Choose an existing ticket in this workspace'})
 const conversationId=conversation.id
 if(body.asNote===true){
  // A human may retain a spoof for investigation, but it never speaks as the
  // customer and does not create public messages, AI work or notifications.
  await reviewScope(c)
  const noteId=`recovered-note-${key}`,committed={sql:`EXISTS(SELECT 1 FROM conversation_notes n JOIN conversations c ON c.id=n.conversation_id WHERE n.id=? AND c.project_id=? AND ${ticketScopeSql('?')})`,params:[noteId,actor.projectId,actor.id]}
  const recovered=await c.env.DB.batch([
   c.env.DB.prepare(`INSERT OR IGNORE INTO conversation_notes(id,conversation_id,user_id,content,created_at) SELECT ?,c.id,?,?,? FROM conversations c WHERE c.id=? AND c.project_id=? AND ${ticketScopeSql('?')} AND EXISTS(SELECT 1 FROM suspended_emails WHERE id=? AND project_id=c.project_id)`).bind(noteId,actor.id,`Recovered suspended email (unverified sender: ${row.from_address})\nSubject: ${row.subject}\n\n${row.text}`,Date.now(),conversationId,actor.projectId,actor.id,key),
   auditStatement(c.env.DB,{projectId:actor.projectId,category:'integration',action:'email.suspended_recovered_note',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'conversation',id:conversationId},detail:{suspendedId:key}},Date.now(),committed),
   c.env.DB.prepare(`DELETE FROM suspended_emails WHERE project_id=? AND id=? AND ${committed.sql}`).bind(actor.projectId,key,...committed.params),
  ])
  if(!recovered[2].meta.changes)throw new HTTPException(409,{message:'Ticket or authority changed; reload before recovering mail'})
  await publishActivity(c.env,actor.projectId,conversationId,'note')
  await deleteSuspendedObjects(c.env,row)
  return c.json({recovered:true,conversationId,asNote:true})
 }
 if(!auth.verified||auth.failed||auth.from_unusable||!await emailActor(c.env,actor.projectId,conversation,row.from_address,true,false))throw new HTTPException(409,{message:'Sender authority is unproven. Recover as a private note after reviewing the message.'})
 // Release only this receipt, then run ordinary admission and its transactional
 // identity checks. No review action grants future mail authority.
 const attachments=[]
 for(const file of input.attachments||[]){const object=await c.env.FILES.get(file.objectKey);if(!object)throw new HTTPException(409,{message:'Held attachment is unavailable'});attachments.push({filename:file.filename,contentType:file.contentType,content:await object.arrayBuffer()})}
 const released=await c.env.DB.prepare(`UPDATE inbound_emails SET state='failed' WHERE id=? AND project_id=? AND state='suspended' AND EXISTS(SELECT 1 FROM conversations c WHERE c.id=? AND c.project_id=inbound_emails.project_id AND ${ticketScopeSql('?')})`).bind(row.receipt_id,actor.projectId,conversationId,actor.id).run()
 if(!released.meta.changes)throw new HTTPException(409,{message:'Ticket or authority changed; reload before recovering mail'})
 const result=await receiveEmail(c.env,{...input,attachments,conversationId} as IncomingEmail,{recoveryId:key,actorId:actor.id})
 if(result.state!=='delivered')throw new HTTPException(409,{message:'Mail still requires review'})
 await c.env.DB.batch([c.env.DB.prepare('DELETE FROM suspended_emails WHERE project_id=? AND id=?').bind(actor.projectId,key),auditStatement(c.env.DB,{projectId:actor.projectId,category:'integration',action:'email.suspended_recovered',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'conversation',id:result.conversationId!},detail:{suspendedId:key}})])
 await deleteSuspendedObjects(c.env,row)
 // Recovery does not retroactively acknowledge or ask AI to answer. An operator
 // may reply normally once the recovered message is visible.
 await c.env.DB.prepare('UPDATE conversation_outbox SET delivered_at=? WHERE message_id=? AND project_id=?').bind(Date.now(),('message' in result ? result.message?.id : null),actor.projectId).run()
 return c.json({recovered:true,conversationId:result.conversationId})
})
