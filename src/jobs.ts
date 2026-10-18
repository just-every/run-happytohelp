import {cronConsumer,CronDeferred} from './platform/cron-budget'
import {dispatchOutbox,recoverOutbox,recoverOutboxPage} from './outbox-recovery'
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
import { pruneCounters } from './platform/usage-counters'
import {dispatchSurveys} from './modules/outcomes/survey-delivery'

export async function consumeJob(job:Job,env:Env) {
 if(job.type==='outbox.page'){if(!Number.isSafeInteger(job.lastId))throw new Error('Invalid persisted outbox page');await recoverOutboxPage(env,{project_id:job.projectId,conversation_id:job.id,last_id:Number(job.lastId)});return}
 if(job.type==='local.effects'){await recoverLocalResultEffects(env,localComputerIntegration,job.id);return}
 if(job.type==='outbox.recover'){if(typeof job.conversationId!=='string'||!Number.isSafeInteger(job.outboxId))throw new Error('Invalid persisted outbox job');await recoverOutbox(env,job.projectId,job.conversationId,Number(job.outboxId),job.id);return}
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
/** Each consumer owns a bounded allocation, including its admitted quantum.
 * An exception in one never takes away another consumer's turn. The workflow
 * maximum (720), tail allocations (220) total 940, including the local clock read. */
export async function runScheduled(env:Env) {
 const budget=boundedDatabase(env.DB)
 env=withWorkflowInvocation(await workflowEnvironment({...env,DB:budget.database}))
 let allocated=0
 const visit=async(name:string,share:number,run:(env:Env)=>Promise<unknown>,ceiling=Infinity)=>{
  allocated+=share
  // Unused earlier credit is available, but every later allocation stays reserved.
  const available=Math.min(allocated-budget.statements,Math.max(3,ceiling-budget.statements))
  try{await run(cronConsumer(env,available))}catch(error){if(!(error instanceof CronDeferred))console.error(`${name} recovery failed`,error)}
 }
 await visit('Workflow',720,runWorkflows)
 await visit('Survey',70,dispatchSurveys)
 await visit('Integration',60,dispatchIntegrations)
 // Hand larger message effects to the queue near the history-load target.
 // The hard consumer allocation still reserves every later recovery and prune.
 await visit('Outbox',3,dispatchOutbox,700)
 await visit('Generation',10,env=>recoverQueuedGenerations(env,generationEffects))
 await visit('Knowledge',15,refreshDueDatasets)
 await visit('Context',6,recoverContextJobs)
 await visit('Training',25,recoverTrainingRuns)
 await visit('Local result',5,env=>recoverLocalResultEffects(env,localComputerIntegration))
 await visit('Brand',6,recoverBrandJobs)
 await visit('Site read',7,recoverSiteReads)
 await visit('Lead',12,recoverLeadJobs)
 await visit('Counter',1,pruneCounters)
}
