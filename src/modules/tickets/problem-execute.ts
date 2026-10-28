import {HTTPException} from 'hono/http-exception'
import type {Actor,Env} from '../../platform/env'
import {ticketAuthority,type TicketAuthority} from './model'
import {ticketMetadataEnvironment} from './request-batch'
import {admitMessage,messageAuthority} from '../conversations/admission'
import {stageEmailMessageOptions} from '../integrations/email-command-options'
import {auditStatement} from '../audit/record'
import {problemTicket,sameFrontier,problemAvailableSql,problemError} from './problem-model'
import {problemDestination,sameDestination,problemMessageDelivery} from './problem-delivery'
import {solveProblemTicket} from './problem-solve-state'
import {rerMailHeld} from '../integrations/rer-mail-hold'
export async function problemSolveResults(env:Env,actor:Actor,id:string,previewId:string,authority:TicketAuthority){
 await problemTicket(env,actor,id,authority)
 const preview=await env.DB.prepare('SELECT id,state,plan_json FROM ticket_problem_previews WHERE id=? AND project_id=? AND problem_id=? AND actor_id=?').bind(previewId,actor.projectId,id,actor.id).first<any>()
 if(!preview||JSON.parse(preview.plan_json).kind)throw new HTTPException(404)
 const attempts=await env.DB.prepare("SELECT a.incident_id id,a.state status,a.reason,a.message_id,d.error held FROM ticket_problem_attempts a LEFT JOIN email_deliveries d ON d.id='message:'||a.message_id||':notification' AND d.state='sending' AND d.error=? WHERE a.preview_id=? ORDER BY a.created_at,a.id").bind(rerMailHeld,preview.id).all<any>()
 // A held reply is pending: replay resends it once or fails it after the hold's bound.
 const recorded=new Map(attempts.results.map(({held,...row}:any)=>[row.id,held&&row.status==='sending'?{...row,reason:held}:['claimed','ready','sending'].includes(row.status)?{...row,status:'uncertain',reason:row.reason??'This reply attempt is running or was interrupted. Check its transcript and delivery; it will not be automatically replayed.'}:row]))
 const results=JSON.parse(preview.plan_json).tickets?.map((ticket:any)=>recorded.get(ticket.id)??{id:ticket.id,status:ticket.status==='blocked'?'blocked':preview.state==='preview'?'ready':'not_attempted',reason:ticket.reason??(preview.state==='preview'?undefined:'Execution has started; this reply will not be automatically replayed')})??[]
 return {preview_id:preview.id,state:preview.state,results}
}
async function attemptIncident(env:Env,actor:Actor,preview:any,plan:any,item:any,authority:TicketAuthority){
 const attemptId=crypto.randomUUID(),localId=`problem:${attemptId}`,now=Date.now()
 // A lost response to this insert is uncertain. No other execution may reuse it.
 const inserted=await env.DB.prepare("INSERT OR IGNORE INTO ticket_problem_attempts(id,preview_id,project_id,problem_id,incident_id,local_id,state,created_at,updated_at) SELECT ?,?,?,?,?,?,'claimed',?,? WHERE EXISTS(SELECT 1 FROM ticket_problem_previews WHERE id=? AND state='executing' AND actor_id=?)").bind(attemptId,preview.id,actor.projectId,preview.problem_id,item.id,localId,now,now,preview.id,actor.id).run()
 if(!inserted.meta.changes)return
 let message:any
 try{
  const {ticket,guard,requester}=await problemTicket(env,actor,item.id,authority),replyGuard=await ticketAuthority(env,actor,authority,'conversations.reply')
  if(!sameFrontier(ticket,item))throw new HTTPException(409,{message:'Incident changed since preview; no reply sent'})
  const destination=await problemDestination(env,actor.projectId,ticket,requester)
  if(!sameDestination(item.destination,destination))throw new HTTPException(409,{message:'Requester, channel or consent changed since preview; no reply sent'})
  if(ticket.channel==='email')await stageEmailMessageOptions(env,actor,ticket,{localId,cc:[],bcc:[],...(ticket.mailbox_id?{mailboxId:ticket.mailbox_id}:{})})
  const condition=`EXISTS(SELECT 1 FROM conversations c WHERE c.id=? AND c.project_id=? AND EXISTS(${guard.sql}) AND EXISTS(${replyGuard.sql}) AND (c.ticket_version=? OR c.ticket_version=? AND EXISTS(SELECT 1 FROM messages own WHERE own.conversation_id=c.id AND own.project_id=c.project_id AND own.local_id=? AND own.id=c.last_message_id)) AND c.channel=? AND c.mailbox_id IS ? AND ${problemAvailableSql()} AND EXISTS(SELECT 1 FROM contacts frozen WHERE frozen.project_id=c.project_id AND frozen.id=c.contact_id AND frozen.id=? AND frozen.name IS ? AND frozen.email IS ? AND frozen.metadata_json=?) AND EXISTS(SELECT 1 FROM ticket_problem_attempts a JOIN ticket_problem_previews p ON p.id=a.preview_id JOIN ticket_problems problem ON problem.project_id=p.project_id AND problem.conversation_id=p.problem_id JOIN conversations root ON root.id=p.problem_id AND root.project_id=p.project_id JOIN ticket_problem_incidents link ON link.project_id=a.project_id AND link.incident_id=a.incident_id AND link.problem_id=a.problem_id WHERE a.id=? AND a.state='claimed' AND p.state='executing' AND p.actor_id=? AND p.problem_version=problem.version AND root.ticket_version=p.problem_ticket_version AND root.revision=p.problem_revision AND root.last_message_id IS p.problem_last_message_id AND ${problemAvailableSql('root')}))`
  const admitted=await admitMessage(env,{projectId:actor.projectId,conversationId:item.id,actor,localId,content:item.reply,expectedRevision:item.expected_revision,expectedLastMessageId:item.expected_last_message_id,requireAvailableRequester:true,sessionHash:authority.sessionHash,[messageAuthority]:{sql:condition,args:[item.id,actor.projectId,...guard.params,...replyGuard.params,item.expected_version,item.expected_version+1,localId,destination.channel,destination.mailbox_id,destination.contact_id,destination.contact_name,destination.contact_email,destination.metadata_json,attemptId,actor.id]}})
  if(!admitted.accepted)throw new HTTPException(409,{message:`Reply refused: ${admitted.reason??'ticket changed'}`})
  message=admitted.message
  const accepted="EXISTS(SELECT 1 FROM ticket_problem_attempts WHERE id=? AND message_id=? AND state='ready')"
  await env.DB.batch([
   env.DB.prepare("UPDATE ticket_problem_attempts SET message_id=?,state='ready',updated_at=? WHERE id=? AND state='claimed'").bind(message.id,Date.now(),attemptId),
   env.DB.prepare(`INSERT INTO ticket_history(id,project_id,conversation_id,actor_id,actor_type,source,at,changes_json) SELECT ?,?,?,?,'user','dashboard',?,? WHERE ${accepted}`).bind(attemptId,actor.projectId,item.id,actor.id,Date.now(),JSON.stringify({problem_reply:{problem_id:preview.problem_id,preview_id:preview.id,message_id:message.id}}),attemptId,message.id),
   auditStatement(env.DB,{projectId:actor.projectId,category:'data',action:'ticket.problem_reply_admitted',actor:{type:'user',id:actor.id},source:'dashboard',target:{type:'conversation',id:item.id},detail:{problem_id:preview.problem_id,preview_id:preview.id,message_id:message.id}},Date.now(),{sql:accepted,params:[attemptId,message.id]}),
  ])
  const delivery=await problemMessageDelivery(env,message,actor)
  if(delivery?.state!=='sent')return
  if(plan.solve_incidents){await solveProblemTicket(env,actor,{id:item.id,expected_version:item.expected_version+1,expected_revision:item.expected_revision+1,expected_last_message_id:message.id},preview,authority,attemptId)}
  else await env.DB.prepare("UPDATE ticket_problem_attempts SET state='updated',updated_at=? WHERE id=? AND state='sent'").bind(Date.now(),attemptId).run()
 }catch(error){
  const knownRefusal=!message&&error instanceof HTTPException&&error.status<500
  await env.DB.prepare("UPDATE ticket_problem_attempts SET state=CASE WHEN state='claimed' AND ? THEN 'blocked' WHEN state IN ('claimed','ready','sending') THEN 'uncertain' ELSE state END,reason=?,updated_at=? WHERE id=? AND state NOT IN ('solved','updated','erased')").bind(knownRefusal?1:0,message?`Reply saved. ${problemError(error)}`:problemError(error),Date.now(),attemptId).run()
 }finally{
  if(message){try{await Promise.all([item.id,`project:${actor.projectId}`].map(key=>env.CONVERSATIONS.get(env.CONVERSATIONS.idFromName(key)).fetch('https://conversation.internal/broadcast',{method:'POST'})))}catch{/* Native outbox retains the committed widget reply for reconnect. */}}
 }
}
export async function executeProblemSolve(env:Env,actor:Actor,id:string,previewId:string,authority:TicketAuthority){
 env=ticketMetadataEnvironment(env)
 if(typeof previewId!=='string'||!previewId||previewId.length>160)throw new HTTPException(400,{message:'preview_id is required'})
 const {guard}=await problemTicket(env,actor,id,authority)
 const replyGuard=await ticketAuthority(env,actor,authority,'conversations.reply')
 const preview=await env.DB.prepare('SELECT * FROM ticket_problem_previews WHERE id=? AND project_id=? AND problem_id=? AND actor_id=?').bind(previewId,actor.projectId,id,actor.id).first<any>()
 if(!preview||JSON.parse(preview.plan_json).kind)throw new HTTPException(404)
 if(preview.state!=='preview')return problemSolveResults(env,actor,id,previewId,authority)
 const plan=JSON.parse(preview.plan_json)
 const claimed=await env.DB.prepare(`UPDATE ticket_problem_previews SET state='executing' WHERE id=? AND state='preview' AND expires_at>? AND EXISTS(SELECT 1 FROM conversations c JOIN ticket_problems p ON p.project_id=c.project_id AND p.conversation_id=c.id WHERE c.id=ticket_problem_previews.problem_id AND c.project_id=ticket_problem_previews.project_id AND p.version=ticket_problem_previews.problem_version AND c.ticket_version=ticket_problem_previews.problem_ticket_version AND c.revision=ticket_problem_previews.problem_revision AND c.last_message_id IS ticket_problem_previews.problem_last_message_id AND ${problemAvailableSql()} AND EXISTS(${guard.sql}) AND EXISTS(${replyGuard.sql})) AND (SELECT role_key FROM member_roles WHERE project_id=ticket_problem_previews.project_id AND user_id=ticket_problem_previews.actor_id) IS ? AND (SELECT pr.updated_at FROM member_roles mr JOIN project_roles pr ON pr.project_id=mr.project_id AND pr.id=mr.role_key WHERE mr.project_id=ticket_problem_previews.project_id AND mr.user_id=ticket_problem_previews.actor_id) IS ?`).bind(previewId,Date.now(),...guard.params,...replyGuard.params,plan.role_assignment,plan.role_updated_at).run()
 if(!claimed.meta.changes)throw new HTTPException(409,{message:'Preview expired or the problem, links or authority changed. Review a new preview.'})
 // Sequential network effects keep each result independently attributable. Every
 // iteration rechecks current authority; a revoked sender cannot finish a batch.
 for(const item of plan.tickets)if(item.status==='ready')await attemptIncident(env,actor,preview,plan,item,authority)
 let problem:any
 try{
  await solveProblemTicket(env,actor,{id,expected_version:preview.problem_ticket_version,expected_revision:preview.problem_revision,expected_last_message_id:preview.problem_last_message_id},preview,authority)
  problem={id,status:'solved'}
 }catch(error){problem={id,status:'blocked',reason:problemError(error)}}
 await env.DB.prepare("UPDATE ticket_problem_previews SET state='complete' WHERE id=? AND state='executing'").bind(previewId).run()
 return {...await problemSolveResults(env,actor,id,previewId,authority),problem}
}
