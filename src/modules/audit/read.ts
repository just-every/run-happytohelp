import type {Env} from '../../platform/env'

export interface AuditFilter {category?:string;actorId?:string;since?:number;until?:number;before?:{at:number;id:string};limit:number}
export interface AuditRow {id:string;at:number;category:string;action:string;outcome:string;actor_type:string;actor_id:string|null;source:string;target_type:string|null;target_id:string|null;purpose:string|null;detail_json:string}

/**
 * The workspace's security log: audit_events, plus the records older modules keep
 * themselves (integration changes and approvals, erasure tombstones from before the
 * log existed). Each event appears once.
 */
const events=`SELECT id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,purpose,CASE WHEN action='credential.denied' THEN json_set(detail_json,'$.count',coalesce((SELECT count FROM api_denial_counts d WHERE d.project_id=audit_events.project_id AND d.token_id=audit_events.target_id AND d.window=CAST(audit_events.at/60000 AS INTEGER)),json_extract(detail_json,'$.count'))) ELSE detail_json END detail_json FROM audit_events WHERE project_id=?1
UNION ALL SELECT id,created_at,'integration',action,'succeeded','user',actor_id,'dashboard','integration',resource_id,NULL,'{}' FROM native_integration_audit WHERE project_id=?1
UNION ALL SELECT 'erasure:'||contact_id,last_erased_at,'erasure','contact.erased','succeeded','user',erased_by,'dashboard','contact',contact_id,NULL,json_object('runs',runs,'conversations',conversations,'messages',messages,'attachments',attachments) FROM contact_erasures e WHERE project_id=?1
 AND NOT EXISTS(SELECT 1 FROM audit_events a WHERE a.project_id=e.project_id AND a.action='contact.erased' AND a.target_id=e.contact_id)`

export async function auditPage(env:Env,projectId:string,filter:AuditFilter){
 const where:string[]=[],args:unknown[]=[projectId]
 const arg=(value:unknown)=>{args.push(value);return `?${args.length}`}
 if(filter.category)where.push(`category=${arg(filter.category)}`)
 if(filter.actorId)where.push(`actor_id=${arg(filter.actorId)}`)
 if(filter.since!==undefined)where.push(`at>=${arg(filter.since)}`)
 if(filter.until!==undefined)where.push(`at<${arg(filter.until)}`)
 if(filter.before)where.push(`(at<${arg(filter.before.at)} OR at=?${args.length} AND id<${arg(filter.before.id)})`)
 const rows=(await env.DB.prepare(`SELECT * FROM (${events})${where.length?' WHERE '+where.join(' AND '):''} ORDER BY at DESC,id DESC LIMIT ${arg(filter.limit+1)}`).bind(...args).all<AuditRow>()).results
 const page=rows.slice(0,filter.limit),last=page.at(-1)
 return {rows:await labelled(env,projectId,page),next:rows.length>filter.limit&&last?`${last.at}:${last.id}`:null}
}

/** Names are read now, never stored: removing a teammate's account leaves its events with an opaque id. */
async function labelled(env:Env,projectId:string,rows:AuditRow[]){
 const ids=[...new Set(rows.filter(row=>row.actor_type==='user'&&row.actor_id).map(row=>row.actor_id!))]
 const people=new Map<string,{name:string;email:string}>()
 for(let i=0;i<ids.length;i+=50){
  const chunk=ids.slice(i,i+50)
  for(const person of (await env.DB.prepare(`SELECT id,name,email FROM users WHERE id IN (${chunk.map(()=>'?').join(',')})`).bind(...chunk).all<{id:string;name:string;email:string}>()).results)people.set(person.id,person)
 }
 const holds=(await env.DB.prepare('SELECT starts_at,ends_at FROM audit_holds WHERE project_id=? AND released_at IS NULL').bind(projectId).all<{starts_at:number;ends_at:number|null}>()).results
 return rows.map(row=>{
  const person=row.actor_id?people.get(row.actor_id):undefined
  const actor=row.actor_type==='installation'?'Installation owner (rer)':row.actor_type==='system'?'HappyToHelp':row.actor_type==='api'?'API token':person?`${person.name} <${person.email}>`:'Former teammate'
  return {...row,detail:JSON.parse(row.detail_json||'{}'),actor,held:holds.some(hold=>row.at>=hold.starts_at&&(hold.ends_at===null||row.at<=hold.ends_at))}
 })
}

export function parseCursor(value:string|undefined){
 const match=/^(\d+):(.{1,200})$/.exec(value||'')
 return match?{at:Number(match[1]),id:match[2]}:undefined
}
