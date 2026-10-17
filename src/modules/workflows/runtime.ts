import type {Env} from '../../platform/env'
import {processWorkflowEvents} from './events'
import {runTimeRules} from './rule-engine'
import {runSlaAlerts} from './sla'
import {runWorkflowSchedules} from './schedules'
import {workflowNow,workflowEnvironment} from './clock'
export {workflowEnvironment} from './clock'
export async function runWorkflows(input:Env){
 const env=await workflowEnvironment(input),now=workflowNow(env)
 await processWorkflowEvents(env)
 await runTimeRules(env,now)
 await runWorkflowSchedules(env,now)
 await processWorkflowEvents(env)
 await runSlaAlerts(env,now)
}
