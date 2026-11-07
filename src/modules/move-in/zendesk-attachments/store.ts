import type {Env} from '../../../platform/env'
import {pullAuthority} from '../zendesk-source/pull-store'
export const ATTACHMENTS_JOB='move-in.zendesk.attachments'
export type RunState='running'|'done'
/** Where a run is: the last ticket finished, the ticket being read and its comment page. */
export interface Cursor {after?:string|null;ticket?:string|null;page?:string|null}
export interface AttachmentRun {id:string;project_id:string;actor_id:string;session_hash:string;subdomain:string;state:RunState;cursor_json:string;next_at:number;error:string|null;lease_until:number|null;version:number;created_at:number;updated_at:number}
export const getRun=(env:Env,id:string)=>env.DB.prepare('SELECT * FROM move_in_zendesk_attachment_pulls WHERE id=?').bind(id).first<AttachmentRun>()
export const latestRun=(env:Env,projectId:string)=>env.DB.prepare('SELECT * FROM move_in_zendesk_attachment_pulls WHERE project_id=? ORDER BY created_at DESC LIMIT 1').bind(projectId).first<AttachmentRun>()
export const cursorOf=(run:AttachmentRun):Cursor=>{try{return JSON.parse(run.cursor_json)||{}}catch{return {}}}
/** The member who started or resumed the run authorizes every background step. */
export const runAuthority=(run:Pick<AttachmentRun,'project_id'|'actor_id'|'session_hash'>)=>pullAuthority(run)
export async function runAllowed(env:Env,run:AttachmentRun){const a=runAuthority(run);return !!(await env.DB.prepare(`SELECT (${a.sql}) allowed`).bind(...a.params!).first<{allowed:number}>())?.allowed}
/** A statement that fails the whole batch unless the run's member may still act. */
export function authorityAssertion(env:Env,run:AttachmentRun){const a=runAuthority(run);return env.DB.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT CASE WHEN (${a.sql}) THEN 1 ELSE 0 END`).bind(...a.params!)}
export const clearAssertions=(env:Env)=>env.DB.prepare('DELETE FROM ik_d1_assertions')
/** Writes fenced by the member's authority: the run never adds a file once that member can no longer act. */
export const fenced=(env:Env,run:AttachmentRun,statements:D1PreparedStatement[])=>env.DB.batch([authorityAssertion(env,run),...statements,clearAssertions(env)])
export async function claimRun(env:Env,run:AttachmentRun,now:number,holdMs:number){
 const claimed=await env.DB.prepare('UPDATE move_in_zendesk_attachment_pulls SET lease_until=?,version=version+1 WHERE id=? AND version=? AND (lease_until IS NULL OR lease_until<=?)').bind(now+holdMs,run.id,run.version,now).run()
 return claimed.meta.changes?{...run,version:run.version+1,lease_until:now+holdMs}:null
}
/** The checkpoint commits under the claimed version and the member's authority. */
export function saveRun(env:Env,run:AttachmentRun,patch:Partial<AttachmentRun>){
 const fields={...patch,lease_until:null,updated_at:Date.now()}
 return env.DB.batch([
  env.DB.prepare('INSERT INTO ik_d1_assertions(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM move_in_zendesk_attachment_pulls WHERE id=? AND version=?) THEN 1 ELSE 0 END').bind(run.id,run.version),
  authorityAssertion(env,run),
  env.DB.prepare(`UPDATE move_in_zendesk_attachment_pulls SET ${Object.keys(fields).map(key=>`${key}=?`).join(',')},version=version+1 WHERE id=? AND version=?`).bind(...Object.values(fields),run.id,run.version),
  clearAssertions(env)])
}
/** A stop is recorded even when the member's session has lapsed: it carries a code only. */
export async function stopRun(env:Env,run:AttachmentRun,error:string){await env.DB.prepare('UPDATE move_in_zendesk_attachment_pulls SET error=?,lease_until=NULL,version=version+1,updated_at=? WHERE id=? AND version=?').bind(error.slice(0,200),Date.now(),run.id,run.version).run()}
export async function enqueueRun(env:Env,run:{id:string;project_id:string},delayMs=0){
 const message={type:ATTACHMENTS_JOB,id:run.id,projectId:run.project_id}
 if(delayMs>0)await env.JOBS.send(message,{delaySeconds:Math.min(43200,Math.ceil(delayMs/1000))});else await env.JOBS.send(message)
}
