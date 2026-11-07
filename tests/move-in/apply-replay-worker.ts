import {testFetch} from './worker'
import {measuredBindings} from './apply-metrics'
import {seedApplyReplay,compareSelectedReads} from './apply-replay-fixture'
import type {Env} from '../../src/platform/env'
export {ConversationSocket} from '../../src/modules/conversations/socket'

/** Replay-only instrumentation. Other journeys exercise the plain bindings. */
export default {async fetch(request:Request,env:Env,context:ExecutionContext){
 const measured=measuredBindings(env),url=new URL(request.url)
 if(url.pathname==='/_test/apply-replay/seed')return seedApplyReplay(request,measured.env)
 if(url.pathname==='/_test/apply-replay/compare-reads')return compareSelectedReads(measured.env)
 return testFetch(request,measured.env,context,measured.metrics)
}}
