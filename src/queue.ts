import {knowledgeWriteEnvironment} from './modules/knowledge/write-boundary'
import {consumeTicketContinuation} from './modules/tickets/continuation'
import type {Env,Job,LegacyCleanupJob,ScheduledJob} from './platform/env'
import {boundedDatabase,queueStatements} from './platform/d1-budget'
import {consumeJob} from './jobs'
import {runScheduledJob} from './platform/scheduled-job'
import {withWorkflowInvocation} from './modules/workflows/invocation'
export async function consumeQueue(batch:MessageBatch<Job|LegacyCleanupJob|ScheduledJob>,env:Env){
 const scheduled=env,budget=boundedDatabase(env.DB,queueStatements.limit,queueStatements.reserve)
 env=withWorkflowInvocation({...env,DB:budget.database})
 for(const message of batch.messages){
  const job=message.body
  // A tick's work keeps its own statement budget. A failed pass is not retried:
  // the next minute's tick discovers whatever is still due, as a failed Cron did.
  if(job.type==='scheduled.tick'){try{await runScheduledJob(job as ScheduledJob,scheduled)}catch(error){console.error('Scheduled work failed',job.id,error)}message.ack();continue}
  try{
   // Tombstone cleanup has no native workspace/session capability and must not
   // acquire the ordinary knowledge-write boundary or project activity guard.
   if(job.type==='legacy-package.cleanup'){await consumeJob(job,env);message.ack();continue}
   if(!('projectId' in job))throw new Error('Unsupported persisted job')
   const jobEnv=job.type==='knowledge.upgrade'?env:knowledgeWriteEnvironment(env,()=>({projectId:job.projectId}))
   if(!await consumeTicketContinuation(job,jobEnv))await consumeJob(job,jobEnv)
   message.ack()
  }catch{console.error('Persisted job handler failed',job.type,job.id);message.retry()}
 }
 return budget.metrics
}
