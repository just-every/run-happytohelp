import type {Env} from '../../../platform/env'
import {authority,guarded} from '../context'
import type {ImportActor} from '../routes'
import {enqueue,getRun} from '../service'
import {pullBatches} from './approval'
const UNFINISHED=['uploaded','parsing','planning','applying','undoing']
/** Resume hands every unfinished batch of a pull to the resuming session. A batch that
 * stopped, or whose session can no longer act, continues from its own checkpoint. One
 * still running under a live session is left to finish, so no batch is advanced twice
 * at once. */
export async function resumeBatches(env:Env,pullId:string,actor:ImportActor){
 for(const batch of await pullBatches(env,pullId)){
  if(!UNFINISHED.includes(batch.state))continue
  const run=await getRun(env,batch.run_id);if(!run)continue
  if(!run.error){const a=authority(run);if((await env.DB.prepare(`SELECT (${a.sql}) allowed`).bind(...a.params!).first<{allowed:number}>())?.allowed)continue}
  await guarded(env,{...run,actor_id:actor.actor_id,session_hash:actor.session_hash},[env.DB.prepare('UPDATE move_in_runs SET error=NULL,session_hash=? WHERE id=? AND state=?').bind(actor.session_hash,run.id,run.state)])
  await enqueue(env,run)
 }
}
