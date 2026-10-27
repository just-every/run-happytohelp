import {HTTPException} from 'hono/http-exception'
import type {Actor,Env} from '../../platform/env'
import type {TicketAuthority} from './model'
import {frontier,problemTicket,problemAvailableSql} from './problem-model'
import {linkIncidents} from './problem-links'
import {auditStatement} from '../audit/record'

// A local triage hint, never a link or a reply. Match bounded, literal subject terms.
export async function suggestProblems(env:Env,actor:Actor,id:string,authority:TicketAuthority){
 const {ticket,guard}=await problemTicket(env,actor,id,authority)
 const terms=[...new Set<string>(((ticket.subject||'').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)??[]) as string[])].slice(0,8)
 if(!terms.length||['solved','closed'].includes(ticket.status_category))return {suggestions:[]}
 const rows=await env.DB.prepare(`SELECT c.id,c.subject,c.channel,c.status_category FROM conversations c JOIN ticket_problems p ON p.project_id=c.project_id AND p.conversation_id=c.id WHERE c.project_id=? AND c.id<>? AND c.status_category NOT IN ('solved','closed') AND ${problemAvailableSql()} AND EXISTS(${guard.sql}) AND NOT EXISTS(SELECT 1 FROM ticket_problem_incidents WHERE project_id=c.project_id AND incident_id=?) AND NOT EXISTS(SELECT 1 FROM ticket_problems WHERE project_id=c.project_id AND conversation_id=?) AND (${terms.map(()=>"instr(lower(c.subject),?)>0").join(' OR ')}) ORDER BY c.updated_at DESC,c.id LIMIT 100`).bind(actor.projectId,id,...guard.params,id,id,...terms).all<any>()
 const suggestions=rows.results.map(row=>({...row,matched_terms:terms.filter(term=>(row.subject||'').toLowerCase().includes(term))})).sort((a,b)=>b.matched_terms.length-a.matched_terms.length||a.id.localeCompare(b.id)).slice(0,5)
 return {suggestions}
}
export async function previewSuggestion(env:Env,actor:Actor,id:string,input:any,authority:TicketAuthority){
 const match=(await suggestProblems(env,actor,id,authority)).suggestions.find(row=>row.id===input?.problem_id)
 if(!match)throw new HTTPException(409,{message:'Suggestion is unavailable. Find suggestions again.'})
 const {ticket:incident}=await problemTicket(env,actor,id,authority),{ticket:problem,guard}=await problemTicket(env,actor,match.id,authority)
 if([incident.status_category,problem.status_category].some(status=>['solved','closed'].includes(status)))throw new HTTPException(409,{message:'Ticket changed. Find suggestions again.'})
 const root=await env.DB.prepare('SELECT version FROM ticket_problems WHERE project_id=? AND conversation_id=?').bind(actor.projectId,problem.id).first<{version:number}>()
 if(!root)throw new HTTPException(409,{message:'Problem changed. Find suggestions again.'})
 const previewId=crypto.randomUUID(),now=Date.now(),expires=now+15*60*1000
 // Reuse the existing private preview custody: erased with the requester and inert after restore.
 const plan={kind:'incident-link',tickets:[{...frontier(incident),destination:{contact_id:incident.contact_id}}]}
 await env.DB.prepare(`INSERT INTO ticket_problem_previews(id,project_id,problem_id,actor_id,problem_version,problem_ticket_version,problem_revision,problem_last_message_id,plan_json,created_at,expires_at) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(${guard.sql})`).bind(previewId,actor.projectId,problem.id,actor.id,root.version,problem.ticket_version,problem.revision,problem.last_message_id,JSON.stringify(plan),now,expires,...guard.params).run()
 return {preview_id:previewId,expires_at:expires,problem:{id:problem.id,subject:problem.subject,channel:problem.channel,status_category:problem.status_category},incident:{id,subject:incident.subject,channel:incident.channel,status_category:incident.status_category},effect:'Link this ticket as an incident. No reply will be sent.'}
}
export async function decideSuggestion(env:Env,actor:Actor,id:string,input:any,authority:TicketAuthority,confirm:boolean){
 const {guard}=await problemTicket(env,actor,id,authority)
 if(typeof input?.preview_id!=='string')throw new HTTPException(400,{message:'Preview the suggestion first'})
 const preview=await env.DB.prepare("SELECT * FROM ticket_problem_previews WHERE id=? AND project_id=? AND actor_id=? AND json_extract(plan_json,'$.kind')='incident-link' AND json_extract(plan_json,'$.tickets[0].id')=?").bind(input.preview_id,actor.projectId,actor.id,id).first<any>()
 if(!preview)throw new HTTPException(404,{message:'Suggestion preview is unavailable'})
 if(preview.state!=='preview'||preview.expires_at<=Date.now())throw new HTTPException(409,{message:'Suggestion preview expired or was already decided. Find suggestions again.'})
 if(!confirm){
  const now=Date.now(),accepted="EXISTS(SELECT 1 FROM ticket_problem_previews WHERE id=? AND state='preview' AND expires_at>?)"
  const result=await env.DB.batch([
   auditStatement(env.DB,{projectId:actor.projectId,category:'data',action:'ticket.problem_suggestion_rejected',actor:{type:'user',id:actor.id},source:'dashboard',target:{type:'conversation',id},detail:{problem_id:preview.problem_id}},now,{sql:`${accepted} AND EXISTS(${guard.sql})`,params:[preview.id,now,...guard.params]}),
   env.DB.prepare(`UPDATE ticket_problem_previews SET state='complete' WHERE id=? AND state='preview' AND expires_at>? AND EXISTS(${guard.sql})`).bind(preview.id,now,...guard.params),
  ])
  if(!result[1].meta.changes)throw new HTTPException(409,{message:'Suggestion or authority changed. Find suggestions again.'})
  return {status:'rejected'}
 }
 const result=await linkIncidents(env,actor,preview.problem_id,{action:'link',tickets:JSON.parse(preview.plan_json).tickets},authority,true,preview)
 if(result.results[0]?.status!=='applied')throw new HTTPException(409,{message:result.results[0]?.reason??'Suggestion changed. Find suggestions again.'})
 return {status:'linked',problem_id:preview.problem_id}
}
