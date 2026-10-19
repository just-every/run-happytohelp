import {HTTPException} from 'hono/http-exception'
import type {Actor,Env} from '../../platform/env'
import {ticketAuthority,type TicketAuthority} from './model'
import {loadMacroContext} from '../macros/context'
import {renderPlaceholders} from '../macros/placeholders'
import {prepareTicketChange} from './mutate-validation'
import {frontier,problemTicket,problemError} from './problem-model'
import {problemDestination} from './problem-delivery'
export async function previewProblemSolve(env:Env,actor:Actor,id:string,input:any,authority:TicketAuthority){
 const {ticket:problem,guard}=await problemTicket(env,actor,id,authority)
 await ticketAuthority(env,actor,authority,'conversations.reply')
 if(typeof input?.reply!=='string'||!input.reply.trim()||input.reply.length>100000)throw new HTTPException(400,{message:'Enter a public reply of 1–100,000 characters'})
 if(input.solve_incidents!==undefined&&typeof input.solve_incidents!=='boolean')throw new HTTPException(400,{message:'solve_incidents must be a boolean'})
 const root=await env.DB.prepare('SELECT version FROM ticket_problems WHERE project_id=? AND conversation_id=?').bind(actor.projectId,id).first<{version:number}>()
 if(!root)throw new HTTPException(409,{message:'Mark this ticket as a problem first'})
 await prepareTicketChange(env,actor,id,{status_id:'solved',expected_version:problem.ticket_version},authority)
 let selected:string[]|undefined
 if(input.incident_ids!==undefined){if(!Array.isArray(input.incident_ids)||!input.incident_ids.length||input.incident_ids.length>100||input.incident_ids.some((v:any)=>typeof v!=='string'))throw new HTTPException(400,{message:'Choose 1–100 linked incident ids'});selected=[...new Set<string>(input.incident_ids)]}
 const rows=await env.DB.prepare(`SELECT c.* FROM ticket_problem_incidents link JOIN conversations c ON c.id=link.incident_id AND c.project_id=link.project_id WHERE link.project_id=? AND link.problem_id=? ${selected?'AND c.id IN (SELECT value FROM json_each(?))':''} ORDER BY link.created_at,c.id LIMIT 101`).bind(actor.projectId,id,...(selected?[JSON.stringify(selected)]:[])).all<any>()
 if(rows.results.length>100)throw new HTTPException(400,{message:'Choose up to 100 linked incidents for each reviewed batch'})
 if(selected&&rows.results.length!==selected.length)throw new HTTPException(409,{message:'Selection includes a ticket that is no longer linked'})
 const results:any[]=[]
 for(const ticket of rows.results){
  try{
   if(['solved','closed'].includes(ticket.status_category))throw new HTTPException(409,{message:'Incident is already solved or closed'})
   const {context,ticket:loaded}=await loadMacroContext(env,actor,ticket.id)
   const destination=await problemDestination(env,actor.projectId,loaded)
   if(destination.reason)throw new HTTPException(409,{message:destination.reason})
   const rendered=renderPlaceholders(input.reply,context)
   if(rendered.unresolved.length)throw new HTTPException(422,{message:`Resolve placeholders: ${rendered.unresolved.join(', ')}`})
   if(input.solve_incidents!==false)await prepareTicketChange(env,actor,ticket.id,{status_id:'solved',expected_version:loaded.ticket_version},authority)
   results.push({...frontier(loaded),subject:loaded.subject,requester_name:destination.contact_name,channel:loaded.channel,reply:rendered.text,destination,status:'ready'})
  }catch(error){results.push({...frontier(ticket),status:'blocked',reason:problemError(error)})}
 }
 const role=await env.DB.prepare('SELECT mr.role_key,pr.updated_at FROM member_roles mr LEFT JOIN project_roles pr ON pr.project_id=mr.project_id AND pr.id=mr.role_key WHERE mr.project_id=? AND mr.user_id=?').bind(actor.projectId,actor.id).first<any>()
 const plan={actor_role:actor.role,role_key:guard.access!.key,role_assignment:role?.role_key??null,role_updated_at:role?.updated_at??null,problem_version:root.version,solve_incidents:input.solve_incidents!==false,tickets:results}
 const previewId=crypto.randomUUID(),now=Date.now()
 const written=await env.DB.prepare(`INSERT INTO ticket_problem_previews(id,project_id,problem_id,actor_id,problem_version,problem_ticket_version,problem_revision,problem_last_message_id,plan_json,created_at,expires_at) SELECT ?,c.project_id,c.id,?,?,?,?,?,?,?,? FROM conversations c JOIN ticket_problems p ON p.project_id=c.project_id AND p.conversation_id=c.id WHERE c.project_id=? AND c.id=? AND c.ticket_version=? AND c.revision=? AND c.last_message_id IS ? AND p.version=? AND EXISTS(${guard.sql})`).bind(previewId,actor.id,root.version,problem.ticket_version,problem.revision,problem.last_message_id,JSON.stringify(plan),now,now+15*60*1000,actor.projectId,id,problem.ticket_version,problem.revision,problem.last_message_id,root.version,...guard.params).run()
 if(!written.meta.changes)throw new HTTPException(409,{message:'Problem changed during preview. Refresh it before sending.'})
 return {preview_id:previewId,expires_at:now+15*60*1000,problem:{...frontier(problem),problem_version:root.version},solve_incidents:plan.solve_incidents,results:results.map(({destination,...item})=>({...item,...(destination?{recipient:destination.recipient}: {})}))}
}
