import type {Env,Job} from '../../platform/env'
import {cronRequire} from '../../platform/cron-budget'
import {helpScoutGrant} from './helpscout-authority'
import {getHelpScout} from './helpscout-store'
import {syncHelpScout} from './helpscout-sync'

/** Cron only admits a read job. Provider I/O and import staging have a separate
 * bounded invocation. Old jobs cannot cross reconnect or disconnect generations. */
export async function enqueueHelpScout(env:Env){
 cronRequire(env,3)
 const now=Date.now(),row=await env.DB.prepare("SELECT project_id,generation FROM helpscout_connections WHERE status='connected' AND continuous=1 AND next_sync_at<=? AND (sync_lock IS NULL OR sync_lock_until<?) ORDER BY next_sync_at,project_id LIMIT 1").bind(now,now).first<{project_id:string;generation:number}>()
 if(!row)return
 const claim=await env.DB.prepare("UPDATE helpscout_connections SET next_sync_at=? WHERE project_id=? AND generation=? AND continuous=1 AND status='connected' AND next_sync_at<=?").bind(now+300000,row.project_id,row.generation,now).run()
 if(claim.meta.changes)await env.JOBS.send({type:'helpscout.sync',id:row.project_id,projectId:row.project_id,generation:row.generation})
}
export async function consumeHelpScout(env:Env,job:Job){
 const row=await getHelpScout(env.DB,job.projectId)
 if(!row||row.status!=='connected'||!row.continuous||row.generation!==job.generation||!row.sync_actor_id||!row.sync_session_hash)return
 try{
  const grant=await helpScoutGrant(env.DB,{project_id:row.project_id,actor_id:row.sync_actor_id,session_hash:row.sync_session_hash},'data.import')
  await syncHelpScout(env,row,grant)
 }catch{
  // sync records sanitized provider failures itself; only preflight denial
  // needs an explicit health state. Nothing creates or extends a native session.
  await env.DB.prepare("UPDATE helpscout_connections SET error_code=COALESCE(error_code,'helpscout_authority_unavailable'),pending=1 WHERE project_id=? AND generation=? AND status='connected'").bind(row.project_id,row.generation).run()
 }
}
