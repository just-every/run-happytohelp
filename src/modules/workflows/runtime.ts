import type {Env} from '../../platform/env'
import {processWorkflowEvents} from './events'
import {processGeneratedEvents} from './event-batch'
import {runTimeRules} from './time-rules'
import {resumeRuleRuns} from './run-resume'
import {runDueSla} from './sla-due'
import {deliverSlaAlerts} from './sla-alerts'
import {runSlaBackstop} from './sla-backstop'
import {runWorkflowSchedules} from './schedules'
import {workflowNow,workflowEnvironment} from './clock'
import {workflowBudget} from './budget'
import {withWorkflowInvocation} from './invocation'
export {workflowEnvironment} from './clock'
/** Phase thresholds stop admission of another quantum. Journal quanta have a hard
 * 45-statement bound, rule actions 80, scheduled sends 160 and SLA notices 45. Integrations and the outbox keep the rest. Due time-rule
 * tickets are scanned before waiting runs resume, and each has its own share, so
 * neither can starve the other. `complete` says whether every finite phase finished
 * its due work in this tick. */
const shares={events:30,time:40,resume:15,schedules:20,ruleEvents:15,slaDue:30,slaDelivery:10,slaBackstop:10}
export async function runWorkflows(input:Env){
 const {env,phase,complete}=workflowBudget(withWorkflowInvocation(await workflowEnvironment(input))),now=workflowNow(env)
 let failed=false
 const visit=async(share:number,run:(spent:()=>boolean)=>Promise<unknown>,rolling=false)=>{const spent=phase(share,rolling);try{await run(spent)}catch(error){failed=true;console.error('Workflow phase failed',error)}spent()}
 await visit(shares.events,spent=>processWorkflowEvents(env,undefined,20,spent))
 await visit(shares.time,spent=>runTimeRules(env,now,spent))
 await visit(shares.resume,spent=>resumeRuleRuns(env,now,spent))
 await visit(shares.schedules,spent=>runWorkflowSchedules(env,now,spent))
 await visit(shares.ruleEvents,async spent=>{await processWorkflowEvents(env,undefined,20,spent);await processGeneratedEvents(env,now)})
 await visit(shares.slaDue,spent=>runDueSla(env,now,spent))
 await visit(shares.slaDelivery,spent=>deliverSlaAlerts(env,now,spent))
 await visit(shares.slaBackstop,spent=>runSlaBackstop(env,now,spent),true)
 return {complete:!failed&&complete()}
}
