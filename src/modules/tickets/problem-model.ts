import {HTTPException} from 'hono/http-exception'
import type {Actor,Env} from '../../platform/env'
import {availableTicketSql,ticketAuthority,type TicketAuthority} from './model'
import {writableConversationSql} from '../conversation-actions/merge-read'
export interface ProblemFrontier {id:string;expected_version:number;expected_revision:number;expected_last_message_id:string|null}
export function frontier(ticket:any):ProblemFrontier{return {id:ticket.id,expected_version:ticket.ticket_version,expected_revision:ticket.revision,expected_last_message_id:ticket.last_message_id}}
export function parseFrontier(value:any):ProblemFrontier{
 if(!value||typeof value.id!=='string'||!value.id||value.id.length>160||!Number.isSafeInteger(value.expected_version)||value.expected_version<0||!Number.isSafeInteger(value.expected_revision)||value.expected_revision<0||!(value.expected_last_message_id===null||typeof value.expected_last_message_id==='string'))throw new HTTPException(400,{message:'Each ticket requires its id, expected_version, expected_revision and expected_last_message_id'})
 return value
}
export function sameFrontier(ticket:any,expected:ProblemFrontier){return ticket.id===expected.id&&ticket.ticket_version===expected.expected_version&&ticket.revision===expected.expected_revision&&ticket.last_message_id===expected.expected_last_message_id}
export const problemAvailableSql=(alias='c')=>`${availableTicketSql(alias)} AND ${writableConversationSql(alias)} AND EXISTS(SELECT 1 FROM contacts pc WHERE pc.project_id=${alias}.project_id AND pc.id=${alias}.contact_id AND coalesce(json_extract(pc.metadata_json,'$.is_blocked'),0)!=1 AND coalesce(json_extract(pc.metadata_json,'$.is_deleted'),0)!=1)`
export const problemRequesterSql=(alias='c')=>`(SELECT json_object('id',id,'name',name,'email',email,'metadata_json',metadata_json) FROM contacts WHERE project_id=${alias}.project_id AND id=${alias}.contact_id)`
export async function problemTicket(env:Env,actor:Actor,id:string,authority:TicketAuthority){
 const guard=await ticketAuthority(env,actor,authority)
 const row=await env.DB.prepare(`SELECT c.*,${problemRequesterSql()} problem_requester_json FROM conversations c WHERE c.project_id=? AND c.id=? AND ${problemAvailableSql()} AND EXISTS(${guard.sql})`).bind(actor.projectId,id,...guard.params).first<any>()
 if(!row)throw new HTTPException(404,{message:'Ticket is unavailable'})
 const {problem_requester_json,...ticket}=row
 return {ticket,guard,requester:JSON.parse(problem_requester_json)}
}
export async function readProblem(env:Env,actor:Actor,id:string,authority:TicketAuthority,offset=0){
 if(!Number.isSafeInteger(offset)||offset<0||offset>1000000)throw new HTTPException(400,{message:'Invalid incident page'})
 const {ticket}=await problemTicket(env,actor,id,authority)
 const [problem,parent,incidents,recent,engineering]=await env.DB.batch<any>([
  env.DB.prepare('SELECT version FROM ticket_problems WHERE project_id=? AND conversation_id=?').bind(actor.projectId,id),
  env.DB.prepare(`SELECT p.problem_id,c.subject,c.status_category FROM ticket_problem_incidents p JOIN conversations c ON c.id=p.problem_id AND c.project_id=p.project_id WHERE p.project_id=? AND p.incident_id=? AND ${problemAvailableSql()}`).bind(actor.projectId,id),
  env.DB.prepare(`SELECT c.id,c.subject,c.channel,c.status_category,c.ticket_version,c.revision,c.last_message_id,ct.name requester_name,ct.email requester_email FROM ticket_problem_incidents p JOIN conversations c ON c.id=p.incident_id AND c.project_id=p.project_id JOIN contacts ct ON ct.id=c.contact_id AND ct.project_id=c.project_id WHERE p.project_id=? AND p.problem_id=? AND ${problemAvailableSql()} ORDER BY p.created_at,c.id LIMIT 101 OFFSET ?`).bind(actor.projectId,id,offset),
  env.DB.prepare("SELECT id FROM ticket_problem_previews WHERE project_id=? AND problem_id=? AND actor_id=? AND json_extract(plan_json,'$.kind') IS NULL ORDER BY created_at DESC,id DESC LIMIT 1").bind(actor.projectId,id,actor.id),
  env.DB.prepare(`SELECT l.id,i.provider,i.issue_key,i.url,i.status,i.assignee,i.provider_updated_at,l.recovery,CASE WHEN connection.token_cipher IS NULL THEN 'disconnected' ELSE 'connected' END connection_state,coalesce((SELECT max(received_at) FROM escalation_deliveries d WHERE d.connection_id=i.connection_id AND d.issue_id=i.id),l.created_at) observed_at FROM escalation_links l JOIN escalation_issues i ON i.id=l.issue_id AND i.project_id=l.project_id LEFT JOIN escalation_connections connection ON connection.id=i.connection_id AND connection.project_id=l.project_id WHERE l.project_id=? AND l.conversation_id=? ORDER BY l.created_at,l.id`).bind(actor.projectId,id),
 ])
 return {engineering_issues:engineering.results.map(issue=>({...issue,stale:issue.connection_state!=='connected'})),recent_preview_id:recent.results[0]?.id??null,is_problem:!!problem.results[0],problem_version:problem.results[0]?.version??null,ticket:frontier(ticket),status_category:ticket.status_category,parent:parent.results[0]??null,incidents:incidents.results.slice(0,100),incident_count:(await env.DB.prepare('SELECT count(*) total FROM ticket_problem_incidents WHERE project_id=? AND problem_id=?').bind(actor.projectId,id).first<{total:number}>())!.total,has_more:incidents.results.length>100,incident_offset:offset}
}
export function problemError(error:unknown){return error instanceof HTTPException&&error.status<500?error.message:'Outcome could not be confirmed. Reload the ticket and delivery status before composing another reply.'}
