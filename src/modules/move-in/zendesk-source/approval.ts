import type {Env} from '../../../platform/env'
import {canonicalJson,sha256} from '../../import-kit/src/d1/index'
import {reviewPlan} from '../review-report'
import {approve,getRun} from '../service'
import type {Run} from '../types'
import type {PullContext} from './context'
export interface BatchSummary {tickets:number;ticketsNew:number;ticketsRefused:number;users:number;organizations:number;articles:{published:number;draft:number;heldBack:number};refused:number;error?:string;skipped?:boolean}
export interface PullBatch {ordinal:number;run_id:string;summary_json:string|null;state:string;error:string|null;review_fingerprint:string|null;total:number;filename:string}
export const pullBatches=async(env:Env,pullId:string)=>(await env.DB.prepare('SELECT p.ordinal,p.run_id,p.summary_json,r.state,r.error,r.review_fingerprint,r.total,r.filename FROM move_in_zendesk_pull_runs p JOIN move_in_runs r ON r.id=p.run_id WHERE p.pull_id=? ORDER BY p.ordinal').bind(pullId).all<PullBatch>()).results
const settled=(batch:PullBatch)=>!!batch.error||!['uploaded','parsing','planning'].includes(batch.state)
/** What one reviewed batch holds, by kind, with each refusal named by source id. */
async function summarize(env:Env,run:Run){
 const empty:BatchSummary={tickets:0,ticketsNew:0,ticketsRefused:0,users:0,organizations:0,articles:{published:0,draft:0,heldBack:0},refused:0}
 if(run.error)return {summary:{...empty,error:run.error},refusals:[]}
 if(!run.plan_json)return {summary:{...empty,skipped:true},refusals:[]}
 const plan:any=await reviewPlan(env,run),summary=structuredClone(empty),refusals:{kind:string;sourceId:string;reason:string}[]=[]
 for(const d of plan.decisions??[]){
  const reasons=(d.omissions??[]).map((o:any)=>o.reason)
  if(d.rejection){summary.refused++;if(d.sourceId)refusals.push({kind:d.kind,sourceId:String(d.sourceId),reason:String(d.rejection)})}
  if(d.kind==='ticket'){summary.tickets++;if(d.rejection)summary.ticketsRefused++;else if(d.targets?.some((t:any)=>t.kind==='conversation'))summary.ticketsNew++}
  else if(d.kind==='user')summary.users++
  else if(d.kind==='organization')summary.organizations++
  else if(d.kind==='article'&&!d.rejection){if(reasons.includes('restricted_article_held_back'))summary.articles.heldBack++;else{const status=d.targets?.find((t:any)=>t.kind==='article')?.status;if(status==='published')summary.articles.published++;else if(status==='draft')summary.articles.draft++}}
 }
 return {summary,refusals}
}
/** Each batch's review is summarized once it is ready. With every batch reviewed,
 * the pull waits for its one approval. */
export async function reviewStep(ctx:PullContext){
 let summarized=0,pending=false
 for(const batch of await pullBatches(ctx.env,ctx.pull.id)){
  if(batch.summary_json)continue
  if(!settled(batch)){pending=true;continue}
  if(summarized>=5){ctx.more=true;pending=true;continue}
  const run=(await getRun(ctx.env,batch.run_id))!,{summary,refusals}=await summarize(ctx.env,run)
  ctx.statements.push(ctx.env.DB.prepare('UPDATE move_in_zendesk_pull_runs SET summary_json=? WHERE pull_id=? AND ordinal=?').bind(JSON.stringify(summary),ctx.pull.id,batch.ordinal))
  if(refusals.length)ctx.statements.push(ctx.env.DB.prepare("INSERT OR REPLACE INTO move_in_zendesk_refusals(pull_id,kind,source_id,reason) SELECT ?,json_extract(value,'$.kind'),json_extract(value,'$.sourceId'),json_extract(value,'$.reason') FROM json_each(?)").bind(ctx.pull.id,JSON.stringify(refusals)))
  summarized++
 }
 if(!pending){ctx.state='ready';ctx.phase='review'}
}
/** The approval binds every batch's reviewed fingerprint, in order. */
export const pullFingerprint=(batches:PullBatch[])=>sha256(canonicalJson(batches.map(b=>[b.ordinal,b.run_id,b.state,b.review_fingerprint,b.summary_json])))
/** A batch applies under the one approval only when its review refused nothing. */
export function covered(batches:PullBatch[]){return batches.filter(b=>{const s=b.summary_json?JSON.parse(b.summary_json) as BatchSummary:null;return b.state==='ready'&&!b.error&&b.total>0&&!!b.review_fingerprint&&!!s&&s.refused===0})}
/** Approved batches apply one at a time in the background; each completes before
 * the next is approved, under the approving session. */
export async function applyStep(ctx:PullContext){
 const approval=JSON.parse(ctx.pull.approval_json||'[]') as {runId:string;fingerprint:string}[]
 for(const entry of approval){
  const run=await getRun(ctx.env,entry.runId);if(!run)continue
  if(run.error){ctx.patch.error=`batch_stopped:${run.error}`.slice(0,200);return}
  if(['uploaded','parsing','planning','applying','undoing'].includes(run.state))return
  if(run.state!=='ready')continue
  if(run.review_fingerprint!==entry.fingerprint){ctx.patch.error='batch_review_changed';return}
  await approve(ctx.env,{...run,actor_id:ctx.pull.actor_id,session_hash:ctx.pull.session_hash},entry.fingerprint)
  return
 }
 ctx.state='applied';ctx.phase='done'
}
