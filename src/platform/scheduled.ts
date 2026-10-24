import {purgeCampaignData} from '../modules/widget/campaigns/retention'
import {enqueueScheduledReports} from '../modules/reports/schedule-queue'
import type {Env} from './env'
import {boundedDatabase} from './d1-budget'
import {scheduledReservations,scheduledStatementLimit} from './scheduled-budget'
import {runScheduled} from '../jobs'
import {dispatchOperatorNotifications} from '../modules/integrations/notifications'
import {purgeExpiredAudit} from '../modules/audit/retention'

type Consumer='cron'|'notifications'|'reports'|'audit'
/** Serial handoff makes unused reservations spendable without double admission.
 * The outer meter also counts discovery and failures, even when a consumer throws.
 * Each later consumer still gets its turn after a failure in an earlier one. */
export async function runScheduledInvocation(env:Env,options:{now?:number;consumerEnv?:(name:Consumer,env:Env)=>Env}={}){
 const budget=boundedDatabase(env.DB,scheduledStatementLimit),errors:unknown[]=[]
 const run=async(name:Consumer,task:(input:Env)=>Promise<unknown>)=>{
  const input={...env,DB:budget.database}
  try{await task(options.consumerEnv?.(name,input)??input)}catch(error){errors.push(error)}
 }
 await run('cron',runScheduled)
 await run('notifications',input=>dispatchOperatorNotifications(input,{now:options.now,statementLimit:scheduledStatementLimit-budget.statements-scheduledReservations.audit-scheduledReservations.reports}))
 await run('reports',input=>enqueueScheduledReports(input,options.now))
 await run('audit',input=>purgeExpiredAudit(input,options.now,scheduledStatementLimit-budget.statements))
 // Use settled spare credit only; campaign expiry never takes another consumer’s reservation.
 if(scheduledStatementLimit-budget.statements>=2){try{await purgeCampaignData({...env,DB:budget.database},options.now)}catch(error){errors.push(error)}}
 if(errors.length)throw new AggregateError(errors,'Scheduled consumers failed')
 return budget.metrics
}
