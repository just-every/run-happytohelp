import type {Env} from './env'
import {workflowEnvironment,workflowNow} from '../modules/workflows/clock'
import {rerMail} from '../modules/integrations/rer-mail-contract'
import {expireRerMailOrphans} from '../modules/integrations/rer-mail-retention'
import {scheduledWork} from './scheduled-due'
import {pruneCounters} from './scheduled-recovery'

export async function scheduledTick(event:ScheduledController,env:Env){
 const now=Date.now(),minute=Math.floor(event.scheduledTime/60000)
 const maintenance=minute%15===0
 const discoveryStatements=String(env.H2H_LOCAL)==='true'&&env.H2H_WORKFLOW_NOW===undefined?2:1
 const clock=await workflowEnvironment(env)
 const {work,counters}=await scheduledWork(clock,now,workflowNow(clock),minute)
 if(work){
  await (await import('./scheduled')).runScheduledInvocation(clock,{now,maintenance,discoveryStatements})
  return
 }
 if(counters)await pruneCounters(clock,now)
 // Orphaned transport copies are at least a week old. The bounded bucket list
 // also covers copies whose process died before committing any database row.
 if(maintenance&&rerMail(clock))await expireRerMailOrphans(clock)
}
