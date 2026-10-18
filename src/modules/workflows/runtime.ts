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
/** Admission thresholds total 500. Schedules stop at 460, then at most one
 * 155-statement reply, one selection, one recovery write and a 14-statement SLA
 * batch finish: <=631. Time rules admit at 500 with an 80-statement run plus
 * their bounded planning/cursor writes. Cron reserves a 650-statement envelope. */
const shares={events:30,ruleEvents:15,slaDue:30,slaDelivery:10,slaBackstop:10,resume:65,schedules:300,time:40}
export async function runWorkflows(input:Env){
 const {env,phase,complete}=workflowBudget(withWorkflowInvocation(await workflowEnvironment(input))),now=workflowNow(env)
 let failed=false
 const visit=async(share:number,run:(spent:()=>boolean)=>Promise<unknown>,rolling=false)=>{const spent=phase(share,rolling);try{if(!spent())await run(spent)}catch(error){failed=true;console.error('Workflow phase failed',error)}spent()}
 await visit(shares.slaDue,spent=>runDueSla(env,now,spent))
 await visit(shares.slaDelivery,spent=>deliverSlaAlerts(env,now,spent))
 await visit(shares.slaBackstop,spent=>runSlaBackstop(env,now,spent),true)
 await visit(shares.events,spent=>processWorkflowEvents(env,undefined,20,spent))
 await visit(shares.ruleEvents,async spent=>{await processWorkflowEvents(env,undefined,20,spent);if(!spent())await processGeneratedEvents(env,now)})
 await visit(shares.resume,spent=>resumeRuleRuns(env,now,spent))
 await visit(shares.schedules,spent=>runWorkflowSchedules(env,now,spent))
 await visit(shares.time,spent=>runTimeRules(env,now,spent))
 return {complete:!failed&&complete()}
}
