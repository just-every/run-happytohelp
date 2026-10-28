import assert from 'node:assert/strict'
import {WidgetTransport} from '../../../src/modules/widget/transport.js'
import {startApp} from '../../journeys/kit/app.mjs'

// The widget's own transport against the real application: a response lost after the D1 commit is retried with the
// same command and frontier and admitted once; a concurrent operator reply is a definitive refusal that refreshes
// the frontier, and the visitor's message is then admitted once; a rate-limited message surfaces its retry delay
// and is never replayed. Only the network between them is faulted.
export async function lostResponseJourney(){
 const app=await startApp({listen:true,bindings:{RATE_LIMITS:JSON.stringify({messagesPerConversationMinute:5})}}),origin='https://site.example'
 const workspace=await app.seedWorkspace('lost',{allowedOrigin:origin}),apiOrigin=app.url,widgetKey=workspace.widgetKey,ownerToken=workspace.tokens.owner
 const previousStorage=globalThis.localStorage
 try{
const storage=new Map();globalThis.localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)};
const nativeFetch=globalThis.fetch;
let dropResponse=true;
globalThis.fetch=async(url,options={})=>{
 const headers=new Headers(options.headers);headers.set('Origin',origin);
 const response=await nativeFetch(url,{...options,headers});
 if(dropResponse&&options.method==='POST'&&String(url).endsWith('/messages')&&response.ok){await response.clone().json();dropResponse=false;throw new TypeError('Test: connection lost after native D1 commit');}
 return response;
};
let connected;const ready=new Promise(resolve=>{connected=resolve});
const transport=new WidgetTransport({apiOrigin,widgetKey,onEvent:event=>{if(event.type==='connected')connected()}});
try{
 await transport.connect();await ready;await transport.refresh();
 const command={local_id:crypto.randomUUID(),content:'Lost-response native D1 proof',media_ids:[]};
 await assert.rejects(transport.send(command),/after native D1 commit/);
 const frozen=structuredClone(transport.session.pendingCommands[command.local_id]);
 await transport.refresh();assert.ok(transport.revision>frozen.expectedRevision);
 const result=await transport.send(command);assert.equal(result.accepted,true);assert.equal(result.duplicate,true);
 const transcript=await transport.refresh();assert.equal(transcript.messages.filter(message=>message.local_id===command.local_id).length,1);
 assert.equal(transport.session.pendingCommands[command.local_id],undefined);
 {
  const before=await transport.refresh();let interleaved=false;
  globalThis.fetch=async(url,options={})=>{
   const headers=new Headers(options.headers);headers.set('Origin',origin);
   if(!interleaved&&options.method==='POST'&&String(url).endsWith('/messages')){
    interleaved=true;
    const operator=await nativeFetch(url,{method:'POST',headers:{Authorization:`Bearer ${ownerToken}`,'Content-Type':'application/json',Origin:origin},body:JSON.stringify({localId:crypto.randomUUID(),content:'Concurrent operator reply',expectedRevision:before.revision,expectedLastMessageId:before.lastMessageId})});
    assert.equal(operator.status,200);
   }
   return nativeFetch(url,{...options,headers});
  };
  const concurrent={local_id:crypto.randomUUID(),content:'Concurrent visitor message',media_ids:[]};
  assert.equal((await transport.send(concurrent)).accepted,true);
  const after=await transport.refresh();assert.equal(after.revision,before.revision+2);assert.equal(after.messages.filter(m=>m.local_id===concurrent.local_id).length,1);assert.equal(transport.session.pendingCommands[concurrent.local_id],undefined);
 }
  // Over the per-minute limit the refusal is readable, carries its delay, and the command is not kept for replay.
  // A short burst may cross one real minute boundary. Twelve attempts still
  // exhaust a five-message bucket without depending on its wall-clock phase.
  let refused
  for(let index=0;index<12&&!refused;index++)await transport.send({local_id:crypto.randomUUID(),content:'Burst '+index,media_ids:[]}).catch(error=>{refused=error})
  assert.ok(refused?.rateLimited,'the burst reaches the limit');assert.equal(refused.status,429);assert.ok(refused.retryAfter>=1);assert.equal(refused.definitiveRejection,true)
  assert.deepEqual(transport.session.pendingCommands,{});const posts=await app.first("SELECT count(*) n FROM messages");await transport.replayPending();assert.deepEqual(await app.first("SELECT count(*) n FROM messages"),posts)
 }finally{transport.close();globalThis.fetch=nativeFetch;globalThis.localStorage=previousStorage}
 }finally{await app.close()}
}
