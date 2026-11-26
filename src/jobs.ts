import {cleanupCopyIntents} from './modules/legacy-import/worker/canonical-custody'
import {CUSTODY_JOB,cleanupStep,discoverCleanup,getCustody} from './modules/legacy-import/custody'
import type {LegacyCleanupJob} from './platform/env'
import {advanceLegacy} from './modules/legacy-import/worker/runner'
import {discover as discoverLegacy} from './modules/legacy-import/worker/fence'
import {LEGACY_JOB} from './modules/legacy-import/worker-contract'
import {remindObligations} from './modules/ai-support/obligations'
import {expireVoiceMedia} from './modules/voice/media'
import {canonicaliseExistingProject} from './modules/knowledge/upgrade'
import {updateKnowledgeIndex} from './modules/knowledge/canonicaliser'
import {dispatchKnowledgeUpgrades} from './modules/knowledge/upgrade-progress'
import {sweepUploads} from './modules/api-integrations/upload-lifecycle'
import {processRerMailbox,recoverRerMailboxes,refreshRerMailbox} from './modules/integrations/rer-mailbox'
import {LEGACY_MAIL_S3_JOB,processLegacyMailS3,recoverLegacyMailS3} from './modules/integrations/legacy-mail-s3'
import {expireLegacyMailS3Raw} from './modules/integrations/rer-mail-retention'
import {consumeTriage,dispatchTriage} from './modules/triage/worker'
import {dispatchScheduledReports} from './modules/reports/schedule-dispatch'
import {recoverTicketContinuations} from './modules/tickets/continuation'
import {cronConsumer,CronDeferred} from './platform/cron-budget'
import {dispatchOutbox,recoverOutbox,recoverOutboxPage} from './outbox-recovery'
import {boundedDatabase} from './platform/d1-budget'
import {pruneCounters,scheduledRecoveryWork} from './platform/scheduled-recovery'
import {scheduledReservations} from './platform/scheduled-budget'
import {scheduledWorkflowWork} from './modules/workflows/scheduled-work'
import {runWorkflows,workflowEnvironment} from './modules/workflows/runtime'
import {withWorkflowInvocation} from './modules/workflows/invocation'
import {dispatchIntegrations} from './modules/api-integrations/dispatch'
import {advanceImport,getWorkRun} from './modules/move-in/service'
import {advancePull} from './modules/move-in/zendesk-source/job'
import {PULL_JOB} from './modules/move-in/zendesk-source/notify'
import {advanceAttachments} from './modules/move-in/zendesk-attachments/job'
import {ATTACHMENTS_JOB} from './modules/move-in/zendesk-attachments/store'
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
import {dispatchSurveys,hasScheduledSurveyWork} from './modules/outcomes/survey-delivery'

