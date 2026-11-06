import type {Env} from '../../../platform/env'
import {authority} from '../context'
export type PullState='pulling'|'reviewing'|'ready'|'applying'|'applied'|'abandoned'
export type Phase='fields'|'articles'|'organizations'|'users'|'tickets'|'comments'|'people'|'packing'|'review'|'apply'|'done'
export interface PullRow {id:string;project_id:string;actor_id:string;session_hash:string;subdomain:string;state:PullState;phase:Phase;cursor_json:string;start_json:string;resume_json:string|null;next_at:number;incremental_json:string;counts_json:string;approval_json:string|null;approved_at:number|null;error:string|null;lease_until:number|null;version:number;created_at:number;updated_at:number}
export const getPull=(env:Env,id:string)=>env.DB.prepare('SELECT * FROM move_in_zendesk_pulls WHERE id=?').bind(id).first<PullRow>()
export const latestPulls=(env:Env,projectId:string,limit=10)=>env.DB.prepare('SELECT * FROM move_in_zendesk_pulls WHERE project_id=? ORDER BY created_at DESC LIMIT ?').bind(projectId,limit).all<PullRow>()
/** The reviewer's own session authorizes every background step, as for an upload. */
export const pullAuthority=(pull:Pick<PullRow,'project_id'|'actor_id'|'session_hash'>)=>authority({id:'',project_id:pull.project_id,actor_id:pull.actor_id,session_hash:pull.session_hash})
export async function pullAllowed(env:Env,pull:PullRow){const a=pullAuthority(pull);return !!(await env.DB.prepare(`SELECT (${a.sql}) allowed`).bind(...a.params!).first<{allowed:number}>())?.allowed}
/** One invocation holds the pull while it reads; a duplicate queue message finds it held. */
export async function claimPull(env:Env,pull:PullRow,now:number,holdMs:number){
 const claimed=await env.DB.prepare('UPDATE move_in_zendesk_pulls SET lease_until=?,version=version+1 WHERE id=? AND version=? AND (lease_until IS NULL OR lease_until<=?)').bind(now+holdMs,pull.id,pull.version,now).run()
 return claimed.meta.changes?{...pull,version:pull.version+1,lease_until:now+holdMs}:null
}
/** Staged source writes and the pull checkpoint commit together, fenced by the
 * claimed version and the reviewer's authority. */
export function savePull(env:Env,pull:PullRow,patch:Partial<PullRow>,statements:D1PreparedStatement[]=[]){
 const a=pullAuthority(pull),fields={...patch,lease_until:null,updated_at:Date.now()}
 return env.DB.batch([
  env.DB.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM move_in_zendesk_pulls WHERE id=? AND version=?) AND (${a.sql}) THEN 1 ELSE 0 END`).bind(pull.id,pull.version,...a.params!),
  ...statements,
  env.DB.prepare(`UPDATE move_in_zendesk_pulls SET ${Object.keys(fields).map(key=>`${key}=?`).join(',')},version=version+1 WHERE id=? AND version=?`).bind(...Object.values(fields),pull.id,pull.version),
  env.DB.prepare('DELETE FROM ik_d1_assertions')])
}
/** A stop is recorded even when the reviewer's session has lapsed: it carries no source data. */
export async function stopPull(env:Env,pull:PullRow,error:string){await env.DB.prepare('UPDATE move_in_zendesk_pulls SET error=?,lease_until=NULL,version=version+1,updated_at=? WHERE id=? AND version=?').bind(error.slice(0,200),Date.now(),pull.id,pull.version).run()}
export const json=<T>(text:string|null|undefined,fallback:T):T=>{if(!text)return fallback;try{return JSON.parse(text) as T}catch{return fallback}}
