import type {Env} from '../../platform/env'
import {processWorkflowEvents} from './events'
import {runTimeRules} from './rule-engine'
import {runSlaAlerts} from './sla'
import {runWorkflowSchedules} from './schedules'
import {workflowNow,workflowEnvironment} from './clock'
import {workflowBudget} from './budget'
export {workflowEnvironment} from './clock'
/** Statement shares per cron, phase by phase (a journal event costs about 17, a
 * time-rule ticket about 5). Integrations and the outbox keep the rest. `complete`
 * says whether every finite phase finished its due work in this tick. */
const shares={events:30,time:50,schedules:20,ruleEvents:15,sla:30}
export async function runWorkflows(input:Env){
 const {env,phase,complete}=workflowBudget(await workflowEnvironment(input)),now=workflowNow(env)
 await processWorkflowEvents(env,undefined,20,phase(shares.events))
 await runTimeRules(env,now,phase(shares.time))
 await runWorkflowSchedules(env,now,phase(shares.schedules))
 await processWorkflowEvents(env,undefined,20,phase(shares.ruleEvents))
 await runSlaAlerts(env,now,phase(shares.sla,true))
 return {complete:complete()}
}
