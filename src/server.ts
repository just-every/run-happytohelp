// Install the demo's effect guard before loading any event handlers.
import {withDemo} from './vendor/base/modules/demo/index.mjs'
import type {Env,Job} from './platform/env'
import {scheduledTick} from './platform/scheduled-tick'
import {deliverJobs} from './platform/job-door'
export {ConversationSocket} from './modules/conversations/socket'

export default withDemo({
 async fetch(request:Request,env:Env,execution:ExecutionContext){
  return (await import('./server-fetch')).fetchRequest(request,env,execution)
 },
 async queue(batch:MessageBatch<Job>,env:Env){
  await deliverJobs(batch,env)
 },
 scheduled:scheduledTick,
 async email(message:ForwardableEmailMessage,env:Env,execution:ExecutionContext){
  await (await import('./modules/conversation-actions/partner-gateway')).handleEmail(message,env,execution)
 },
} satisfies ExportedHandler<Env,Job>,{
 seed:async(...args:Parameters<typeof import('./demo').seedDemo>)=>(await import('./demo')).seedDemo(...args),
 owner:async(...args:Parameters<typeof import('./demo').demoOwner>)=>(await import('./demo')).demoOwner(...args),
})
