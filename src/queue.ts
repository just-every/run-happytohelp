import type {Env,Job} from './platform/env'
import {boundedDatabase} from './platform/d1-budget'
import {consumeJob} from './jobs'
import {withWorkflowInvocation} from './modules/workflows/invocation'
// Twenty statements stay back so a job that exhausts the invocation can still record its failure.
export async function consumeQueue(batch:MessageBatch<Job>,env:Env){const budget=boundedDatabase(env.DB,1000,20);env=withWorkflowInvocation({...env,DB:budget.database});for(const message of batch.messages){try{await consumeJob(message.body,env);message.ack()}catch{console.error('Persisted job handler failed',message.body.type,message.body.id);message.retry()}}return budget.metrics}
