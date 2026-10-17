import {app} from '../../../src/app'
import {consumeQueue} from '../../../src/queue'
import {runScheduled} from '../../../src/jobs'
import {dispatchOperatorNotifications} from '../../../src/modules/integrations/notifications'
import {purgeExpiredAudit} from '../../../src/modules/audit/retention'
import {routeRule} from '../../../src/modules/access/route-permissions'
import {handleEmail} from '../../../src/modules/integrations'
import type {Env} from '../../../src/platform/env'
export {ConversationSocket} from '../../../src/modules/conversations/socket'

// The real application router over real D1/R2/Durable Objects. With
// H2H_TEST_CAPTURE_QUEUE, queued jobs wait for the test to run them, so a test
// controls when background work happens; otherwise the Miniflare queue runs them.
const captured:unknown[]=[]
const bindings=(env:Env):Env=>env.H2H_TEST_CAPTURE_QUEUE?{...env,JOBS:{send:async(job:unknown)=>{captured.push(job)},sendBatch:async(batch:{body:unknown}[])=>{captured.push(...batch.map(item=>item.body))}} as unknown as Env['JOBS']}:env
// Storage faults for one request, named by test-only headers. x-test-before-batch
// and x-test-after-batch run a real D1 write around each atomic batch, as a
// concurrent request would; x-test-fault fails D1 or R2 before or after commit,
// or makes the queue refuse (queue-unavailable) or silently lose (queue-lost) sends.
const faulted=(request:Request,env:Env):Env=>{
 const before=request.headers.get('x-test-before-batch'),after=request.headers.get('x-test-after-batch'),fault=request.headers.get('x-test-fault')
 // x-test-before-statement runs a real D1 write once, just before the first statement (alone or in a batch)
 // matching x-test-statement; x-test-fault no-database refuses every database access.
 const beforeStatement=request.headers.get('x-test-before-statement'),statementPattern=request.headers.get('x-test-statement')
 if(!before&&!after&&!fault&&!beforeStatement)return env
 if(fault==='no-database')return {...env,DB:{prepare(){throw new Error('Database access forbidden')},batch(){throw new Error('Database access forbidden')},exec(){throw new Error('Database access forbidden')}} as unknown as D1Database}
 const DB=env.DB,FILES=env.FILES;let puts=0,fired=false
 const fire=async()=>{if(!fired){fired=true;await DB.exec(beforeStatement!)}}
 const targets=new WeakMap<object,D1PreparedStatement>()
 const intercept=(statement:D1PreparedStatement):D1PreparedStatement=>{const proxy=new Proxy(statement,{get(target,key){
  if(key==='bind')return (...values:unknown[])=>intercept(target.bind(...values))
  if(key==='run'||key==='all'||key==='first'||key==='raw')return async(...args:unknown[])=>{await fire();return (target as any)[key](...args)}
  const value=(target as any)[key];return typeof value==='function'?value.bind(target):value
 }});targets.set(proxy,statement);return proxy}
 const prepare=(sql:string)=>beforeStatement&&statementPattern&&new RegExp(statementPattern,'i').test(sql)?intercept(DB.prepare(sql)):DB.prepare(sql)
 const queue=fault==='queue-unavailable'?{send:async()=>{throw new Error('Injected queue delivery failure')},sendBatch:async()=>{throw new Error('Injected queue delivery failure')}}:fault==='queue-lost'?{send:async()=>{},sendBatch:async()=>{}}:undefined
 return {...env,...(queue?{JOBS:queue as unknown as Env['JOBS']}:{}),
  DB:{prepare,exec:DB.exec.bind(DB),async batch(statements:D1PreparedStatement[]){
   if(fault==='db-before')throw new Error('Injected D1 failure')
   if(before)await DB.exec(before)
   if(statements.some(statement=>targets.has(statement)))await fire()
   const result=await DB.batch(statements.map(statement=>targets.get(statement)??statement))
   if(after)await DB.exec(after)
   if(fault==='db-after')throw new Error('Injected lost D1 response')
   return result
  }} as unknown as D1Database,
  FILES:{get:FILES.get.bind(FILES),head:FILES.head.bind(FILES),delete:FILES.delete.bind(FILES),list:FILES.list.bind(FILES),async put(...args:Parameters<R2Bucket['put']>){
   if(fault==='second-copy'&&++puts===2)throw new Error('Injected R2 copy failure')
   if(fault==='unknown-copy'){await FILES.put(...args);throw new Error('Injected lost R2 response')}
   return FILES.put(...args)
  }} as unknown as R2Bucket,
 }
}
export default {
 async fetch(request:Request,env:Env,context:ExecutionContext){
  env=faulted(request,bindings(env))
  const path=new URL(request.url).pathname
  if(path==='/_test/queue/take')return Response.json(captured.splice(0))
  // Mutating routes no role rule classifies: a collaborator is refused them by default, and the roles journey expects none.
  if(path==='/_test/unclassified-routes')return Response.json([...new Set(app.routes.filter(route=>!['GET','HEAD','OPTIONS','ALL'].includes(route.method)&&routeRule(route.method,route.path)===undefined).map(route=>`${route.method} ${route.path}`))])
  if(path==='/_test/queue/run'){
   const jobs=await request.json<any[]>(),acked:number[]=[],retried:number[]=[]
   await consumeQueue({messages:jobs.map((body,index)=>({id:String(index),body,ack(){acked.push(index)},retry(){retried.push(index)}}))} as any,env)
   return Response.json({acked,retried})
  }
  // The Email Worker entry for mail Miniflare's local trigger cannot parse (no usable From): the same
  // message shape Email Routing hands the Worker, with its rejection reported back.
  if(path==='/_test/email'){
   const url=new URL(request.url),raw=await request.arrayBuffer();let rejected:string|undefined
   await handleEmail({from:url.searchParams.get('from')||'',to:url.searchParams.get('to')||'',headers:new Headers(),raw:new Response(raw).body,rawSize:raw.byteLength,setReject:(reason:string)=>{rejected=reason},forward:async()=>{throw new Error('forward is not used')},reply:async()=>{throw new Error('reply is not used')}} as any,env,context)
   return Response.json({rejected})
  }
  // The cron tick; `after` runs the operator-mail dispatch that many milliseconds later, as a later tick would.
  if(path==='/_test/scheduled'){const {after=0}=await request.json<{after?:number}>().catch(()=>({after:0}));const originalNow=Date.now
   // Long retention journeys move the runtime clock, so the actual scheduled
   // integration sees the same time as the edge; application policy is untouched.
   const moved=after>=86400000;if(moved)Date.now=()=>originalNow()+after
   try{await Promise.all([runScheduled(env),dispatchOperatorNotifications(env,{now:Date.now()+(moved?0:after)}),purgeExpiredAudit(env,Date.now()+(moved?0:after))]);return Response.json({ran:true})}finally{Date.now=originalNow}}
  return app.fetch(request,env,context)
 },
 async queue(batch:MessageBatch<any>,env:Env){await consumeQueue(batch,env)},
 // The deployed Email Worker entry (src/server.ts), reached through Miniflare's local email trigger.
 async email(message:ForwardableEmailMessage,env:Env,context:ExecutionContext){return handleEmail(message as any,bindings(env),context)},
}
