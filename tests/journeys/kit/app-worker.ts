import {app} from '../../../src/app'
import {consumeQueue} from '../../../src/queue'
import {runScheduledInvocation} from '../../../src/platform/scheduled'
import {routeRule} from '../../../src/modules/access/route-permissions'
import {handleEmail} from '../../../src/modules/integrations'
import type {Env} from '../../../src/platform/env'
export {ConversationSocket} from '../../../src/modules/conversations/socket'

// The real application router over real D1/R2/Durable Objects. With
// H2H_TEST_CAPTURE_QUEUE, queued jobs wait for the test to run them, so a test
// controls when background work happens; otherwise the Miniflare queue runs them.
const captured:unknown[]=[]
const bindings=(env:Env):Env=>env.H2H_TEST_CAPTURE_QUEUE?{...env,JOBS:{send:async(job:unknown)=>{captured.push(job)},sendBatch:async(batch:{body:unknown}[])=>{captured.push(...batch.map(item=>item.body))}} as unknown as Env['JOBS']}:env
// Count all three cron branches against the same enforced platform limit.
function scheduledMeter(db:D1Database){
 const counts={statements:0,calls:0,refused:0,pruned:false},consumers:Record<string,{statements:number;completed:boolean}>={}
 const database=(name:string,input=db):D1Database=>{
  const rebase=(input as any)[Symbol.for('happytohelp.d1.layer')];if(rebase)return rebase((inner:D1Database)=>database(name,inner))
  const own=consumers[name]={statements:0,completed:false},raw=new WeakMap<object,D1PreparedStatement>()
  const hit=(n:number,sql='')=>{if(counts.statements+n>1000){counts.refused++;throw new Error('D1 invocation statement limit')}if(name==='invocation'){counts.statements+=n;counts.calls++};own.statements+=n;if(sql.includes('DELETE FROM abuse_counters'))counts.pruned=true}
  const wrap=(statement:D1PreparedStatement,sql:string):D1PreparedStatement=>{
   const result={bind:(...args:unknown[])=>wrap(statement.bind(...args),sql),...Object.fromEntries(['first','all','run','raw'].map(key=>[key,(...args:unknown[])=>{hit(1,sql);return (statement as any)[key](...args)}]))} as D1PreparedStatement
   raw.set(result,statement);return result
  }
  return {prepare:(sql:string)=>wrap(input.prepare(sql),sql),batch:(statements:D1PreparedStatement[])=>{hit(statements.length);return input.batch(statements.map(statement=>raw.get(statement)??statement))},exec:()=>{throw new Error('Cron exec is not metered')},dump:()=>db.dump()} as D1Database
 }
 return {counts,consumers,database}
}
// Storage faults for one request, named by test-only headers. x-test-before-batch
// and x-test-after-batch run a real D1 write around each atomic batch, as a
// concurrent request would; x-test-fault fails D1 or R2 before or after commit,
// or makes the queue refuse (queue-unavailable) or silently lose (queue-lost) sends.
// db-once throws before the Kth matching D1 statement; db-interrupt commits
// that statement, then denies all further storage/queue work for this invocation.
// x-test-statement-at supplies K, with optional x-test-statement SQL matching.
const faulted=(request:Request,env:Env):Env=>{
 const before=request.headers.get('x-test-before-batch'),after=request.headers.get('x-test-after-batch'),fault=request.headers.get('x-test-fault')
 // x-test-before-statement runs a real D1 write once, just before the first statement (alone or in a batch)
 // matching x-test-statement; x-test-fault no-database refuses every database access.
 const beforeStatement=request.headers.get('x-test-before-statement'),statementPattern=request.headers.get('x-test-statement')
 if(!before&&!after&&!fault&&!beforeStatement)return env
 if(fault==='no-database')return {...env,DB:{prepare(){throw new Error('Database access forbidden')},batch(){throw new Error('Database access forbidden')},exec(){throw new Error('Database access forbidden')}} as unknown as D1Database}
 const DB=env.DB,FILES=env.FILES;let puts=0,fired=false,seen=0,faultFired=false,interrupted=false
 const counted=fault==='db-once'||fault==='db-interrupt',at=Number(request.headers.get('x-test-statement-at')??1),pattern=statementPattern?new RegExp(statementPattern,'i'):undefined
 const alive=()=>{if(interrupted)throw new Error('Injected invocation termination')}
 const checkpoint=(sqls:string[])=>{
  alive()
  if(!counted||faultFired)return false
  for(const sql of sqls)if(!pattern||pattern.test(sql)){if(++seen===at){faultFired=true;if(fault==='db-once')throw new Error('Injected transient D1 failure');return true}}
  return false
 }
 const committed=(stop:boolean)=>{if(stop){interrupted=true;alive()}}
 const fire=async()=>{if(!fired){fired=true;await DB.exec(beforeStatement!)}}
 const targets=new WeakMap<object,D1PreparedStatement>(),sqls=new WeakMap<object,string>()
 const intercept=(statement:D1PreparedStatement,sql:string):D1PreparedStatement=>{const proxy=new Proxy(statement,{get(target,key){
  if(key==='bind')return (...values:unknown[])=>intercept(target.bind(...values),sql)
  if(key==='run'||key==='all'||key==='first'||key==='raw')return async(...args:unknown[])=>{const stop=checkpoint([sql]);if(beforeStatement&&pattern?.test(sql))await fire();const result=await (target as any)[key](...args);committed(stop);return result}
  const value=(target as any)[key];return typeof value==='function'?value.bind(target):value
 }});targets.set(proxy,statement);sqls.set(proxy,sql);return proxy}
 const prepare=(sql:string)=>{alive();return counted||beforeStatement&&pattern?.test(sql)?intercept(DB.prepare(sql),sql):DB.prepare(sql)}
 const queue=fault==='queue-unavailable'?{send:async()=>{throw new Error('Injected queue delivery failure')},sendBatch:async()=>{throw new Error('Injected queue delivery failure')}}:fault==='queue-lost'?{send:async()=>{},sendBatch:async()=>{}}:counted?{send:async(job:unknown)=>{alive();await env.JOBS.send(job as any)},sendBatch:async(jobs:any[])=>{alive();await env.JOBS.sendBatch(jobs)}}:undefined
 return {...env,...(queue?{JOBS:queue as unknown as Env['JOBS']}:{}),
  DB:{prepare,async exec(sql:string){const stop=checkpoint([sql]),result=await DB.exec(sql);committed(stop);return result},async batch(statements:D1PreparedStatement[]){
   const stop=checkpoint(statements.map(statement=>sqls.get(statement)??''))
   if(fault==='db-before')throw new Error('Injected D1 failure')
   if(before)await DB.exec(before)
   if(beforeStatement&&statements.some(statement=>pattern?.test(sqls.get(statement)??'')))await fire()
   const result=await DB.batch(statements.map(statement=>targets.get(statement)??statement))
   if(after)await DB.exec(after)
   if(fault==='db-after')throw new Error('Injected lost D1 response')
   committed(stop)
   return result
  }} as unknown as D1Database,
  FILES:{get:FILES.get.bind(FILES),head:FILES.head.bind(FILES),delete:FILES.delete.bind(FILES),list:FILES.list.bind(FILES),async put(...args:Parameters<R2Bucket['put']>){
   alive()
   if(fault==='second-copy'&&++puts===2)throw new Error('Injected R2 copy failure')
   if(fault==='unknown-copy'){await FILES.put(...args);throw new Error('Injected lost R2 response')}
   return FILES.put(...args)
  }} as unknown as R2Bucket,
 }
}
const worker={
 async fetch(request:Request,env:Env,context:ExecutionContext){
  env=faulted(request,bindings(env))
  const path=new URL(request.url).pathname
  if(path==='/_test/routes')return Response.json([...new Map(app.routes.filter(route=>route.method==='GET').map(route=>[route.path,{method:route.method,path:route.path}])).values()])
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
   const moved=after>=86400000||request.headers.get('x-test-clock')==='advance';if(moved)Date.now=()=>originalNow()+after
   const meter=scheduledMeter(env.DB)
   try{await runScheduledInvocation({...env,DB:meter.database('invocation')},{now:Date.now()+(moved?0:after),consumerEnv:(name,input)=>({...input,DB:meter.database(name,input.DB)})});for(const consumer of Object.values(meter.consumers))consumer.completed=true;delete meter.consumers.invocation;return Response.json({ran:true,...meter.counts,consumers:meter.consumers})}finally{Date.now=originalNow}}
  return app.fetch(request,env,context)
 },
 async queue(batch:MessageBatch<any>,env:Env){await consumeQueue(batch,env)},
 // The deployed Email Worker entry (src/server.ts), reached through Miniflare's local email trigger.
 async email(message:ForwardableEmailMessage,env:Env,context:ExecutionContext){return handleEmail(message as any,bindings(env),context)},
}

export default {...worker,async fetch(request:Request,env:Env,context:ExecutionContext){
 if(!request.headers.has('x-test-meter-d1'))return worker.fetch(request,env,context)
 const meter=scheduledMeter(env.DB),pending:Promise<unknown>[]=[],ctx={...context,waitUntil:(work:Promise<unknown>)=>{pending.push(work)}} as ExecutionContext
 const response=await worker.fetch(request,{...env,DB:meter.database('invocation')},ctx)
 await Promise.all(pending)
 const result=new Response(response.body,response)
 result.headers.set('x-test-d1-statements',String(meter.counts.statements));result.headers.set('x-test-d1-calls',String(meter.counts.calls));result.headers.set('x-test-d1-refused',String(meter.counts.refused))
 return result
}}
