import type {Env} from '../../../platform/env'
import {authority,guarded} from '../context'
import type {ImportActor} from '../routes'
import {enqueue,getRun} from '../service'
import {MAPPING_REVISION,reviewedRevision,type Run} from '../types'
import {pullBatches,summarize} from './approval'
import {HOLD_MS,pullAllowed,type PullRow} from './pull-store'
const UNFINISHED=['uploaded','parsing','planning','applying','undoing'],BEFORE_APPROVAL=['pulling','reviewing','ready']
/** Resume hands every unfinished batch of a pull to the resuming session. A batch that
 * stopped, or whose session can no longer act, continues from its own checkpoint. One
 * still running under a live session is left to finish, so no batch is advanced twice
 * at once, unless no step has started or finished on it for longer than a pull step may
 * hold its pull: its queue message is then taken as lost and the batch is handed on
 * again (a late duplicate is harmless: it ends quietly once another delivery has started
 * the step or moved the batch on, and never stops the batch).
 *
 * Before approval, a batch reviewed under an earlier mapping revision is planned again
 * from the records it already holds, with no read of Zendesk: its review, summary and
 * refusals then reflect what the deployed mapping imports, and the pull reaches ready
 * again with a new fingerprint. So is a ready batch whose run carries an error (a
 * duplicate delivery once stopped a batch that another delivery then finished): it was
 * never counted as reviewed, and the one approval covers it once it is planned again.
 * Approved and applied batches are never planned again. Returns whether any batch went
 * back to planning. */
export async function resumeBatches(env:Env,pull:Pick<PullRow,'id'|'state'>,actor:ImportActor){
 const batches=await pullBatches(env,pull.id),now=Date.now(),replanned:{run:Run;refusals:string[]}[]=[]
 const stale=BEFORE_APPROVAL.includes(pull.state)?batches.filter(b=>b.state==='ready'):[]
 for(const batch of stale){
  const run=await getRun(env,batch.run_id);if(!run||!run.error&&reviewedRevision(run.plan_json)>=MAPPING_REVISION)continue
  replanned.push({run,refusals:batch.summary_json?(await summarize(env,run)).refusals.map(r=>JSON.stringify([r.kind,r.sourceId])):[]})
 }
 // Refusals another reviewed batch still holds stay named; those only a replanned batch held go until its new review.
 const kept=new Set<string>()
 for(const batch of batches)if(batch.summary_json&&!replanned.some(r=>r.run.id===batch.run_id)&&JSON.parse(batch.summary_json).refused){const run=await getRun(env,batch.run_id);if(run)for(const r of (await summarize(env,run)).refusals)kept.add(JSON.stringify([r.kind,r.sourceId]))}
 for(const {run,refusals} of replanned){
  const dropped=JSON.stringify(refusals.filter(key=>!kept.has(key)).map(key=>JSON.parse(key)))
  await guarded(env,{...run,session_hash:actor.session_hash},[
   env.DB.prepare("INSERT INTO ik_d1_assertions(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM move_in_runs WHERE id=? AND state='ready' AND review_fingerprint IS ?) THEN 1 ELSE 0 END").bind(run.id,run.review_fingerprint),
   env.DB.prepare("UPDATE move_in_runs SET state='planning',review_fingerprint=NULL,total=0,plan_json=NULL,cursor=0,error=NULL,session_hash=?,updated_at=? WHERE id=? AND state='ready' AND review_fingerprint IS ?").bind(actor.session_hash,now,run.id,run.review_fingerprint),
   env.DB.prepare('UPDATE move_in_zendesk_pull_runs SET summary_json=NULL WHERE pull_id=? AND run_id=?').bind(pull.id,run.id),
   env.DB.prepare("DELETE FROM move_in_zendesk_refusals WHERE pull_id=? AND EXISTS(SELECT 1 FROM json_each(?) r WHERE json_extract(r.value,'$[0]')=kind AND json_extract(r.value,'$[1]')=source_id)").bind(pull.id,dropped)])
  await enqueue(env,{...run,state:'planning'})
 }
 for(const batch of batches){
  if(!UNFINISHED.includes(batch.state))continue
  const run=await getRun(env,batch.run_id);if(!run)continue
  if(!run.error&&now-run.updated_at<=HOLD_MS){const a=authority(run);if((await env.DB.prepare(`SELECT (${a.sql}) allowed`).bind(...a.params!).first<{allowed:number}>())?.allowed)continue}
  await guarded(env,{...run,actor_id:actor.actor_id,session_hash:actor.session_hash},[env.DB.prepare('UPDATE move_in_runs SET error=NULL,session_hash=?,updated_at=MAX(?,updated_at+1) WHERE id=? AND state=?').bind(actor.session_hash,now,run.id,run.state)])
  await enqueue(env,run)
 }
 return replanned.length>0
}
/** What a workspace owner or admin may do with the workspace's pull. Every one of them
 * sees it; the member who started it approves and resumes it. A workspace owner may
 * also stop another member's pull before its approval, or take it over once it has
 * stopped or its member can no longer act. An approved pull imports batches its member
 * reviewed, so it continues under that member while it runs; once it has stopped, or
 * its member can no longer act, a workspace owner may stop it. */
export async function access(env:Env,pull:PullRow,actor:Pick<ImportActor,'actor_id'|'role'>){
 const yours=pull.actor_id===actor.actor_id,open=BEFORE_APPROVAL.includes(pull.state),approved=pull.state==='applying',owner=actor.role==='owner'
 const halted=owner&&(approved||open&&!yours)&&(!!pull.error||!await pullAllowed(env,pull))
 return {yours,canStop:open&&(yours||owner)||approved&&halted,canTakeOver:open&&!yours&&halted}
}
/** Taking over starts the pull again under the owner from the same starting point: it
 * reads Zendesk again and admits what it reads as the owner's own batches, since another
 * member's run is never reused. The other member's batches leave the pull and stay as
 * that member's ordinary imports, as when a pull is stopped. */
export function takeOverPatch(actor:ImportActor):Partial<PullRow>{
 return {actor_id:actor.actor_id,session_hash:actor.session_hash,state:'pulling',phase:'fields',cursor_json:'{}',counts_json:'{}',resume_json:null,approval_json:null,approved_at:null,error:null,next_at:0}
}
export const takeOverStatements=(env:Env,pullId:string)=>['move_in_zendesk_staged','move_in_zendesk_refusals','move_in_zendesk_pull_runs'].map(table=>env.DB.prepare(`DELETE FROM ${table} WHERE pull_id=?`).bind(pullId))
