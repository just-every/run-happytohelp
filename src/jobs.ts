import {boundedDatabase} from './platform/d1-budget'
import {runWorkflows,workflowEnvironment} from './modules/workflows/runtime'
import {withWorkflowInvocation} from './modules/workflows/invocation'
import {dispatchIntegrations} from './modules/api-integrations/dispatch'
import {advanceImport,getWorkRun} from './modules/move-in/service'
import {generationEffects} from './edition/ai/generation-effects'
import {requestContextModel} from './edition/ai/customer-context-provider'
import {isProjectActive} from './platform/project-status'
import type { Env,Job } from './platform/env'
import { handleGeneration,recoverQueuedGenerations } from './modules/ai-support/service'
import { executeTrainingCase } from './edition/ai/training'
import { consumeJob as consumeKnowledge,refreshDueDatasets } from './modules/knowledge'
import { executeTrainingRun,recoverTrainingRuns } from './modules/training-runs'
import { consumeContextJob,recoverContextJobs } from './modules/customer-context'
import { recoverLocalResultEffects } from './modules/local-computer'
import { localComputerIntegration } from './edition/local-computer'
import { consumeJob as consumeBrand,recoverBrandJobs } from './modules/site-preview/brand'
import { handleLeadJob,recoverLeadJobs } from './modules/integrations'
import { consumeSiteRead,recoverSiteReads } from './modules/management/site-read'
import { applyMessageEffects } from './message-effects'
import { pruneCounters } from './platform/usage-counters'
import type { Actor } from './platform/env'
import {dispatchSurveys} from './modules/outcomes/survey-delivery'

export async function consumeJob(job:Job,env:Env) {
 if(job.type!=='lead.process'&&!await isProjectActive(env,job.projectId))return
 if(job.type==='integrations'){await dispatchIntegrations(env,job.projectId);return}
 if(job.type==='move-in'){const run=await getWorkRun(env,job.id);if(run&&run.project_id===job.projectId)await advanceImport(env,run);return}
 if(await handleGeneration(env,job,generationEffects))return
 if(await consumeKnowledge(job,env))return
 if(await consumeContextJob(job,env,requestContextModel))return
 if(await consumeBrand(job,env))return
 if(await consumeSiteRead(job,env))return
 if(await handleLeadJob(env,job))return
 if(job.type==='training'){
  await executeTrainingRun(env,job.id,executeTrainingCase)
  return
 }
 throw new Error(`Unknown persisted job type: ${job.type}`)
}
/** How long a message's failing follow-up (AI reply request, notification) is retried. */
const OUTBOX_RETRY_MS=60*60*1000
export async function runScheduled(env:Env) {
 const budget=boundedDatabase(env.DB)
 env={...env,DB:budget.database}
 env=withWorkflowInvocation(await workflowEnvironment(env))
 try { await runWorkflows(env) }
 catch(error) { console.error('Workflow run failed',error) }
 try { await dispatchSurveys(env) }
 catch(error) { console.error('Survey dispatch failed',error) }
 await dispatchIntegrations(env)
 const pending=await env.DB.prepare("SELECT project_id,conversation_id,MAX(id) last_id FROM conversation_outbox WHERE delivered_at IS NULL AND EXISTS(SELECT 1 FROM projects p WHERE p.id=conversation_outbox.project_id) AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=conversation_outbox.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL) GROUP BY project_id,conversation_id LIMIT 100").all<{project_id:string;conversation_id:string;last_id:number}>()
 for(const row of pending.results){
  // Recovery shares the invocation with workflows. Leave room for one message's
  // effects and the other recovery consumers; remaining outbox rows stay durable.
  if(budget.statements>=700)break
  if(!await isProjectActive(env,row.project_id))continue
  const messages=await env.DB.prepare('SELECT o.id outbox_id,m.* FROM conversation_outbox o JOIN messages m ON m.id=o.message_id WHERE o.conversation_id=? AND o.id<=? AND o.delivered_at IS NULL ORDER BY o.id LIMIT 90').bind(row.conversation_id,row.last_id).all<Record<string,unknown>>()
  // Each message's effects are independent: one that keeps failing never holds back
  // later messages, and is retried only within the recovery window. (90 rows keeps
  // the delivery update under D1's 100 bound parameters.)
  const done:number[]=[]
  for(const message of messages.results){
   if(budget.statements>=700)break
   const actor:Actor={id:String(message.actor_id),projectId:row.project_id,role:message.actor_role==='contact'?'contact':'operator',...(message.actor_role==='contact'?{contactId:String(message.actor_id)}:{})}
   try { await applyMessageEffects(env,message,actor);done.push(Number(message.outbox_id)) }
   catch {
    if(Date.now()-Number(message.created_at)>OUTBOX_RETRY_MS){console.error('Message follow-up abandoned',String(message.id));done.push(Number(message.outbox_id))}
    else console.error('Message follow-up pending',String(message.id))
   }
  }
  const sent=await env.CONVERSATIONS.get(env.CONVERSATIONS.idFromName(row.conversation_id)).fetch('https://conversation.internal/broadcast',{method:'POST'})
  const projectSent=await env.CONVERSATIONS.get(env.CONVERSATIONS.idFromName(`project:${row.project_id}`)).fetch('https://conversation.internal/broadcast',{method:'POST'})
  if(sent.ok&&projectSent.ok&&done.length)await env.DB.prepare(`UPDATE conversation_outbox SET delivered_at=? WHERE conversation_id=? AND id IN (${done.map(()=>'?').join(',')}) AND delivered_at IS NULL`).bind(Date.now(),row.conversation_id,...done).run()
 }
 await recoverQueuedGenerations(env,generationEffects)
 await refreshDueDatasets(env)
 await recoverContextJobs(env)
 await recoverTrainingRuns(env)
 await recoverLocalResultEffects(env,localComputerIntegration)
 await recoverBrandJobs(env)
 await recoverSiteReads(env)
 await recoverLeadJobs(env)
 await pruneCounters(env)
}
