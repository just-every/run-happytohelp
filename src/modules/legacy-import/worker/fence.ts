import {expectedOwnerEmail} from '../adoption/authority'
import type {Env} from '../../../platform/env'
import {dbNow,type DeltaLease} from '../lease'
import {guard,guarded,type Run} from './state'
import {refuse} from './errors'
/** A nonwaiting workspace fence, separate from the durable run claim. */
export async function workspaceLease(env:Env,run:Run):Promise<(DeltaLease&{token:string})|null>{
 const token=crypto.randomUUID()
 const acquired=await guarded(env,run,[env.DB.prepare(`INSERT INTO legacy_delta_leases(project_id,token,expires_at) SELECT ?,?,${dbNow}+60000 WHERE NOT EXISTS(SELECT 1 FROM contact_erasure_leases WHERE project_id=? AND expires_at>${dbNow}) ON CONFLICT(project_id) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at WHERE legacy_delta_leases.expires_at<=${dbNow} RETURNING token`).bind(run.source_project_id,token,run.source_project_id)])
 if(!acquired[1].results.length)return null
 const held=`EXISTS(SELECT 1 FROM legacy_delta_leases WHERE project_id=? AND token=? AND expires_at>${dbNow})`
 return {token,
  assertion:db=>db.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT (${held}) AND EXISTS(SELECT 1 FROM legacy_import_worker_runs WHERE id=? AND version=? AND state='running' AND lease_token=? AND lease_until>${dbNow}) AND (${authoritySql(run,expectedOwnerEmail(env)).sql})`).bind(run.source_project_id,token,run.id,run.version,run.lease_token,...authoritySql(run,expectedOwnerEmail(env)).params),
  cleared:db=>db.prepare('DELETE FROM ik_d1_assertions'),
  async confirm(){const result=await guarded(env,run,[env.DB.prepare(`UPDATE legacy_delta_leases SET expires_at=${dbNow}+60000 WHERE project_id=? AND token=? AND expires_at>${dbNow} RETURNING token`).bind(run.source_project_id,token)]);if(!result[1].results.length)refuse('lease_lost')},
  async release(){await env.DB.prepare('DELETE FROM legacy_delta_leases WHERE project_id=? AND token=?').bind(run.source_project_id,token).run()},
 }
}
import {runAuthority as authoritySql} from './state'
/** Bounded recovery uses the existing jobs allocation; source work stays queued. */
export async function discover(env:Env){
 const {cronRoom}=await import('../../../platform/cron-budget')
 const {enqueue}=await import('./state')
 if(!cronRoom(env,2))return
 const rows=await env.DB.prepare(`SELECT * FROM legacy_import_worker_runs WHERE state IN ('queued','running') AND next_at<=${dbNow} AND (lease_until IS NULL OR lease_until<=${dbNow}) ORDER BY next_at,id LIMIT 10`).all<Run>()
 if(!rows.results.length)return
 await env.DB.prepare(`UPDATE legacy_import_worker_runs SET next_at=${dbNow} WHERE id IN (SELECT value FROM json_each(?)) AND state IN ('queued','running') AND (lease_until IS NULL OR lease_until<=${dbNow})`).bind(JSON.stringify(rows.results.map(row=>row.id))).run()
 for(const run of rows.results)await enqueue(env,{...run,next_at:0})
}
