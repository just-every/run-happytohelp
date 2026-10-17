import {inboxCounts} from './inbox-counts'
import {publishActivity} from '../conversations/activity'
import {recordMessageReads} from '../conversations/reads'
import {transitionConversation} from '../outcomes/resolve'
import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {id,requiredString} from '../../platform/db'
import {dashboardAccess} from './dashboard'
import {conversationData,iso,participantData} from './dashboard-data'
import {emailConversationTranscript,recipientAddress} from './conversation-transcript'
import {requestGeneration} from '../ai-support/repository'
import {clientGenerationId} from '../ai-support/generation-id'
import {auditStatement,requestSource} from '../audit/record'
import {createNote} from '../collaboration/notes'
export const dashboardActions=new Hono<AppEnv>()
/** Assignment and resolution changes made in the dashboard, as the security log records them. */
async function recordTransition(c:any,actorId:string,before:any,body:any){
 const after=await c.env.DB.prepare('SELECT assigned_to,resolved_at FROM conversations WHERE id=?').bind(before.id).first()
 const events=[]
 if('assigned_to' in body&&after.assigned_to!==before.assigned_to)events.push({action:after.assigned_to?'conversation.assigned':'conversation.unassigned',detail:{from:before.assigned_to??null,to:after.assigned_to??null}})
 if(Boolean(after.resolved_at)!==Boolean(before.resolved_at))events.push({action:after.resolved_at?'conversation.resolved':'conversation.reopened',detail:{}})
 if(events.length)await c.env.DB.batch(events.map(event=>auditStatement(c.env.DB,{projectId:before.project_id,category:'assignment',action:event.action,actor:{type:'user',id:actorId},source:requestSource(c),target:{type:'conversation',id:before.id},detail:event.detail})))
}
const prefix='/projects/:projectId/conversations/:conversationId'
dashboardActions.put(prefix,async c=>{const {actor,conversation}=await dashboardAccess(c),b=await c.req.json();let transcriptDelivery;if('send_transcript_to' in b){transcriptDelivery=await emailConversationTranscript(c.env,conversation,actor.id,b,()=>dashboardAccess(c));await auditStatement(c.env.DB,{projectId:conversation.project_id,category:'data',action:'conversation.transcript_sent',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'conversation',id:conversation.id},detail:{state:transcriptDelivery?.state??null}}).run()}else{await transitionConversation(c.env,actor,conversation.id,b,c.get('sessionHash'));await recordTransition(c,actor.id,conversation,b)}return c.json({data:await conversationData(c.env,await c.env.DB.prepare('SELECT * FROM conversations WHERE id=?').bind(conversation.id).first(),actor.id),...(transcriptDelivery?{transcript_delivery:transcriptDelivery}:{})})})
dashboardActions.post(`${prefix}/actions`,async c=>{const {actor,conversation}=await dashboardAccess(c),b=await c.req.json(),data=b.data||b;if(b.action==='markAsRead'){const receipts=await recordMessageReads(c.env,actor,conversation,data.ids,activity=>c.executionCtx.waitUntil(activity));return c.json({read:true,receipts,counts:await inboxCounts(c.env,actor.id,data.globalInbox?undefined:actor.projectId)})}if(b.action==='assignAi'){const aiId=data.ai_id||data.aiId||null;if(aiId&&!await c.env.DB.prepare('SELECT id FROM ai_profiles WHERE id=? AND project_id=? AND is_enabled=1').bind(aiId,actor.projectId).first())throw new HTTPException(400);await transitionConversation(c.env,actor,conversation.id,{ai_id:aiId,agent_id:null},c.get('sessionHash'));return c.json({assigned:true})}if(b.action==='agentAssist')return c.json(await requestGeneration(c.env,{projectId:actor.projectId,conversationId:conversation.id,actor,expectedRevision:conversation.revision,kind:'suggestions',instruction:data.options?.instructions,options:data.options,id:data.options?.client_request_id||data.options?.request_id||data.requestId}),202);if(b.action==='request')return c.json(await requestGeneration(c.env,{projectId:actor.projectId,conversationId:conversation.id,actor,expectedRevision:conversation.revision,id:clientGenerationId(data.requestId)}),202);throw new HTTPException(400,{message:'Unknown conversation action'})})
dashboardActions.post(`${prefix}/notes`,async c=>{const {actor,conversation}=await dashboardAccess(c);const data=await createNote(c.env,actor,conversation.id,await c.req.json(),{sessionHash:c.get('sessionHash'),source:requestSource(c)});return c.json({data},201)})
dashboardActions.delete(`${prefix}/notes/:noteId`,async c=>{const {actor,conversation}=await dashboardAccess(c);const r=await c.env.DB.prepare("DELETE FROM conversation_notes WHERE id=? AND conversation_id=? AND (user_id=? OR ? IN ('owner','admin'))").bind(c.req.param('noteId'),conversation.id,actor.id,actor.role).run();if(!r.meta.changes)throw new HTTPException(404);await publishActivity(c.env,actor.projectId,conversation.id,'note');return c.json({deleted:true})})
dashboardActions.post(`${prefix}/participants`,async c=>{
 const {actor,conversation}=await dashboardAccess(c),b=await c.req.json(),email=recipientAddress(b.email)
 const matches=(await c.env.DB.prepare("SELECT * FROM contacts WHERE project_id=? AND (lower(trim(email))=? OR lower(trim(json_extract(metadata_json,'$.provided_email')))=?) AND coalesce(json_extract(metadata_json,'$.unverified_sender'),0)!=1 LIMIT 2").bind(actor.projectId,email,email).all()).results
 if(matches.length>1)throw new HTTPException(409,{message:'This address matches more than one customer. Resolve the customer identities before adding a recipient.'})
 let contact=matches[0]
 if(contact){const metadata=JSON.parse(String(contact.metadata_json||'{}'));if(metadata.is_erasing||metadata.is_erased||metadata.is_blocked)throw new HTTPException(409,{message:'This customer cannot be added as a recipient'})}
 else{const key=id();await c.env.DB.prepare('INSERT INTO contacts(id,project_id,email,created_at) VALUES(?,?,?,?)').bind(key,actor.projectId,email,Date.now()).run();contact=await c.env.DB.prepare('SELECT * FROM contacts WHERE id=? AND project_id=?').bind(key,actor.projectId).first<any>()}
 if(contact.id===conversation.contact_id)throw new HTTPException(409,{message:'This customer is already the primary recipient'})
 await dashboardAccess(c)
 await c.env.DB.prepare('INSERT OR IGNORE INTO conversation_participants(id,conversation_id,contact_id,created_at) SELECT ?,c.id,ct.id,? FROM conversations c JOIN contacts ct ON ct.project_id=c.project_id WHERE c.id=? AND c.project_id=? AND ct.id=?').bind(id(),Date.now(),conversation.id,actor.projectId,contact.id).run()
 const row=await c.env.DB.prepare('SELECT * FROM conversation_participants WHERE conversation_id=? AND contact_id=?').bind(conversation.id,contact.id).first()
 if(!row)throw new HTTPException(409,{message:'The recipient could not be added'})
 return c.json({data:participantData(contact,row)},201)
})
dashboardActions.delete(`${prefix}/participants/:participantId`,async c=>{const {conversation}=await dashboardAccess(c);const r=await c.env.DB.prepare('DELETE FROM conversation_participants WHERE id=? AND conversation_id=?').bind(c.req.param('participantId'),conversation.id).run();if(!r.meta.changes)throw new HTTPException(404);return c.json({deleted:true})})
