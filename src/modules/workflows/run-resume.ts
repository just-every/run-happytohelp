import type {Env} from '../../platform/env'
import {executeRuleRun} from './rule-run'
import type {Spent} from './budget'
/** Interrupted and waiting runs resume once their retry time comes, the least
 * recently served workspace first and one per workspace per tick. Local actions and notify claims each hold a
 * permanent receipt, so resuming never repeats an effect; failed and uncertain runs
 * are never resumed. */
const dueRuns=`SELECT id FROM (SELECT r.id,r.project_id,coalesce(r.next_attempt_at,r.updated_at) due,coalesce(q.turn,0) served,row_number() OVER (PARTITION BY r.project_id ORDER BY coalesce(r.next_attempt_at,r.updated_at),r.id) workspace_turn FROM workflow_runs r LEFT JOIN workflow_queue_turns q ON q.queue='rule-runs' AND q.project_id=r.project_id WHERE r.state IN ('running','pending') AND coalesce(r.next_attempt_at,0)<=?1 AND coalesce(r.lease_until,0)<=?1) WHERE workspace_turn=1 ORDER BY served,due,project_id,id LIMIT 5`
export async function resumeRuleRuns(env:Env,now:number,spent?:Spent){
 const runs=await env.DB.prepare(dueRuns).bind(now).all<{id:string}>()
 for(const run of runs.results){if(spent?.())return;await executeRuleRun(env,run.id,spent)}
}
