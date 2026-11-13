import assert from 'node:assert/strict'
import WebSocket from 'ws'
/** Inspector's V8 sampling profiler measures executing isolate stacks. Idle
 * samples are excluded; this is sampled CPU, never request or D1 wall duration. */
export async function isolateProfiler(mf){
 const origin=await mf.getInspectorURL();origin.protocol='http:'
 const targets=await (await fetch(new URL('/json/list',origin))).json(),target=targets.find(row=>row.title?.includes('legacy-runner'))
 assert.ok(target,'application isolate inspector target')
 const socket=new WebSocket(target.webSocketDebuggerUrl),pending=new Map();let sequence=0,contextId
 await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject)})
 socket.on('message',bytes=>{const message=JSON.parse(String(bytes));if(message.method==='Runtime.executionContextCreated'&&message.params.context.name==='Worker')contextId=message.params.context.id;const wait=pending.get(message.id);if(!wait)return;pending.delete(message.id);clearTimeout(wait.timer);message.error?wait.reject(new Error(message.error.message)):wait.resolve(message.result)})
 const send=(method,params={},label=method)=>new Promise((resolve,reject)=>{const id=++sequence,error=new Error('Inspector timeout: '+label),timer=setTimeout(()=>{pending.delete(id);reject(error)},30000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}))})
 const profileCommand=async(method,params={})=>{
  const value=await send('Runtime.evaluate',{contextId,expression:`globalThis.__h2hProfilerCommand(${JSON.stringify(method)},${JSON.stringify(params)})`,awaitPromise:true,returnByValue:true},'V8 '+method)
  if(value.exceptionDetails)throw new Error(`V8 ${method}: ${value.exceptionDetails.exception?.description??value.exceptionDetails.text}`)
  return value.result.value
 }
 await send('Runtime.enable');assert.ok(Number.isInteger(contextId),'application isolate execution context')
 await profileCommand('Profiler.enable');await profileCommand('Profiler.setSamplingInterval',{interval:100})
 return {async measure(run){
  let heap=await send('Runtime.getHeapUsage'),maxHeapBytes=heap.usedSize+(heap.backingStorageSize??0),screening=Promise.resolve(),busy=false,failed
  await profileCommand('Profiler.start')
  // A slow inspector exchange must not queue stale heap observations to drain
  // after the application work. Keep one actual exchange in flight.
  const timer=setInterval(()=>{
   if(busy||failed)return
   busy=true
   screening=(async()=>{heap=await send('Runtime.getHeapUsage');maxHeapBytes=Math.max(maxHeapBytes,heap.usedSize+(heap.backingStorageSize??0))})().catch(error=>{failed=error}).finally(()=>{busy=false})
  },20)
  let value,profile
  try{value=await run()}finally{clearInterval(timer);await screening;if(failed)throw failed;profile=(await profileCommand('Profiler.stop')).profile}
  heap=await send('Runtime.getHeapUsage');maxHeapBytes=Math.max(maxHeapBytes,heap.usedSize+(heap.backingStorageSize??0))
  const nodes=new Map(profile.nodes.map(node=>[node.id,node])),samples=profile.samples??[],deltas=profile.timeDeltas??[]
  let cpuUs=0,idleUs=0;for(let index=0;index<samples.length;index++){const name=nodes.get(samples[index])?.callFrame.functionName,delta=deltas[index]??0;if(name==='(idle)')idleUs+=delta;else cpuUs+=delta}
  assert.ok(samples.length&&Number.isFinite(maxHeapBytes),'actual isolate profiler/heap measurements')
  return {value,measurement:{sampledCpuMs:cpuUs/1000,maxHeapBytes,samples:samples.length,idleMs:idleUs/1000,method:'v8-inspector-session-sampling-excluding-idle'}}
 },async close(){for(const wait of pending.values()){clearTimeout(wait.timer);wait.reject(new Error('Inspector closed'))}pending.clear();socket.terminate()}}
}
export function recordMeasurement(measurements,phase,before,after,m,statements){
 const prior=measurements[phase]??{invocations:0,maxCpuMs:0,maxHeapBytes:0,maxStatements:0,rows:0,bytes:0},rows=(after.rows??0)-(before.rows??0),bytes=(after.bytes??0)-(before.bytes??0)
 prior.invocations++;if(m.sampledCpuMs>=prior.maxCpuMs)prior.worstCpu={ms:m.sampledCpuMs,rows,bytes,statements}
 prior.maxCpuMs=Math.max(prior.maxCpuMs,m.sampledCpuMs);prior.maxHeapBytes=Math.max(prior.maxHeapBytes,m.maxHeapBytes);prior.maxStatements=Math.max(prior.maxStatements,statements);prior.rows=Math.max(prior.rows,rows);prior.bytes=Math.max(prior.bytes,bytes)
 prior.totalCpuMs=(prior.totalCpuMs??0)+m.sampledCpuMs;prior.totalRows=(prior.totalRows??0)+rows;prior.totalBytes=(prior.totalBytes??0)+bytes;prior.rowsPer30sCpu=30000*prior.totalRows/prior.totalCpuMs;prior.bytesPer30sCpu=30000*prior.totalBytes/prior.totalCpuMs;measurements[phase]=prior
}
