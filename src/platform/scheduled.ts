import {expireReplayCalls} from '../vendor/agent-base/modules/agent-door/index.ts'
import {knowledgeWriteEnvironment} from '../modules/knowledge/write-boundary'
import {purgeCampaignData} from '../modules/widget/campaigns/retention'
import {enqueueScheduledReports} from '../modules/reports/schedule-queue'
import type {Env} from './env'
import {boundedDatabase} from './d1-budget'
import {scheduledReservations,scheduledStatementLimit} from './scheduled-budget'
import {runScheduled} from '../jobs'
import {dispatchOperatorNotifications} from '../modules/integrations/notifications'
import {purgeExpiredAudit} from '../modules/audit/retention'
import {drainTeammateSlack,noticeCost} from '../modules/integrations/teammate-slack'
import {drainTeammateTeams,teamsNoticeCost} from '../modules/integrations/teammate-teams'

type Consumer='cron'|'notifications'|'reports'|'audit'
export interface ScheduledOptions {now?:number;maintenance?:boolean;discoveryStatements?:number;workflowScope?:'all'|'time'|null;consumerEnv?:(name:Consumer,env:Env)=>Env}
/** Serial handoff makes unused reservations spendable without double admission.
 * The outer meter also counts discovery and failures, even when a consumer throws.
 * Each later consumer still gets its turn after a failure in an earlier one. */
export async function runScheduledInvocation(env:Env,options:ScheduledOptions={}){
 env=knowledgeWriteEnvironment(env,()=>({}))
 const limit=scheduledStatementLimit-(options.discoveryStatements??0)
 const budget=boundedDatabase(env.DB,limit),errors:unknown[]=[]
 const run=async(name:Consumer,task:(input:Env)=>Promise<unknown>)=>{
  const input={...env,DB:budget.database}
  try{await task(options.consumerEnv?.(name,input)??input)}catch(error){errors.push(error)}
 }
 await run('cron',input=>runScheduled(input,options.maintenance,options.discoveryStatements,options.workflowScope))
 await run('notifications',input=>dispatchOperatorNotifications(input,{now:options.now,statementLimit:limit-budget.statements-scheduledReservations.audit-scheduledReservations.reports}))
 await run('reports',input=>enqueueScheduledReports(input,options.now))
 await run('audit',input=>purgeExpiredAudit(input,options.now,limit-budget.statements))
 // Use settled spare credit only; campaign expiry never takes another consumer’s reservation.
 if(limit-budget.statements>=2){try{await purgeCampaignData({...env,DB:budget.database},options.now)}catch(error){errors.push(error)}}
 if(limit-budget.statements>=1){try{await expireReplayCalls({options:{db:budget.database},now:()=>options.now??Date.now()})}catch(error){errors.push(error)}}
 // Personal Slack notices spend only what the consumers above left unused.
 if(limit-budget.statements>=noticeCost){try{await drainTeammateSlack({...env,DB:budget.database},{now:options.now,room:()=>limit-budget.statements})}catch(error){errors.push(error)}}
 if(limit-budget.statements>=teamsNoticeCost){try{await drainTeammateTeams({...env,DB:budget.database},{now:options.now,room:()=>limit-budget.statements})}catch(error){errors.push(error)}}
 if(errors.length)throw new AggregateError(errors,'Scheduled consumers failed')
 return budget.metrics
}
