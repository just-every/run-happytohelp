import type {Env} from '../../platform/env'
import type {Run} from './types'
import {guarded} from './context'
export async function getRun(env:Env,id:string){return env.DB.prepare('SELECT * FROM move_in_runs WHERE id=?').bind(id).first<Run>()}
// Background work uses immutable R2 review custody. Avoid loading the owner's
// complete decision report and parser index on every child checkpoint.
export async function getWorkRun(env:Env,id:string){return env.DB.prepare(`SELECT id,source,identity_audited,project_id,actor_id,session_hash,vendor,filename,artifact_hash,object_key,bytes,state,cursor,file_index,
 CASE WHEN state IN ('uploaded','parsing','planning') THEN files_json ELSE '[]' END AS files_json,
 CASE WHEN state IN ('uploaded','parsing','planning') THEN diagnostics_json ELSE '[]' END AS diagnostics_json,
 parsed_total,kit_job_id,review_fingerprint,total,NULL AS plan_json,report_json,error,created_at,updated_at FROM move_in_runs WHERE id=?`).bind(id).first<Run>()}
export const objectKey=(run:Run,suffix:string)=>`move-in/${run.project_id}/${run.id}/${suffix}`
/** A step that completes moves the run on from the checkpoint it read and leaves it with
 * no error: a duplicate delivery of the same step may have stopped it meanwhile. Every
 * write moves updated_at strictly forward, so a delivery can tell whether anything
 * started on or moved the run since it read it. */
export async function updateRun(env:Env,run:Run,patch:Record<string,unknown>,extra:D1PreparedStatement[]=[]){const fields={error:null,...patch};await guarded(env,run,[env.DB.prepare('INSERT INTO ik_d1_assertions(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM move_in_runs WHERE id=? AND state=? AND cursor=?) THEN 1 ELSE 0 END').bind(run.id,run.state,run.cursor),...extra,env.DB.prepare(`UPDATE move_in_runs SET ${Object.keys(fields).map(k=>`${k}=?`).join(',')},updated_at=MAX(?,updated_at+1) WHERE id=? AND state=? AND cursor=?`).bind(...Object.values(fields),Date.now(),run.id,run.state,run.cursor)])}
/** A consumer records that it starts a step, fenced on the checkpoint it read and on
 * nothing having touched the run since: of duplicate deliveries that read the same
 * checkpoint only one starts the step. Resume hands on only a run no consumer has
 * started or finished a step on for longer than its hold. Returns the run as touched,
 * or null when it moved on, stopped or was started by another delivery. */
export async function touchRun(env:Env,run:Run):Promise<Run|null>{const at=Math.max(Date.now(),run.updated_at+1),touched=await env.DB.prepare('UPDATE move_in_runs SET updated_at=? WHERE id=? AND state=? AND cursor=? AND error IS NULL AND updated_at=?').bind(at,run.id,run.state,run.cursor,run.updated_at).run();return touched.meta.changes?{...run,updated_at:at}:null}
/** A failed step stops the run with its reason only while the run is still at the
 * checkpoint the step read and no other delivery has started on it or moved it since
 * this one started: a delivery that lost to another never marks the run. Returns
 * whether the run was stopped. */
export async function failRun(env:Env,run:Run,error:string){const [,failed]=await guarded(env,run,[env.DB.prepare('UPDATE move_in_runs SET error=?,updated_at=? WHERE id=? AND state=? AND cursor=? AND error IS NULL AND updated_at=?').bind(error,Math.max(Date.now(),run.updated_at+1),run.id,run.state,run.cursor,run.updated_at)]);return !!failed.meta.changes}
