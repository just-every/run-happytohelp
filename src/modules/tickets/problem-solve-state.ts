import {HTTPException} from 'hono/http-exception'
import type {Actor,Env} from '../../platform/env'
import type {TicketAuthority} from './model'
import {prepareTicketChange} from './mutate-validation'
import {auditStatement} from '../audit/record'
import {resolutionState} from '../outcomes/state'
import {problemAvailableSql,type ProblemFrontier} from './problem-model'
/** Resolution happens only after confirmed channel delivery. Native field/schema
 * checks and the link/preview receipt share the resolution transaction. */
export async function solveProblemTicket(env:Env,actor:Actor,expected:ProblemFrontier,preview:any,authority:TicketAuthority,attemptId?:string){
 const {current,guard,predicates,params}=await prepareTicketChange(env,actor,expected.id,{status_id:'solved',expected_version:expected.expected_version,expected_revision:expected.expected_revision,expected_last_message_id:expected.expected_last_message_id},authority)
 if(current.status_category==='solved')return
 const receipt=attemptId?`${attemptId}:solve`:`${preview.id}:solve`,now=Math.max(Date.now(),current.updated_at+1),accepted='EXISTS(SELECT 1 FROM ticket_history WHERE id=?)'
 const condition=attemptId?"EXISTS(SELECT 1 FROM ticket_problem_attempts a JOIN ticket_problem_incidents link ON link.project_id=a.project_id AND link.incident_id=a.incident_id AND link.problem_id=a.problem_id WHERE a.id=? AND a.state='sent' AND a.message_id=c.last_message_id)":"c.id=?"
 const statements=[env.DB.prepare(`INSERT INTO ticket_history(id,project_id,conversation_id,actor_id,actor_type,source,at,changes_json) SELECT ?,c.project_id,c.id,?,'user','dashboard',?,? FROM conversations c WHERE c.project_id=? AND c.id=? AND c.ticket_version=? AND c.revision=? AND c.last_message_id IS ? AND ${problemAvailableSql()} AND EXISTS(${guard.sql}) AND ${predicates.map(p=>`(${p})`).join(' AND ')} AND EXISTS(SELECT 1 FROM ticket_problem_previews p JOIN ticket_problems problem ON problem.project_id=p.project_id AND problem.conversation_id=p.problem_id WHERE p.id=? AND p.actor_id=? AND p.state='executing' AND problem.version=p.problem_version) AND ${condition}`).bind(receipt,actor.id,now,JSON.stringify({status_id:{from:current.status_id,to:'solved'},problem_bulk:preview.id}),actor.projectId,expected.id,expected.expected_version,expected.expected_revision,expected.expected_last_message_id,...guard.params,...params,preview.id,actor.id,attemptId??preview.problem_id),
 env.DB.prepare(`INSERT OR IGNORE INTO conversation_tracking(conversation_id,project_id,initial_history_complete,cycle_history_complete,cycle_start_revision,cycle_start_at) SELECT id,project_id,0,0,revision,created_at FROM conversations WHERE id=? AND ${accepted}`).bind(expected.id,receipt),
 env.DB.prepare(`UPDATE conversations SET status_id='solved',status_category='solved',resolved_at=?,updated_at=?,ticket_actor_id=?,ticket_actor_type='user',ticket_source='dashboard' WHERE id=? AND ${accepted}`).bind(now,now,actor.id,expected.id,receipt),
 env.DB.prepare(`UPDATE ai_generations SET state='cancelled',updated_at=? WHERE project_id=? AND conversation_id=? AND state IN ('queued','running') AND ${accepted}`).bind(new Date(now).toISOString(),actor.projectId,expected.id,receipt),
 auditStatement(env.DB,{projectId:actor.projectId,category:'data',action:'ticket.problem_bulk_solved',actor:{type:'user',id:actor.id},source:'dashboard',target:{type:'conversation',id:expected.id},detail:{preview_id:preview.id,problem_id:preview.problem_id}},now,{sql:accepted,params:[receipt]}),
 ...(attemptId?[env.DB.prepare(`UPDATE ticket_problem_attempts SET state='solved',updated_at=? WHERE id=? AND state='sent' AND ${accepted}`).bind(now,attemptId,receipt)]:[])]
 if(!(await env.DB.batch(statements))[0].meta.changes)throw new HTTPException(409,{message:'Ticket, link, fields or authority changed after delivery; the incident remains open'})
 // The reviewed channel reply is this bulk action's customer notification.
 // Keep the native resolution/CSAT event without a second solved-email fan-out.
 const resolution=await resolutionState(env,actor.projectId,expected.id)
 await env.CONVERSATIONS.get(env.CONVERSATIONS.idFromName(expected.id)).fetch('https://conversation.internal/event',{method:'POST',body:JSON.stringify({type:'resolution',conversationId:expected.id,resolution})})
}
