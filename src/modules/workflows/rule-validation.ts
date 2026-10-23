import type {Env} from '../../platform/env'
import {invalid,fieldAllowed} from '../tickets/model'
import {memberAccess} from '../access/gate'
import {HTTPException} from 'hono/http-exception'
import {validateFieldValue} from '../tickets/fields'
import type {RuleDefinition} from './rule-model'
/** Reference reads and commit guards are sets. Large published definitions use the
 * same statement and binding budget as small ones, including on durable resume. */
export async function validateRuleReferences(env:Env,projectId:string,d:RuleDefinition,actorId:string){
 const access=await memberAccess(env.DB,projectId,actorId);if(!access)throw new HTTPException(403)
 const predicates:string[]=[],params:unknown[]=[],fields=new Map<string,boolean>(),tags=new Set<string>(),members=new Set<string>(),groups=new Set<string>(),statuses=new Set<string>()
 for(const c of [...d.conditions.all,...d.conditions.any])if(c.field.startsWith('field:'))fields.set(c.field.slice(6),false)
 for(const a of d.actions){switch(a.type){
  case 'status':statuses.add(a.status_id);break
  case 'assign':if(a.user_id)members.add(a.user_id);if(a.group_id)groups.add(a.group_id);break
  case 'tags':for(const id of [...a.add??[],...a.remove??[]])tags.add(id);break
  case 'fields':for(const id of Object.keys(a.values))fields.set(id,true);break
  case 'notify':if(a.recipient_id)(a.kind==='group'?groups:members).add(a.recipient_id);break
 }}
 const destinations=[...new Set(d.actions.flatMap(a=>a.type==='webhook'?[a.destination_id]:[]))]
 if(destinations.length){
  const ids=JSON.stringify(destinations),rows=(await env.DB.prepare("SELECT id,secret_ciphertext FROM native_integration_destinations WHERE project_id=? AND kind='webhook' AND enabled=1 AND id IN (SELECT value FROM json_each(?))").bind(projectId,ids).all<any>()).results
  if(rows.length!==destinations.length)invalid('Choose enabled workspace webhook destinations')
  predicates.push("NOT EXISTS(SELECT 1 FROM json_each(?) ref WHERE NOT EXISTS(SELECT 1 FROM native_integration_destinations d WHERE d.project_id=? AND d.id=json_extract(ref.value,'$[0]') AND d.secret_ciphertext=json_extract(ref.value,'$[1]') AND d.kind='webhook' AND d.enabled=1))");params.push(JSON.stringify(rows.map(row=>[row.id,row.secret_ciphertext])),projectId)
 }
 if(d.routing){if(d.routing.user_id)members.add(d.routing.user_id);for(const id of [d.routing.group_id,d.routing.overflow_group_id])if(id)groups.add(id)}
 if(fields.size){
  const rows=(await env.DB.prepare('SELECT * FROM ticket_fields WHERE project_id=? AND id IN (SELECT value FROM json_each(?))').bind(projectId,JSON.stringify([...fields.keys()])).all<any>()).results
  if(rows.length!==fields.size)invalid('Unknown workflow field')
  for(const f of rows)if(!fieldAllowed(f,access)||fields.get(f.id)&&!fieldAllowed(f,access,true))throw new HTTPException(403,{message:'Your role cannot use this workflow field'})
  const byId=new Map(rows.map(f=>[f.id,f]))
  for(const a of d.actions)if(a.type==='fields')for(const [id,value] of Object.entries(a.values))validateFieldValue(byId.get(id),value)
  predicates.push("NOT EXISTS(SELECT 1 FROM json_each(?) ref WHERE NOT EXISTS(SELECT 1 FROM ticket_fields f WHERE f.project_id=? AND f.id=json_extract(ref.value,'$[0]') AND f.updated_at=json_extract(ref.value,'$[1]')))")
  params.push(JSON.stringify(rows.map(f=>[f.id,f.updated_at])),projectId)
 }
 const requireSet=async(table:string,column:string,ids:Set<string>,message:string,extra='')=>{
  if(!ids.size)return
  const keys=JSON.stringify([...ids]),rows=await env.DB.prepare(`SELECT ${column} FROM ${table} WHERE project_id=? AND ${column} IN (SELECT value FROM json_each(?)) ${extra}`).bind(projectId,keys).all()
  if(rows.results.length!==ids.size)invalid(message)
  predicates.push(`NOT EXISTS(SELECT 1 FROM json_each(?) ref WHERE NOT EXISTS(SELECT 1 FROM ${table} WHERE project_id=? AND ${column}=ref.value ${extra}))`);params.push(keys,projectId)
 }
 await requireSet('workspace_tags','id',tags,'Unknown workspace tag')
 await requireSet('memberships','user_id',members,'Unknown workspace member')
 await requireSet('ticket_groups','id',groups,'Unknown workspace group')
 await requireSet('ticket_statuses','id',statuses,'Unknown active status','AND active=1')
 await requireSet('workflow_calendars','id',new Set(d.time?.calendar_id?[d.time.calendar_id]:[]),'Choose an active business-hours calendar','AND active=1')
 return {sql:predicates.length?predicates.join(' AND '):'1',params}
}
