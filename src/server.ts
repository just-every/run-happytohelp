// Install the demo's effect guard before loading any event handlers.
import {withDemo} from './vendor/base/modules/demo/index.mjs'
import type {Env,Job} from './platform/env'
import {DurableObject} from 'cloudflare:workers'
import {deliverJobs} from './platform/job-door'
import type {ConversationSocket as Socket} from './modules/conversations/socket'
import {originalRequest,dispatchDoor} from './modules/conversations/dispatch-door'
import {fetchEntry} from './modules/conversations/request-dispatch'

// Export the existing class name without evaluating socket authorization, presence or Start in the HTTP Worker.
export class ConversationSocket extends DurableObject<Env> {
 private socketInstance?:Promise<Socket>
 private socket(){
  return this.socketInstance??=import('./modules/conversations/socket').then(({ConversationSocket})=>new ConversationSocket(this.ctx,this.env))
 }
 async alarm(){return (await this.socket()).alarm()}
 async webSocketMessage(ws:WebSocket,message:string|ArrayBuffer){return (await this.socket()).webSocketMessage(ws,message)}
 async webSocketClose(ws:WebSocket,code:number,reason:string){return (await this.socket()).webSocketClose(ws,code,reason)}
 async webSocketError(ws:WebSocket){return (await this.socket()).webSocketError(ws)}
 async fetch(request:Request){
  if(request.url!==dispatchDoor)return (await this.socket()).fetch(request)
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
 async scheduled(event:ScheduledController,env:Env){
  await (await import('./platform/scheduled-tick')).scheduledTick(event,env)
 },
 async email(message:ForwardableEmailMessage,env:Env,execution:ExecutionContext){
  await (await import('./modules/conversation-actions/partner-gateway')).handleEmail(message,env,execution)
 },
} satisfies ExportedHandler<Env,Job>,{
 seed:async(...args:Parameters<typeof import('./demo').seedDemo>)=>(await import('./demo')).seedDemo(...args),
 owner:async(...args:Parameters<typeof import('./demo').demoOwner>)=>(await import('./demo')).demoOwner(...args),
})
