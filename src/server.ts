// Install the demo's effect guard before loading any event handlers.
import {withDemo} from './vendor/base/modules/demo/index.mjs'
import type {Env,Job} from './platform/env'
import {scheduledTick} from './platform/scheduled-tick'
import {deliverJobs} from './platform/job-door'
import {ConversationSocket as Socket} from './modules/conversations/socket'
import {originalRequest,dispatchDoor} from './modules/conversations/dispatch-door'
import {fetchEntry} from './modules/conversations/request-dispatch'

// Only the built application entry has Start's renderer. The socket and HTTP API
// can run on their own without loading the frontend's build manifest.
export class ConversationSocket extends Socket {
 async fetch(request:Request){
  if(request.url!==dispatchDoor)return super.fetch(request)
  const {fetchRequest}=await import('./server-fetch')
  const execution={waitUntil:(work:Promise<unknown>)=>this.ctx.waitUntil(work),passThroughOnException(){}} as ExecutionContext
  return fetchRequest(originalRequest(request),this.env,execution)
 }
}

export default withDemo({
 fetch:fetchEntry,
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
