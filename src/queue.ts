import {knowledgeWriteEnvironment} from './modules/knowledge/write-boundary'
import {consumeTicketContinuation} from './modules/tickets/continuation'
import type {Env,Job,LegacyCleanupJob} from './platform/env'
import {boundedDatabase,queueStatements} from './platform/d1-budget'
import {consumeJob} from './jobs'
import {withWorkflowInvocation} from './modules/workflows/invocation'
export async function consumeQueue(batch:MessageBatch<Job | LegacyCleanupJob>,env:Env){const budget=boundedDatabase(env.DB,queueStatements.limit,queueStatements.reserve);env=withWorkflowInvocation({...env,DB:budget.database});for(const message of batch.messages){try{if(message.body.type==='legacy-package.cleanup'){await consumeJob(message.body,env);message.ack();continue}if(!('projectId' in message.body))throw new Error('Unsupported persisted job');const jobEnv=message.body.type==='knowledge.upgrade'?env:knowledgeWriteEnvironment(env,()=>({projectId:message.body.projectId}));if(!await consumeTicketContinuation(message.body,jobEnv))await consumeJob(message.body,jobEnv);message.ack()}catch{console.error('Persisted job handler failed',message.body.type,message.body.id);message.retry()}}return budget.metrics}
