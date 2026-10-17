import type {Env} from '../../platform/env'
import {processWorkflowEvents} from './events'
import {runTimeRules} from './time-rules'
import {resumeRuleRuns} from './run-resume'
import {runDueSla} from './sla-due'
import {deliverSlaAlerts} from './sla-alerts'
import {runSlaBackstop} from './sla-backstop'
import {runWorkflowSchedules} from './schedules'
import {workflowNow,workflowEnvironment} from './clock'
import {workflowBudget} from './budget'
export {workflowEnvironment} from './clock'
/** Statement shares per cron, phase by phase (a journal event costs about 17, a
 * time-rule ticket about 5). Integrations and the outbox keep the rest. Due time-rule
 * tickets are scanned before waiting runs resume, and each has its own share, so
 * neither can starve the other. `complete` says whether every finite phase finished
 * its due work in this tick. */
const shares={events:30,time:40,resume:15,schedules:20,ruleEvents:15,slaDue:30,slaDelivery:10,slaBackstop:10}
export async function runWorkflows(input:Env){
 const {env,phase,complete}=workflowBudget(await workflowEnvironment(input)),now=workflowNow(env)
 await processWorkflowEvents(env,undefined,20,phase(shares.events))
 await runTimeRules(env,now,phase(shares.time))
 await resumeRuleRuns(env,now,phase(shares.resume))
 await runWorkflowSchedules(env,now,phase(shares.schedules))
 await processWorkflowEvents(env,undefined,20,phase(shares.ruleEvents))
 await runDueSla(env,now,phase(shares.slaDue))
 await deliverSlaAlerts(env,now,phase(shares.slaDelivery))
 await runSlaBackstop(env,now,phase(shares.slaBackstop,true))
 return {complete:complete()}
}
