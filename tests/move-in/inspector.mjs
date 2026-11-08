import assert from 'node:assert/strict';
import WebSocket from 'ws';
/** Samples the application isolate, not the workerd process (which also owns D1).
 * No source bodies, runtime objects, credentials, or evaluated expressions leave it.
 * `livePeak` is memory the isolate still holds after a forced full garbage collection:
 * its JS heap plus reachable ArrayBuffer backing stores. Every 20 ms a reading taken
 * without collection (live data plus garbage V8 has not collected yet, so never below
 * the live figure) screens for `limit`; reaching it, and every phase snapshot, forces a
 * collection and measures. A forced collection also discards compiled code, so it runs
 * only then, at most every 250 ms. The isolate performs it on its next turn, so a
 * trivial request gives it one when the import is between requests. Read the counters
 * as soon as collection completes: that wake request can wait behind import work for
 * seconds, during which fresh garbage must not become a post-collection reading.
 * The uncollected
 * peak moves with GC timing alone: it is logged (`preGcPeaks`), never asserted. */
const SCREEN_MS=20,MIN_GC_MS=250,WAKE='https://app.example/_test/configured';
const total=heap=>heap.usedSize+heap.backingStorageSize;
export async function heapSampler(mf,{limit}){
 const origin=await mf.getInspectorURL();origin.protocol='http:';const targets=await (await fetch(new URL('/json/list',origin))).json(),target=targets.find(row=>row.title?.includes('move-in-native'));
 assert.ok(target,'application isolate inspector target');
 const socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject)});
 let sequence=0,screens=0,collections=0,livePeak=0,phaseLivePeak=0,lastCollection=0,chain=Promise.resolve(),busy=false,failed;const livePeaks={},preGcPeaks={};
 const requests=new Map();socket.on('message',bytes=>{const message=JSON.parse(String(bytes)),wait=requests.get(message.id);if(wait){requests.delete(message.id);clearTimeout(wait.timer);message.error?wait.reject(new Error(message.error.message)):wait.resolve(message.result)}});
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{requests.delete(id);reject(new Error('Heap inspector timed out'))},30000);requests.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}))});
 const record=(peaks,heap)=>{assert.ok(Number.isFinite(heap.usedSize)&&Number.isFinite(heap.backingStorageSize),'the isolate reports its heap and buffer use');for(const [key,value] of Object.entries(heap))if(typeof value==='number'&&Number.isFinite(value))peaks[key]=Math.max(peaks[key]||0,value)};
 async function collect(){
  let settled=false;const collected=send('HeapProfiler.collectGarbage').finally(()=>{settled=true});
  const [heap]=await Promise.all([collected.then(()=>send('Runtime.getHeapUsage')),(async()=>{while(!settled){await (await mf.dispatchFetch(WAKE)).arrayBuffer();await new Promise(resolve=>setTimeout(resolve,50))}})()]);
  record(livePeaks,heap);livePeak=Math.max(livePeak,total(heap));phaseLivePeak=Math.max(phaseLivePeak,total(heap));collections++;lastCollection=performance.now()}
 async function screen(){const heap=await send('Runtime.getHeapUsage');record(preGcPeaks,heap);screens++;if(total(heap)>=limit&&livePeak<limit&&performance.now()-lastCollection>=MIN_GC_MS)await collect()}
 // One inspector exchange at a time.
 const exclusive=step=>chain=chain.then(step).catch(error=>{failed??=error});
 const report=()=>({livePeak,phaseLivePeak,limit,collections,screens,livePeaks:{...livePeaks},preGcPeaks:{...preGcPeaks}});
 const measured=async()=>{await exclusive(collect);if(failed)throw failed;const result=report();phaseLivePeak=0;return result};
 await exclusive(screen);if(failed)throw failed;const timer=setInterval(()=>{if(busy)return;busy=true;exclusive(screen).finally(()=>{busy=false})},SCREEN_MS);
 return {snapshot:measured,async close(){clearInterval(timer);try{const result=await measured();assert.ok(collections>0&&screens>0);return result}finally{socket.terminate()}}};
}
