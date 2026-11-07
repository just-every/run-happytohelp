import worker from './worker'
import {measuredBindings} from './apply-metrics'
import {seedApplyReplay,compareSelectedReads} from './apply-replay-fixture'
import type {Env} from '../../src/platform/env'
export {ConversationSocket} from '../../src/modules/conversations/socket'

/** Replay-only instrumentation. Other journeys exercise the plain bindings. */
export default {async fetch(request:Request,env:Env,context:ExecutionContext){
 const measured=measuredBindings(env),url=new URL(request.url)
 if(url.pathname==='/_test/apply-replay/seed')return seedApplyReplay(request,measured.env)
 if(url.pathname==='/_test/apply-replay/compare-reads')return compareSelectedReads(measured.env)
 const response=await worker.fetch(request,measured.env,context)
 if(url.pathname==='/_test/queue'){
  const result=await response.json<any>()
  measured.metrics.queueSends+=result.queue.length
  return Response.json({...result,metrics:measured.metrics},{status:response.status,headers:response.headers})
 }
 const headers=new Headers(response.headers)
 measured.metrics.queueSends+=JSON.parse(headers.get('X-Test-Queued')||'[]').length
 headers.set('X-Test-Apply-Metrics',JSON.stringify(measured.metrics))
 return new Response(response.body,{status:response.status,headers})
}}
