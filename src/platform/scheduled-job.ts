import type {Env,ScheduledJob} from './env'
import {workflowEnvironment} from '../modules/workflows/clock'
import {runScheduledInvocation} from './scheduled'

/** The minute tick's due work, delivered as its own Queue message. Workers Free
 * gives a Cron invocation 10 ms of CPU and a Queue delivery 30 s, so the tick only
 * discovers that work is due and the consumer runs the whole ordered pass. Its
 * statement budget is this delivery's own; only the local clock read precedes it. */
export async function runScheduledJob(job:ScheduledJob,env:Env){
 const discoveryStatements=String(env.H2H_LOCAL)==='true'&&env.H2H_WORKFLOW_NOW===undefined?1:0
 return runScheduledInvocation(await workflowEnvironment(env),{now:Date.now(),maintenance:job.maintenance,discoveryStatements,workflowScope:job.workflowScope})
}
