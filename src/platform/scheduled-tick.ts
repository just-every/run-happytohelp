import type {Env} from './env'
import type {ScheduledOptions} from './scheduled'
import {workflowEnvironment,workflowNow} from '../modules/workflows/clock'
import {hasScheduledWork} from './scheduled-due'

export async function runScheduledTick(env:Env,scheduledTime:number,options:Pick<ScheduledOptions,'now'|'consumerEnv'>={}){
 const now=Date.now(),consumerAt=options.now??now
 // Counter reads and writes already enforce expiry. The orphaned managed-mail
 // transport copies are at least a week old before the sweep can remove them.
 const maintenance=Math.floor(scheduledTime/60000)%15===0
 const discoveryStatements=String(env.H2H_LOCAL)==='true'&&env.H2H_WORKFLOW_NOW===undefined?2:1
 const clock=await workflowEnvironment(env)
 if(await hasScheduledWork(clock,now,workflowNow(clock),maintenance,consumerAt))
  await (await import('./scheduled')).runScheduledInvocation(clock,{...options,now:consumerAt,maintenance,discoveryStatements})
}

export async function scheduledTick(event:ScheduledController,env:Env){
 await runScheduledTick(env,event.scheduledTime)
}
