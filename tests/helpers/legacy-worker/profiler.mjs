import assert from 'node:assert/strict'
import WebSocket from 'ws'
/** Inspector's V8 sampling profiler measures executing isolate stacks. Idle
 * samples are excluded; this is sampled CPU, never request or D1 wall duration. */
export async function isolateProfiler(mf){
 const origin=await mf.getInspectorURL();origin.protocol='http:'
 const targets=await (await fetch(new URL('/json/list',origin))).json(),target=targets.find(row=>row.title?.includes('legacy-runner'))
 assert.ok(target,'application isolate inspector target')
 const socket=new WebSocket(target.webSocketDebuggerUrl),pending=new Map();let sequence=0
 await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject)})
 socket.on('message',bytes=>{const message=JSON.parse(String(bytes)),wait=pending.get(message.id);if(!wait)return;pending.delete(message.id);clearTimeout(wait.timer);message.error?wait.reject(new Error(message.error.message)):wait.resolve(message.result)})
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error('Inspector timeout'))},30000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}))})
 await send('Profiler.enable');await send('Profiler.setSamplingInterval',{interval:100})
 return {async measure(run){
  let heap=await send('Runtime.getHeapUsage'),maxHeapBytes=heap.usedSize+(heap.backingStorageSize??0),screening=Promise.resolve()
  await send('Profiler.start')
  const timer=setInterval(()=>{screening=screening.then(async()=>{heap=await send('Runtime.getHeapUsage');maxHeapBytes=Math.max(maxHeapBytes,heap.usedSize+(heap.backingStorageSize??0))})},20)
  let value,profile
  try{value=await run()}finally{clearInterval(timer);await screening;profile=(await send('Profiler.stop')).profile}
  heap=await send('Runtime.getHeapUsage');maxHeapBytes=Math.max(maxHeapBytes,heap.usedSize+(heap.backingStorageSize??0))
  const nodes=new Map(profile.nodes.map(node=>[node.id,node])),samples=profile.samples??[],deltas=profile.timeDeltas??[]
  let cpuUs=0,idleUs=0;for(let index=0;index<samples.length;index++){const name=nodes.get(samples[index])?.callFrame.functionName,delta=deltas[index]??0;if(name==='(idle)')idleUs+=delta;else cpuUs+=delta}
  assert.ok(samples.length&&Number.isFinite(maxHeapBytes),'actual isolate profiler/heap measurements')
  return {value,measurement:{sampledCpuMs:cpuUs/1000,maxHeapBytes,samples:samples.length,idleMs:idleUs/1000,method:'workerd-inspector-v8-sampling-excluding-idle'}}
 },async close(){for(const wait of pending.values()){clearTimeout(wait.timer);wait.reject(new Error('Inspector closed'))}pending.clear();socket.terminate()}}
}