export async function consumeJob(job:Job|LegacyCleanupJob,env:Env) {
 if(job.type===CUSTODY_JOB){if(/^[0-9a-f]{64}$/.test(job.id)&&Number.isSafeInteger(job.generation)){const c=await getCustody(env.DB,job.id);if(!c||c.generation!==job.generation||!['invalidated','purging','purged'].includes(c.status))return;const step=await cleanupStep(env,job.id,Number(job.generation));await cleanupCopyIntents(env,job.id,250-step.rows)};return}
 if(!('projectId' in job))return
 if(job.type==='knowledge.upgrade'){await canonicaliseExistingProject(env,job.projectId);await dispatchKnowledgeUpgrades(env);return}
 if(job.type==='rer.mailbox.status'){await refreshRerMailbox(env,job.projectId);return}
 if(job.type==='rer.mailbox'){await processRerMailbox(env,job.projectId);return}
 // Queued before any workspace is known: the receipt names the object, and the reader finds the workspace from its mailbox.
 if(job.type===LEGACY_MAIL_S3_JOB){await processLegacyMailS3(env,job.id);return}
 if(job.type==='reports.schedule'){await dispatchScheduledReports(env);return}
 if(job.type==='outbox.page'){if(!Number.isSafeInteger(job.lastId))throw new Error('Invalid persisted outbox page');await recoverOutboxPage(env,{project_id:job.projectId,conversation_id:job.id,last_id:Number(job.lastId)});return}
 if(job.type==='local.effects'){await recoverLocalResultEffects(env,localComputerIntegration,job.id);return}
 if(job.type==='outbox.recover'){if(typeof job.conversationId!=='string'||!Number.isSafeInteger(job.outboxId))throw new Error('Invalid persisted outbox job');await recoverOutbox(env,job.projectId,job.conversationId,Number(job.outboxId),job.id,job.visitorChat===true);return}
 if(job.type!=='lead.process'&&!await isProjectActive(env,job.projectId))return
 if(job.type===LEGACY_JOB){await advanceLegacy(env,job);return}
 if(job.type==='integrations'){await dispatchIntegrations(env,job.projectId);return}
 // A step that lands articles leaves the copied-text index current, so a read (which never refreshes it) and the next write find it ready.
 if(job.type==='move-in'){const run=await getWorkRun(env,job.id);if(run&&run.project_id===job.projectId){await advanceImport(env,run);await updateKnowledgeIndex(env,job.projectId,100)}return}
 if(job.type===PULL_JOB){await advancePull(env,job.id,job.projectId);await updateKnowledgeIndex(env,job.projectId,100);return}
 if(job.type===ATTACHMENTS_JOB){await advanceAttachments(env,job.id,job.projectId);return}
 if(await consumeTriage(job,env))return
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
 * maximum (720), tail allocations (220) request 940; the outer jobs ceiling is 937, including the local clock read.
 * The other parallel scheduled consumers reserve the remaining 63 statements. */
export async function runScheduled(env:Env,maintenance=true,discoveryStatements=0,workflowScope?:'all'|'time'|null) {
 const jobLimit=scheduledReservations.jobs-discoveryStatements
 const budget=boundedDatabase(env.DB,jobLimit)
 env=withWorkflowInvocation(await workflowEnvironment({...env,DB:budget.database}))
 let allocated=0
 const visit=async(name:string,share:number,run:(env:Env)=>Promise<unknown>,{ceiling=Infinity,needed=true}={})=>{
  allocated+=share
  if(!needed)return
  // Unused earlier credit is available, but every later allocation stays reserved.
  const available=Math.min(allocated-budget.statements,Math.max(3,ceiling-budget.statements))
  try{await run(cronConsumer(env,available))}catch(error){if(!(error instanceof CronDeferred))console.error(`${name} recovery failed`,error)}
 }
 await visit('Workflow',720,async env=>{const scope=workflowScope===undefined?await scheduledWorkflowWork(env):workflowScope;if(scope)await runWorkflows(env,scope)})
 await visit('Survey',70,async env=>{if(await hasScheduledSurveyWork(env))await dispatchSurveys(env)})
 // The Amazon SES reader's private copies expire every tick, whether or not the reader is configured.
 await visit('Integration',58,async env=>{await sweepUploads(env);await dispatchIntegrations(env);await recoverRerMailboxes(env,maintenance);await recoverLegacyMailS3(env);await expireLegacyMailS3Raw(env)})
 await visit('Voice media',2,expireVoiceMedia)
 // Hand larger message effects to the queue near the history-load target.
 // The hard consumer allocation still reserves every later recovery and prune.
 await visit('Outbox',3,dispatchOutbox,{ceiling:700})
 await visit('Generation',10,async env=>{await remindObligations(env);await recoverQueuedGenerations(env,generationEffects);await dispatchTriage(env)})
 await visit('Knowledge',15,async env=>{await dispatchKnowledgeUpgrades(env,2);await refreshDueDatasets(env)})
 let recovery:Awaited<ReturnType<typeof scheduledRecoveryWork>>|undefined
 try{recovery=await scheduledRecoveryWork(env)}catch(error){console.error('Job recovery discovery failed',error)}
 await visit('Context',5,recoverContextJobs,{needed:!recovery||Boolean(recovery.context)})
 await visit('Ticket continuation',1,recoverTicketContinuations,{needed:!recovery||Boolean(recovery.tickets)})
 await visit('Training',25,recoverTrainingRuns,{needed:!recovery||Boolean(recovery.training)})
 await visit('Local result',5,env=>recoverLocalResultEffects(env,localComputerIntegration),{needed:!recovery||Boolean(recovery.local)})
 await visit('Brand',6,recoverBrandJobs,{needed:!recovery||Boolean(recovery.brand)})
 await visit('Site read',7,recoverSiteReads,{needed:!recovery||Boolean(recovery.site)})
 await visit('Lead',12,recoverLeadJobs)
 await visit('Counter',1,pruneCounters)
 // Discovery consumes only unused jobs credit, after all existing reservations.
 const legacyRoom=jobLimit-budget.statements
 if(legacyRoom>=26)await discoverCleanup(cronConsumer(env,24),1)
 if(jobLimit-budget.statements>=2)await discoverLegacy(cronConsumer(env,2))
}
