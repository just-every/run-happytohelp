import type {Env} from '../../../platform/env'
import {covered,pullBatches,pullFingerprint,stopped,type BatchSummary} from './approval'
import {json,type PullRow} from './pull-store'
import {emptyHeld} from './settle'
import {MAPPING_REVISION,reviewedRevision} from '../types'
const REFUSALS_SHOWN=500
/** Progress, totals by kind and every refusal by source id, with what the viewing member
 * may do with it. Never a token, code, verifier or link. */
export async function pullView(env:Env,pull:PullRow,viewer:{yours:boolean;canStop:boolean;canTakeOver:boolean}){
 const batches=await pullBatches(env,pull.id),counts=json<any>(pull.counts_json,{}),approval=json<{runId:string}[]>(pull.approval_json,[])
 const staged=pull.state==='pulling'?(await env.DB.prepare('SELECT kind,state,COUNT(*) n FROM move_in_zendesk_staged WHERE pull_id=? GROUP BY kind,state').bind(pull.id).all<{kind:string;state:string;n:number}>()).results:[]
 const refusals=(await env.DB.prepare('SELECT kind,source_id sourceId,reason FROM move_in_zendesk_refusals WHERE pull_id=? ORDER BY kind,CAST(source_id AS INTEGER) LIMIT ?').bind(pull.id,REFUSALS_SHOWN).all<{kind:string;sourceId:string;reason:string}>()).results
 const refusedTotal=(await env.DB.prepare('SELECT kind,COUNT(*) n FROM move_in_zendesk_refusals WHERE pull_id=? GROUP BY kind').bind(pull.id).all<{kind:string;n:number}>()).results
 const refusedOf=(kind:string)=>refusedTotal.find(row=>row.kind===kind)?.n??0
 const n=(kind:string,...states:string[])=>staged.filter(row=>row.kind===kind&&(!states.length||states.includes(row.state))).reduce((sum,row)=>sum+row.n,0)
 const held=counts.held??emptyHeld(),source=counts.source??{tickets:n('ticket')+refusedOf('ticket'),deleted:n('ticket','deleted'),replies:n('ticket_comment')+refusedOf('ticket_comment'),users:n('user','ready','packed'),organizations:n('organization','ready','packed'),ticketFields:n('ticket_field'),articles:n('article')}
 const summaries=batches.map(b=>b.summary_json?JSON.parse(b.summary_json) as BatchSummary:null),sum=(pick:(s:BatchSummary)=>number,only?:(i:number)=>boolean)=>summaries.reduce((total,s,i)=>total+(s&&(!only||only(i))?pick(s):0),0)
 const fingerprint=pull.state==='ready'?pullFingerprint(batches):null,coverable=pull.state==='ready'?covered(batches).map(b=>b.run_id):approval.map(a=>a.runId)
 return {
  id:pull.id,state:pull.state,phase:pull.phase,...viewer,subdomain:pull.subdomain,error:pull.error,nextAt:pull.next_at||null,createdAt:pull.created_at,approvedAt:pull.approved_at,fingerprint,
  // Resume refreshes only ready batches before the pull's approval. Older reviews
  // without an explicit revision are revision 1, just as in resumeBatches.
  needsReplan:pull.state==='ready'&&pull.approved_at===null&&batches.some(b=>b.state==='ready'&&!b.error&&reviewedRevision(b.plan_json)<MAPPING_REVISION),
  progress:{phase:pull.phase,commentsPending:n('ticket','comments'),ticketsRead:n('ticket','ready','packed'),batches:batches.length,batchesReviewed:summaries.filter(Boolean).length,batchesApplied:batches.filter(b=>b.state==='completed').length,batchesStopped:batches.filter(stopped).length},
  totals:{
   tickets:{seen:source.tickets,deleted:source.deleted,imported:sum(s=>s.ticketsNew,i=>batches[i].state==='completed'),refused:refusedOf('ticket'),alreadyImported:held.tickets.unchanged},
   replies:{seen:source.replies??0,imported:sum(s=>s.replies??0,i=>batches[i].state==='completed'),refused:refusedOf('ticket_comment')},
   // Changed in Zendesk since an earlier import: kept as imported, never refused.
   keptAsImported:{tickets:held.tickets.changed,users:held.users.changed,organizations:held.organizations.changed},
   users:source.users,organizations:source.organizations,ticketFields:source.ticketFields,
   articles:{seen:source.articles,published:sum(s=>s.articles.published),draft:sum(s=>s.articles.draft),heldBack:sum(s=>s.articles.heldBack),...(counts.articlesUnavailable?{unavailable:true}:{})},
   redactedLinks:counts.redacted??0
  },
  refusals,refusalsTotal:refusedTotal.reduce((total,row)=>total+row.n,0),
  // A stopped batch is what is left of a pull that has not finished; Resume continues it.
  batches:batches.map((b,i)=>({ordinal:b.ordinal,runId:b.run_id,filename:b.filename,state:b.state,error:b.error,summary:summaries[i],covered:coverable.includes(b.run_id),stopped:stopped(b),nothingToImport:!!summaries[i]&&b.state==='ready'&&!b.total}))
 }
}
