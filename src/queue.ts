import {knowledgeWriteEnvironment} from './modules/knowledge/write-boundary'
import {consumeTicketContinuation} from './modules/tickets/continuation'
import type {Env,Job,LegacyCleanupJob} from './platform/env'
import {boundedDatabase,queueStatements} from './platform/d1-budget'
import {consumeJob} from './jobs'
import {withWorkflowInvocation} from './modules/workflows/invocation'
export async function consumeQueue(batch:MessageBatch<Job|LegacyCleanupJob>,env:Env){
 const budget=boundedDatabase(env.DB,queueStatements.limit,queueStatements.reserve)
 env=withWorkflowInvocation({...env,DB:budget.database})
 for(const message of batch.messages){
  const job=message.body
  try{
   // Tombstone cleanup has no native workspace/session capability and must not
   // acquire the ordinary knowledge-write boundary or project activity guard.
   if(job.type==='legacy-package.cleanup'||job.type==='rehearsal.cleanup'){await consumeJob(job,env);message.ack();continue}
   if(!('projectId' in job))throw new Error('Unsupported persisted job')
   const jobEnv=job.type==='knowledge.upgrade'?env:knowledgeWriteEnvironment(env,()=>({projectId:job.projectId}))
   if(!await consumeTicketContinuation(job,jobEnv))await consumeJob(job,jobEnv)
   message.ack()
  }catch{console.error('Persisted job handler failed',job.type,job.id);message.retry()}
 }
 return budget.metrics
}
