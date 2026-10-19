import type {Context} from 'hono'
import type {AppEnv,Env} from '../../platform/env'

export type AuditCategory='auth'|'access'|'data'|'erasure'|'assignment'|'approval'|'integration'|'audit'
export type AuditOutcome='succeeded'|'refused'|'failed'
export type AuditSource='dashboard'|'api'|'rer'|'email'|'system'
export interface AuditEvent {
 projectId:string
 category:AuditCategory
 action:string
 outcome?:AuditOutcome
 actor:{type:'user'|'system'|'installation'|'api';id?:string|null}
 source:AuditSource
 target?:{type:string;id:string}
 purpose?:string
 /** Counts, reasons and ids only. Never secrets, message text or a customer's address. */
 detail?:Record<string,unknown>
}

/** One append-only audit row, as a statement to batch with the change it records. */
export function auditStatement(db:D1Database,event:AuditEvent,at=Date.now(),guard?:{sql:string;params:unknown[]}){
 return db.prepare(`INSERT INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,purpose,detail_json) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? ${guard?`WHERE ${guard.sql}`:''}`)
  .bind(crypto.randomUUID(),event.projectId,at,event.category,event.action,event.outcome??'succeeded',event.actor.type,event.actor.id??null,event.source,event.target?.type??null,event.target?.id??null,event.purpose??null,JSON.stringify(event.detail??{}),...(guard?.params??[]))
}
export async function audit(env:Env,event:AuditEvent){await auditStatement(env.DB,event).run()}

/** Who and through which door: a bearer request is the API, a cookie the dashboard. */
export function requestSource(c:Context<AppEnv>):AuditSource{return c.req.header('Authorization')?.startsWith('Bearer int_')?'api':'dashboard'}
export const userActor=(id:string)=>({type:'user' as const,id})
