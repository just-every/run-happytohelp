import type {Env} from './env'
import {workflowEnvironment,workflowNow} from '../modules/workflows/clock'
import {rerMail} from '../modules/integrations/rer-mail-contract'
import {expireRerMailOrphans} from '../modules/integrations/rer-mail-retention'
import {scheduledWork} from './scheduled-due'
import {pruneCounters} from './scheduled-recovery'

/** One discovery query decides the minute. Due work goes to the Queue as one
 * scheduled job (platform/scheduled-job), so the Cron invocation stays a thin
 * dispatch inside Workers Free's 10 ms CPU; an idle minute keeps its cheap prunes here. */
export async function scheduledTick(event:ScheduledController,env:Env){
 const now=Date.now(),minute=Math.floor(event.scheduledTime/60000)
 const maintenance=minute%15===0
 const clock=await workflowEnvironment(env)
 const {work,counters}=await scheduledWork(clock,now,workflowNow(clock),minute)
 if(work){
  await env.JOBS.send({type:'scheduled.tick',id:String(minute),maintenance,workflowScope:work===1?null:work})
  return
 }
 if(counters)await pruneCounters(clock,now)
 // Orphaned transport copies are at least a week old. The bounded bucket list
 // also covers copies whose process died before committing any database row.
 if(maintenance&&rerMail(clock))await expireRerMailOrphans(clock)
}
