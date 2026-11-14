import type {Env} from '../../../platform/env'
import type {DurableAuthority} from '../types'
import {assertRehearsal} from '../../rehearsal/authority'
import {HOLD_MS,pullAuthority} from '../zendesk-source/pull-store'
export const ATTACHMENTS_JOB='move-in.zendesk.attachments'
/** The stop recorded for a run whose step died or whose queue message never arrived. */
export const STEP_LOST='attachments_step_lost'
export type RunState='running'|'done'
/** Where a run is: the last ticket finished, the ticket being read and its comment page. */
export interface Cursor {after?:string|null;ticket?:string|null;page?:string|null}
export interface AttachmentRun extends DurableAuthority {id:string;project_id:string;actor_id:string;session_hash:string;subdomain:string;state:RunState;cursor_json:string;next_at:number;error:string|null;lease_until:number|null;version:number;created_at:number;updated_at:number}
export const getRun=(env:Env,id:string)=>env.DB.prepare('SELECT * FROM move_in_zendesk_attachment_pulls WHERE id=?').bind(id).first<AttachmentRun>()
/** The workspace's run that has not finished, stopped or not. */
export const unfinishedRun=(env:Env,projectId:string)=>env.DB.prepare("SELECT * FROM move_in_zendesk_attachment_pulls WHERE project_id=? AND state='running'").bind(projectId).first<AttachmentRun>()
export const latestRun=(env:Env,projectId:string)=>env.DB.prepare('SELECT * FROM move_in_zendesk_attachment_pulls WHERE project_id=? ORDER BY created_at DESC LIMIT 1').bind(projectId).first<AttachmentRun>()
export const cursorOf=(run:AttachmentRun):Cursor=>{try{return JSON.parse(run.cursor_json)||{}}catch{return {}}}
/** The member who started or resumed the run authorizes every background step. */
export const runAuthority=(run:Pick<AttachmentRun,'project_id'|'actor_id'|'session_hash'> & DurableAuthority & Partial<Pick<AttachmentRun,'id'|'version'>>)=>{const a=pullAuthority(run);return run.authority_mode==='rehearsal'?{sql:`(${a.sql}) AND EXISTS(SELECT 1 FROM move_in_zendesk_attachment_pulls WHERE id=? AND version=? AND error IS NULL AND state='running')`,params:[...a.params!,run.id??'',run.version??-1]}:a}
export async function runAllowed(env:Env,run:AttachmentRun){if(run.authority_mode==='rehearsal'){try{await assertRehearsal(env,{rehearsal_id:run.rehearsal_id!,rehearsal_generation:run.rehearsal_generation!},run.project_id,'zendesk')}catch{return false}}const a=runAuthority(run);return !!(await env.DB.prepare(`SELECT (${a.sql}) allowed`).bind(...a.params!).first<{allowed:number}>())?.allowed}
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
/** A running run with no stop is lost when its step has held it past its lease without a
 * checkpoint (the step died), or when nothing has held it for a lease since it was last
 * saved, resumed, started or due (its queue message never arrived). A step bounds itself
 * well inside its lease, and a delivery is due by then, so neither is taken early. */
const LOST="state='running' AND error IS NULL AND (lease_until IS NOT NULL AND lease_until<=?1 OR lease_until IS NULL AND MAX(updated_at,next_at)+?2<=?1)"
const lost=(run:AttachmentRun,now:number)=>run.state==='running'&&!run.error&&(run.lease_until!==null?run.lease_until<=now:Math.max(run.updated_at,run.next_at)+HOLD_MS<=now)
/** Records the stop of a lost run, so every read shows its reason and Resume or a new run
 * gets past it. The version bump fences a step that is somehow still alive: its
 * checkpoint fails and it ends quietly. Returns the run as it now is. */
export async function settleLost(env:Env,run:AttachmentRun,now=Date.now()):Promise<AttachmentRun>{
 if(!lost(run,now))return run
 const settled=await env.DB.prepare(`UPDATE move_in_zendesk_attachment_pulls SET error=?3,lease_until=NULL,version=version+1,updated_at=?1 WHERE id=?4 AND ${LOST} RETURNING *`).bind(now,HOLD_MS,STEP_LOST,run.id).first<AttachmentRun>()
 return settled??(await getRun(env,run.id))??run
}
/** A stop is recorded even when the member's session has lapsed: it carries a code only. */
export async function stopRun(env:Env,run:AttachmentRun,error:string){await env.DB.prepare('UPDATE move_in_zendesk_attachment_pulls SET error=?,lease_until=NULL,version=version+1,updated_at=? WHERE id=? AND version=?').bind(error.slice(0,200),Date.now(),run.id,run.version).run()}
export async function enqueueRun(env:Env,run:{id:string;project_id:string},delayMs=0){
 const message={type:ATTACHMENTS_JOB,id:run.id,projectId:run.project_id}
 if(delayMs>0)await env.JOBS.send(message,{delaySeconds:Math.min(43200,Math.ceil(delayMs/1000))});else await env.JOBS.send(message)
}
