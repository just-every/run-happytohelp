import {HTTPException} from 'hono/http-exception'
import type {Actor,Env} from '../../platform/env'
import {auditStatement} from '../audit/record'
import type {TicketAuthority} from './model'
import {parseFrontier,problemTicket,sameFrontier,problemAvailableSql,problemError,readProblem} from './problem-model'
export async function markProblem(env:Env,actor:Actor,id:string,input:any,authority:TicketAuthority){
 const expected=parseFrontier({...input,id}),{ticket,guard}=await problemTicket(env,actor,id,authority)
 if(typeof input.is_problem!=='boolean')throw new HTTPException(400,{message:'is_problem must be true or false'})
 if(!sameFrontier(ticket,expected))throw new HTTPException(409,{message:'Ticket changed. Reload before marking it.'})
 const receipt=crypto.randomUUID(),now=Date.now(),accepted='EXISTS(SELECT 1 FROM ticket_history WHERE id=?)'
 const predicate=input.is_problem?"NOT EXISTS(SELECT 1 FROM ticket_problem_incidents WHERE project_id=c.project_id AND incident_id=c.id) AND NOT EXISTS(SELECT 1 FROM ticket_problems WHERE project_id=c.project_id AND conversation_id=c.id)":"EXISTS(SELECT 1 FROM ticket_problems WHERE project_id=c.project_id AND conversation_id=c.id) AND NOT EXISTS(SELECT 1 FROM ticket_problem_incidents WHERE project_id=c.project_id AND problem_id=c.id)"
 const statements=[env.DB.prepare(`INSERT INTO ticket_history(id,project_id,conversation_id,actor_id,actor_type,source,at,changes_json) SELECT ?,c.project_id,c.id,?,'user','dashboard',?,? FROM conversations c WHERE c.project_id=? AND c.id=? AND c.ticket_version=? AND c.revision=? AND c.last_message_id IS ? AND c.status_category<>'closed' AND ${problemAvailableSql()} AND EXISTS(${guard.sql}) AND ${predicate}`).bind(receipt,actor.id,now,JSON.stringify({is_problem:input.is_problem}),actor.projectId,id,expected.expected_version,expected.expected_revision,expected.expected_last_message_id,...guard.params),
 input.is_problem?env.DB.prepare(`INSERT INTO ticket_problems(project_id,conversation_id,created_at) SELECT ?,?,? WHERE ${accepted}`).bind(actor.projectId,id,now,receipt):env.DB.prepare(`DELETE FROM ticket_problems WHERE project_id=? AND conversation_id=? AND ${accepted}`).bind(actor.projectId,id,receipt),
 env.DB.prepare(`UPDATE conversations SET ticket_version=ticket_version+1 WHERE id=? AND ${accepted}`).bind(id,receipt),
 auditStatement(env.DB,{projectId:actor.projectId,category:'data',action:'ticket.problem_marked',actor:{type:'user',id:actor.id},source:'dashboard',target:{type:'conversation',id},detail:{is_problem:input.is_problem}},now,{sql:accepted,params:[receipt]})]
 if(!(await env.DB.batch(statements))[0].meta.changes)throw new HTTPException(409,{message:'Ticket or authority changed, or linked incidents must first be unlinked'})
 return readProblem(env,actor,id,authority)
}
export async function linkIncidents(env:Env,actor:Actor,id:string,input:any,authority:TicketAuthority,apply:boolean,suggestion?:any){
 if(!input||!['link','unlink'].includes(input.action)||!Array.isArray(input.tickets)||!input.tickets.length||input.tickets.length>100)throw new HTTPException(400,{message:'Choose link or unlink and 1–100 tickets'})
 const tickets=input.tickets.map(parseFrontier),seen=new Set<string>()
 for(const selected of tickets){if(seen.has(selected.id)||selected.id===id)throw new HTTPException(400,{message:'Select unique incident tickets different from the problem'});seen.add(selected.id)}
 const {ticket:problem}=await problemTicket(env,actor,id,authority)
 if(problem.status_category==='closed')throw new HTTPException(409,{message:'Closed problems are final'})
 const results:any[]=[]
 for(const expected of tickets){
  try{
   const {ticket,guard}=await problemTicket(env,actor,expected.id,authority)
   if(!sameFrontier(ticket,expected))throw new HTTPException(409,{message:'Incident changed. Refresh its preview.'})
   const root=await env.DB.prepare('SELECT version FROM ticket_problems WHERE project_id=? AND conversation_id=?').bind(actor.projectId,id).first<{version:number}>()
   if(suggestion&&(root?.version!==suggestion.problem_version||problem.ticket_version!==suggestion.problem_ticket_version||problem.revision!==suggestion.problem_revision||problem.last_message_id!==suggestion.problem_last_message_id))throw new HTTPException(409,{message:'Problem changed. Find suggestions again.'})
   if(!root)throw new HTTPException(409,{message:'Mark the target ticket as a problem first'})
   const linked=await env.DB.prepare('SELECT problem_id FROM ticket_problem_incidents WHERE project_id=? AND incident_id=?').bind(actor.projectId,ticket.id).first<{problem_id:string}>()
   if(input.action==='link'&&linked||input.action==='unlink'&&linked?.problem_id!==id)throw new HTTPException(409,{message:linked?'Incident already has a problem':'Incident is not linked to this problem'})
   if(await env.DB.prepare('SELECT 1 FROM ticket_problems WHERE project_id=? AND conversation_id=?').bind(actor.projectId,ticket.id).first())throw new HTTPException(409,{message:'A problem cannot also be an incident'})
   if(!apply){results.push({id:ticket.id,status:'ready',...expected});continue}
   const receipt=crypto.randomUUID(),now=Date.now(),accepted='EXISTS(SELECT 1 FROM ticket_history WHERE id=?)',change={problem_id:id,action:input.action}
   const relationship=input.action==='link'?"NOT EXISTS(SELECT 1 FROM ticket_problem_incidents WHERE project_id=c.project_id AND incident_id=c.id)":"EXISTS(SELECT 1 FROM ticket_problem_incidents WHERE project_id=c.project_id AND problem_id=? AND incident_id=c.id)"
   const statements=[env.DB.prepare(`INSERT INTO ticket_history(id,project_id,conversation_id,actor_id,actor_type,source,at,changes_json) SELECT ?,c.project_id,c.id,?,'user','dashboard',?,? FROM conversations c WHERE c.id=? AND c.project_id=? AND c.ticket_version=? AND c.revision=? AND c.last_message_id IS ? AND ${problemAvailableSql()} AND EXISTS(${guard.sql}) AND EXISTS(SELECT 1 FROM ticket_problems p JOIN conversations root ON root.id=p.conversation_id AND root.project_id=p.project_id WHERE p.project_id=c.project_id AND p.conversation_id=? AND p.version=? AND root.ticket_version=? AND root.revision=? AND root.last_message_id IS ? AND ${problemAvailableSql('root')} AND root.status_category<>'closed') AND NOT EXISTS(SELECT 1 FROM ticket_problems WHERE project_id=c.project_id AND conversation_id=c.id) AND ${relationship} ${suggestion?"AND EXISTS(SELECT 1 FROM ticket_problem_previews preview WHERE preview.id=? AND preview.actor_id=? AND preview.state='preview' AND preview.expires_at>? AND preview.problem_id=? AND preview.project_id=c.project_id)":''}`).bind(receipt,actor.id,now,JSON.stringify(change),ticket.id,actor.projectId,expected.expected_version,expected.expected_revision,expected.expected_last_message_id,...guard.params,id,root.version,problem.ticket_version,problem.revision,problem.last_message_id,...(input.action==='unlink'?[id]:[]),...(suggestion?[suggestion.id,actor.id,now,id]:[])),
    input.action==='link'?env.DB.prepare(`INSERT INTO ticket_problem_incidents(project_id,problem_id,incident_id,created_at) SELECT ?,?,?,? WHERE ${accepted}`).bind(actor.projectId,id,ticket.id,now,receipt):env.DB.prepare(`DELETE FROM ticket_problem_incidents WHERE project_id=? AND problem_id=? AND incident_id=? AND ${accepted}`).bind(actor.projectId,id,ticket.id,receipt),
    env.DB.prepare(`UPDATE conversations SET ticket_version=ticket_version+1 WHERE id=? AND ${accepted}`).bind(ticket.id,receipt),
    env.DB.prepare(`INSERT INTO ticket_history(id,project_id,conversation_id,actor_id,actor_type,source,at,changes_json) SELECT ?,?,?,?,'user','dashboard',?,? WHERE ${accepted}`).bind(`${receipt}:problem`,actor.projectId,id,actor.id,now,JSON.stringify({incident_id:ticket.id,action:input.action}),receipt),
    auditStatement(env.DB,{projectId:actor.projectId,category:'data',action:`ticket.incident_${input.action}ed`,actor:{type:'user',id:actor.id},source:'dashboard',target:{type:'conversation',id:ticket.id},detail:{problem_id:id}},now,{sql:accepted,params:[receipt]})]
   if(suggestion)statements.push(env.DB.prepare(`UPDATE ticket_problem_previews SET state='complete' WHERE id=? AND ${accepted}`).bind(suggestion.id,receipt))
   if(!(await env.DB.batch(statements))[0].meta.changes)throw new HTTPException(409,{message:'Incident, problem, link or authority changed. Refresh the preview.'})
   results.push({id:ticket.id,status:'applied',committed:true})
  }catch(error){const refused=error instanceof HTTPException&&error.status<500;results.push({id:expected.id,status:refused?'blocked':apply?'uncertain':'failed',committed:refused||!apply?false:null,reason:problemError(error)})}
 }
 return {results}
}
