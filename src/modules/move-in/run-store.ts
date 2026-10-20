import type {Env} from '../../platform/env'
import type {Run} from './types'
import {guarded} from './context'
export async function getRun(env:Env,id:string){return env.DB.prepare('SELECT * FROM move_in_runs WHERE id=?').bind(id).first<Run>()}
// Background work uses immutable R2 review custody. Avoid loading the owner's
// complete decision report and parser index on every child checkpoint.
export async function getWorkRun(env:Env,id:string){return env.DB.prepare(`SELECT id,project_id,actor_id,session_hash,vendor,filename,artifact_hash,object_key,bytes,state,cursor,file_index,
 CASE WHEN state IN ('fetching','uploaded','parsing','planning') THEN files_json ELSE '[]' END AS files_json,
 CASE WHEN state IN ('fetching','uploaded','parsing','planning') THEN diagnostics_json ELSE '[]' END AS diagnostics_json,
 parsed_total,kit_job_id,review_fingerprint,total,NULL AS plan_json,report_json,error,created_at,updated_at FROM move_in_runs WHERE id=?`).bind(id).first<Run>()}
export const objectKey=(run:Run,suffix:string)=>`move-in/${run.project_id}/${run.id}/${suffix}`
export async function updateRun(env:Env,run:Run,patch:Record<string,unknown>,extra:D1PreparedStatement[]=[]){await guarded(env,run,[env.DB.prepare('INSERT INTO ik_d1_assertions(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM move_in_runs WHERE id=? AND state=? AND cursor=?) THEN 1 ELSE 0 END').bind(run.id,run.state,run.cursor),...extra,env.DB.prepare(`UPDATE move_in_runs SET ${Object.keys(patch).map(k=>`${k}=?`).join(',')},updated_at=? WHERE id=? AND state=? AND cursor=?`).bind(...Object.values(patch),Date.now(),run.id,run.state,run.cursor)])}
