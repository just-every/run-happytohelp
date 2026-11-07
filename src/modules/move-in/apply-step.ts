import {d1RequestContext,type D1ImportContext} from '../import-kit/src/d1/index'
import {limitStatements} from '../import-kit/src/d1/budget'
import {queueStatements} from '../../platform/d1-budget'
/** One delivery applies up to three kit transactions of LIMITS.applyBatch entries, each
 * under its own checkpoint fence, before the run's checkpoint is published once.
 * The queue's bounded port counts every statement of a batch, which the kit counts as one
 * query, and it also counts what move-in's publication wrapper adds around each kit batch
 * call (guards before and after, one cleanup: 2 * predicates + 1 statements). So the kit
 * works to a statement allowance that leaves room for both, and stops a transaction short,
 * as it does when its own budget ends, rather than reaching the queue's ceiling:
 *   queue ceiling                    980 (1000 less the 20 held back to record a failure)
 *   move-in statements around it   15 + P (including every publication preflight)
 *   wrapper statements             (1 + 4 * batches) * (2 * P + 1), when P > 0
 *   spare                          20
 * P includes contact, category and retained-source predicates from this review.
 * Authorization costs one wrapped batch. Each transaction can read 15 target
 * kinds in three sets of five statements, then publish one write batch. Failed
 * set reads keep their charge before the kit falls back to individual reads.
 * Never exceed the existing kit allowance, even with no publication predicates. */
const APPLY_STEP={batches:3,maxStatements:895,spare:20,nextBatchStatements:200} as const
export function applyStep(context:D1ImportContext,predicates:number):D1ImportContext{
 const allowance=(batches:number,readSets=3)=>{
  const wrapper=predicates?(1+(1+readSets)*batches)*(2*predicates+1):0
  return Math.min(APPLY_STEP.maxStatements,queueStatements.limit-queueStatements.reserve-(15+predicates)-wrapper-APPLY_STEP.spare)
 }
 // The kit starts another transaction only with 200 statements left. Do not
 // reserve later transactions at the expense of the first one's progress.
 let batches:number=APPLY_STEP.batches
 while(batches>1&&allowance(batches)<APPLY_STEP.nextBatchStatements)batches--
 // A mapped entry has one target effect. Its singleton native read uses all(),
 // so only authorization and publication carry wrapper guards in this window.
 const single=allowance(batches)<APPLY_STEP.nextBatchStatements
 return {...limitStatements(d1RequestContext(context),allowance(batches,single?0:3)),maxBatches:batches,...(single?{batchSize:1}:{})}
}
