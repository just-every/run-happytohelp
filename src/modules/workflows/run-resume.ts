import type {Env} from '../../platform/env'
import {executeRuleRun} from './rule-run'
import type {Spent} from './budget'
/** Interrupted and waiting runs resume once their retry time comes, the oldest due
 * first and one per workspace per tick. Local actions and notify claims each hold a
 * permanent receipt, so resuming never repeats an effect; failed and uncertain runs
 * are never resumed. */
const dueRuns=`SELECT id FROM (SELECT id,coalesce(next_attempt_at,updated_at) due,row_number() OVER (PARTITION BY project_id ORDER BY coalesce(next_attempt_at,updated_at),id) turn FROM workflow_runs WHERE state IN ('running','pending') AND coalesce(next_attempt_at,0)<=?1 AND coalesce(lease_until,0)<=?1) WHERE turn=1 ORDER BY due,id LIMIT 5`
export async function resumeRuleRuns(env:Env,now:number,spent?:Spent){
 const runs=await env.DB.prepare(dueRuns).bind(now).all<{id:string}>()
 for(const run of runs.results){if(spent?.())return;await executeRuleRun(env,run.id)}
}
