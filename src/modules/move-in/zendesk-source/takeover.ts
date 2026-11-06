import type {Env} from '../../../platform/env'
import {authority,guarded} from '../context'
import type {ImportActor} from '../routes'
import {enqueue,getRun} from '../service'
import {pullBatches} from './approval'
import {pullAllowed,type PullRow} from './pull-store'
const UNFINISHED=['uploaded','parsing','planning','applying','undoing'],BEFORE_APPROVAL=['pulling','reviewing','ready']
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
/** What a workspace owner or admin may do with the workspace's pull. Every one of them
 * sees it; the member who started it approves and resumes it. A workspace owner may
 * also stop another member's pull before its approval, or take it over once it has
 * stopped or its member can no longer act. An approved pull imports batches its member
 * reviewed, so it continues under that member. */
export async function access(env:Env,pull:PullRow,actor:Pick<ImportActor,'actor_id'|'role'>){
 const yours=pull.actor_id===actor.actor_id,open=BEFORE_APPROVAL.includes(pull.state),owner=actor.role==='owner'
 return {yours,canStop:open&&(yours||owner),canTakeOver:!yours&&owner&&open&&(!!pull.error||!await pullAllowed(env,pull))}
}
/** Taking over starts the pull again under the owner from the same starting point: it
 * reads Zendesk again and admits what it reads as the owner's own batches, since another
 * member's run is never reused. The other member's batches leave the pull and stay as
 * that member's ordinary imports, as when a pull is stopped. */
export function takeOverPatch(actor:ImportActor):Partial<PullRow>{
 return {actor_id:actor.actor_id,session_hash:actor.session_hash,state:'pulling',phase:'fields',cursor_json:'{}',counts_json:'{}',resume_json:null,approval_json:null,approved_at:null,error:null,next_at:0}
}
export const takeOverStatements=(env:Env,pullId:string)=>['move_in_zendesk_staged','move_in_zendesk_refusals','move_in_zendesk_pull_runs'].map(table=>env.DB.prepare(`DELETE FROM ${table} WHERE pull_id=?`).bind(pullId))
