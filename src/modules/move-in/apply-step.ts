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
 *   move-in statements around it      16 (project, run, authority, claim, keys, batch, checks, checkpoint)
 *   wrapper statements, 7 calls max   49 (authorize, then a read set and a write per transaction)
 *   allowance for the kit            895 -> 980 - 16 - 49 - 20 spare */
export const APPLY_STEP={batches:3,statements:queueStatements.limit-queueStatements.reserve-16-49-20} as const
export const applyStep=(context:D1ImportContext):D1ImportContext=>({...limitStatements(d1RequestContext(context),APPLY_STEP.statements),maxBatches:APPLY_STEP.batches})
