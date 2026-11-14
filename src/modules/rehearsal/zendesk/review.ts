import {getGrant} from '../store'
import {rehearsalAudit} from '../audit'
import {covered,pullBatches,pullFingerprint} from '../../move-in/zendesk-source/approval'
import type {PullContext} from '../../move-in/zendesk-source/context'
import {MAPPING_REVISION,reviewedRevision} from '../../move-in/types'
import {getRun} from '../../move-in/service'

/** Consent covers the complete current computed review, never a caller's fingerprint. */
export async function approveDelegatedReview(ctx:PullContext){
 await ctx.assertLive?.()
 const batches=await pullBatches(ctx.env,ctx.pull.id)
 for(const batch of batches){
  if(!batch.summary_json||batch.error||!['ready','completed'].includes(batch.state))throw new Error('zendesk_review_incomplete')
  if(batch.state==='ready'&&reviewedRevision(batch.plan_json)<MAPPING_REVISION)throw new Error('zendesk_review_changed')
  const run=await getRun(ctx.env,batch.run_id)
  if(!run||run.authority_mode!=='rehearsal'||run.rehearsal_id!==ctx.pull.rehearsal_id||run.rehearsal_generation!==ctx.pull.rehearsal_generation)throw new Error('zendesk_child_authority_changed')
 }
 const approval=covered(batches).map(b=>({runId:b.run_id,fingerprint:b.review_fingerprint!}))
 ctx.patch.approval_json=JSON.stringify(approval)
 ctx.patch.approved_at=Date.now()
 ctx.counts.reviewFingerprint=pullFingerprint(batches)
 const grant=await getGrant(ctx.env,ctx.pull.rehearsal_id!)
 if(!grant)throw new Error('import_authority_revoked')
 ctx.statements.push(rehearsalAudit(ctx.env.DB,grant,'zendesk_review_covered',{pull:ctx.pull.id,fingerprint:ctx.counts.reviewFingerprint,batches:approval.length}))
 ctx.state='applying';ctx.phase='apply'
}
