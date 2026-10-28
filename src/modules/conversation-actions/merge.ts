import {ticketScopeSql} from '../access/ticket-scope'
import {HTTPException} from 'hono/http-exception'
import type {Actor,Env} from '../../platform/env'
import {requiredString} from '../../platform/db'
import {getTicket,ticketAuthority,availableTicketSql,type TicketAuthority} from '../tickets/model'
import {writableConversationSql} from './merge-read'
import {publishConversationAction} from './activity'

const conflict=()=>new HTTPException(409,{message:'The tickets or your authority changed. Preview the merge again.'})
async function pair(env:Env,actor:Actor,targetId:string,input:any,authority:TicketAuthority){
 const sourceId=requiredString(input.source_id,'source_id',200)
 if(sourceId===targetId)throw new HTTPException(400,{message:'Choose a different source ticket'})
 const [source,target,guard]=await Promise.all([getTicket(env,actor,sourceId),getTicket(env,actor,targetId),ticketAuthority(env,actor,authority)])
 if(source.status_category==='closed'||target.status_category==='closed')throw new HTTPException(409,{message:'Closed tickets cannot be merged'})
 if(!Number.isSafeInteger(input.source_version)||!Number.isSafeInteger(input.target_version)||input.source_version!==source.ticket_version||input.target_version!==target.ticket_version)throw conflict()
 const busy=await env.DB.prepare('SELECT 1 FROM conversation_merges WHERE project_id=? AND undone_at IS NULL AND (source_id IN (?,?) OR target_id=?)').bind(actor.projectId,sourceId,targetId,sourceId).first()
 if(busy)throw new HTTPException(409,{message:'A merged source cannot be merged again. Undo its earlier merge first.'})
 return {source,target,guard}
}
export async function previewMerge(env:Env,actor:Actor,targetId:string,input:any,authority:TicketAuthority){
 const {source,target}=await pair(env,actor,targetId,input,authority)
 const counts=await env.DB.prepare(`SELECT c.id,c.contact_id,ct.name customer_name,ct.email customer_email,c.channel,c.status_category,c.resolved_at,(SELECT count(*) FROM messages WHERE conversation_id=c.id) messages,(SELECT count(*) FROM media WHERE conversation_id=c.id AND message_id IS NOT NULL) attachments,(SELECT count(*) FROM conversation_notes WHERE conversation_id=c.id)+(SELECT count(*) FROM move_in_notes WHERE conversation_id=c.id) private_notes FROM conversations c JOIN contacts ct ON ct.id=c.contact_id AND ct.project_id=c.project_id WHERE c.project_id=? AND c.id IN (?,?)`).bind(actor.projectId,source.id,target.id).all()
 return {source_id:source.id,target_id:target.id,source_version:source.ticket_version,target_version:target.ticket_version,tickets:counts.results,customer_identity_changes:false,customer_history_shared:false,customer_sends:0,status_changes:false,outcome_treatment:'Source and survivor retain their own resolution and SLA evidence. The source is an alias excluded from active queues and report cohorts while merged.',private_notes:'Visible only to authorized operators; no notes are forwarded.',channel_restrictions:'Replies use the surviving ticket’s original recipient and channel. Source customer history remains scoped to the source identity.'}
}
/** A receipt gates every change. No message, resolution, outbox or notification is created. */
export async function mergeConversations(env:Env,actor:Actor,targetId:string,input:any,authority:TicketAuthority){
 const {source,target,guard}=await pair(env,actor,targetId,input,authority),id=crypto.randomUUID(),now=Math.max(Date.now(),source.updated_at+1,target.updated_at+1)
 const sql=`INSERT INTO conversation_merges(id,project_id,source_id,target_id,actor_id,created_at,source_version,target_version,source_revision,target_revision)
 SELECT ?,s.project_id,s.id,t.id,?,?,s.ticket_version+1,t.ticket_version+1,s.revision,t.revision FROM conversations s JOIN conversations t ON t.project_id=s.project_id
 WHERE s.project_id=? AND s.id=? AND t.id=? AND s.ticket_version=? AND t.ticket_version=? AND s.revision=? AND t.revision=? AND s.status_category<>'closed' AND t.status_category<>'closed'
 AND ${ticketScopeSql('?','s')} AND ${ticketScopeSql('?','t')} AND ${availableTicketSql('s')} AND ${availableTicketSql('t')} AND ${writableConversationSql('s')} AND ${writableConversationSql('t')}
 AND NOT EXISTS(SELECT 1 FROM conversation_merges m WHERE m.project_id=s.project_id AND m.target_id=s.id AND m.undone_at IS NULL) AND EXISTS(${guard.sql})`
 const results=await env.DB.batch([
  env.DB.prepare(sql).bind(id,actor.id,now,actor.projectId,source.id,target.id,source.ticket_version,target.ticket_version,source.revision,target.revision,actor.id,actor.id,...guard.params),
  env.DB.prepare('UPDATE conversations SET updated_at=?,ticket_actor_id=?,ticket_actor_type=\'user\',ticket_source=\'dashboard\' WHERE project_id=? AND id IN (?,?) AND EXISTS(SELECT 1 FROM conversation_merges WHERE id=?)').bind(now,actor.id,actor.projectId,source.id,target.id,id),
  env.DB.prepare("UPDATE ai_generations SET state='cancelled',updated_at=? WHERE project_id=? AND conversation_id IN (?,?) AND state IN ('queued','running') AND EXISTS(SELECT 1 FROM conversation_merges WHERE id=?)").bind(new Date(now).toISOString(),actor.projectId,source.id,target.id,id),
 ])
 if(!results[0].meta.changes)throw conflict()
 const published=await publishConversationAction(env,actor.projectId,[source.id,target.id],'merge')
 return {id,source_id:source.id,target_id:target.id,source_version:source.ticket_version+1,target_version:target.ticket_version+1,...(!published?{refresh_error:true}:{})}
}
export async function undoMerge(env:Env,actor:Actor,targetId:string,mergeId:string,authority:TicketAuthority){
 const guard=await ticketAuthority(env,actor,authority),now=Date.now()
 const r=await env.DB.batch([
  env.DB.prepare(`UPDATE conversation_merges SET undone_at=?,undone_by=? WHERE id=? AND project_id=? AND target_id=? AND undone_at IS NULL AND EXISTS(${guard.sql})
   AND EXISTS(SELECT 1 FROM conversations c WHERE c.id=source_id AND c.project_id=conversation_merges.project_id AND c.ticket_version=source_version AND c.revision=source_revision AND ${availableTicketSql()} AND ${ticketScopeSql('?')})
   AND EXISTS(SELECT 1 FROM conversations c WHERE c.id=target_id AND c.project_id=conversation_merges.project_id AND c.ticket_version=target_version AND c.revision=target_revision AND ${availableTicketSql()} AND ${ticketScopeSql('?')})
   AND NOT EXISTS(SELECT 1 FROM partner_forwards f WHERE f.project_id=conversation_merges.project_id AND f.conversation_id IN (source_id,target_id) AND f.created_at>=conversation_merges.created_at)
   AND NOT EXISTS(SELECT 1 FROM partner_replies r WHERE r.project_id=conversation_merges.project_id AND r.conversation_id IN (source_id,target_id) AND r.created_at>=conversation_merges.created_at)`)
   .bind(now,actor.id,mergeId,actor.projectId,targetId,...guard.params,actor.id,actor.id),
  env.DB.prepare("UPDATE conversations SET updated_at=max(updated_at+1,?),ticket_actor_id=?,ticket_actor_type='user',ticket_source='dashboard' WHERE project_id=? AND id IN (SELECT source_id FROM conversation_merges WHERE id=? AND undone_at=? UNION SELECT target_id FROM conversation_merges WHERE id=? AND undone_at=?)").bind(now,actor.id,actor.projectId,mergeId,now,mergeId,now),
 ])
 if(!r[0].meta.changes)throw new HTTPException(409,{message:'Unsafe undo: a ticket has changed, a partner forward was created, the merge is no longer active, or authority was revoked. Keep the merge and review its source history.'})
 const merge=await env.DB.prepare('SELECT source_id,target_id FROM conversation_merges WHERE id=? AND project_id=?').bind(mergeId,actor.projectId).first<any>()
 const published=await publishConversationAction(env,actor.projectId,[merge.source_id,merge.target_id],'merge_undone')
 return {id:mergeId,undone:true,...(!published?{refresh_error:true}:{})}
}
