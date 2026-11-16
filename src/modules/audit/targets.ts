import {ticketScopeSql} from '../access/ticket-scope'
import {availableTicketSql} from '../tickets/model'
import type {Env} from '../../platform/env'

/** Resolve current names only within this workspace. Missing/erased targets keep a
 * human fallback; audit identifiers remain in the export and technical details. */
export async function auditTargets(env:Env,projectId:string,rows:{target_type:string|null;target_id:string|null}[],actorId:string){
 const targets=new Map<string,{name:string;href?:string}>(),base=`/projects/${encodeURIComponent(projectId)}`
 const sources:[string[],string,string,string][]=[
  [['workflow_calendars'],'workflow_calendars','name',`${base}/workflow-settings?tab=calendars`],
  [['sla_policies'],'sla_policies','name',`${base}/workflow-settings?tab=sla`],
  [['workflow'],'workflow_rules','name',`${base}/workflow-settings?tab=rules`],
  [['voice_number'],'voice_numbers','phone',`${base}/settings`],
  [['company'],'companies','name',`${base}/companies`],
  [['hold'],'audit_holds','name',''],
 ]
 for(const [types,table,column,href] of sources){
  const ids=[...new Set(rows.filter(row=>types.includes(row.target_type||'')&&row.target_id).map(row=>row.target_id!))]
  if(!ids.length)continue
  const found=(await env.DB.prepare(`SELECT id,${column} name FROM ${table} WHERE project_id=? AND id IN (SELECT value FROM json_each(?))`).bind(projectId,JSON.stringify(ids)).all<{id:string;name:string}>()).results
  for(const row of found)for(const type of types)targets.set(`${type}:${row.id}`,{name:row.name,...(href?{href}:{})})
 }
 const members=[...new Set(rows.filter(row=>['member','user'].includes(row.target_type||'')&&row.target_id).map(row=>row.target_id!))]
 if(members.length){
  const found=(await env.DB.prepare(`SELECT u.id,u.name FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.project_id=? AND u.email NOT LIKE 'erased:%' AND u.id IN (SELECT value FROM json_each(?))`).bind(projectId,JSON.stringify(members)).all<{id:string;name:string}>()).results
  for(const row of found)for(const type of ['member','user'])targets.set(`${type}:${row.id}`,{name:row.name||'Teammate',href:`${base}/settings`})
 }
 const tickets=[...new Set(rows.filter(row=>['conversation','ticket'].includes(row.target_type||'')&&row.target_id).map(row=>row.target_id!))]
 if(tickets.length){
  const found=(await env.DB.prepare(`SELECT c.id,c.subject FROM conversations c WHERE c.project_id=? AND c.id IN (SELECT value FROM json_each(?)) AND ${availableTicketSql()} AND ${ticketScopeSql('?')} AND NOT EXISTS(SELECT 1 FROM contact_erasures e WHERE e.project_id=c.project_id AND e.contact_id=c.contact_id)`).bind(projectId,JSON.stringify(tickets),actorId).all<{id:string;subject:string}>()).results
  for(const row of found)for(const type of ['conversation','ticket'])targets.set(`${type}:${row.id}`,{name:row.subject||'Support request',href:`${base}/conversations/${encodeURIComponent(row.id)}`})
 }
 return targets
}
