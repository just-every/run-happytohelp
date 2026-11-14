import type {RehearsalGrant} from './types'
import type {Context} from 'hono'
import type {AppEnv} from '../../platform/env'
import {hashToken} from '../../platform/auth'
/** Callers supply bounded enum/count/hash facts. Source bodies, credentials and session hashes never enter audit. */
export function rehearsalAudit(db:D1Database,g:Pick<RehearsalGrant,'id'|'setup_project_id'|'generation'>,action:string,detail:Record<string,string|number|boolean|null>={}){
 return db.prepare("INSERT INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,detail_json) VALUES(?,?,?,'data',?,'succeeded','system',NULL,'system','rehearsal',?,?)")
  .bind(crypto.randomUUID(),g.setup_project_id,Date.now(),'rehearsal.'+action,g.id,JSON.stringify({generation:g.generation,...detail}))
}
/** At most one safe refusal fact per scoped operation/code/day. Neither an
 * unauthenticated guess nor a foreign workspace name establishes an audit scope. */
export async function recordRefusal(c:Context<AppEnv>){
 if(c.res.status<400)return
 const setup=c.req.param('setupProjectId'),id=c.req.param('id'),actor=c.get('actor')
 if(!setup)return
 let authorized=false,generation=0
 if(id){
  const g=await c.env.DB.prepare('SELECT setup_project_id,owner_id,credential_hash,generation FROM rehearsal_grants WHERE id=?').bind(id).first<Pick<RehearsalGrant,'setup_project_id'|'owner_id'|'credential_hash'|'generation'>>()
  if(!g||g.setup_project_id!==setup)return
  generation=g.generation
  const bearer=c.req.header('Authorization')?.match(/^Bearer (hhr_[a-f0-9]{64})$/)?.[1]
  authorized=actor?.id===g.owner_id||!!bearer&&g.credential_hash===await hashToken(bearer)
 }else if(actor)authorized=!!await c.env.DB.prepare("SELECT 1 FROM owner_setup WHERE singleton=1 AND claim_id=? AND claim_id<>'existing-installation' AND EXISTS(SELECT 1 FROM audit_events WHERE action='owner.created' AND category='access' AND outcome='succeeded' AND source='dashboard' AND actor_id=? AND target_id=? AND project_id=?)").bind(actor.id,actor.id,actor.id,setup).first()
 if(!authorized)return
 const body=await c.res.clone().json().catch(()=>null) as {code?:unknown}|null
 const code=typeof body?.code==='string'&&/^[a-z_]{1,80}$/.test(body.code)?body.code:'request_refused'
 const tail=c.req.path.split('/').at(-1)??'',operation=['manifest','start','resume','stop','cleanup','verify','pulls','attachments'].includes(tail)?tail:c.req.method==='PUT'?'part':'request'
 const key=`rehearsal-refusal:${id??setup}:${generation}:${new Date().toISOString().slice(0,10)}:${operation}:${code}`
 await c.env.DB.prepare("INSERT OR IGNORE INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,detail_json) VALUES(?,?,?,'data','rehearsal.refused','refused','system',NULL,'system','rehearsal',?,?)").bind(key,setup,Date.now(),id??setup,JSON.stringify({generation,operation,code})).run()
}
