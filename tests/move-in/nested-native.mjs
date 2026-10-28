import {phases} from '../journeys/kit/scenarios.mjs';
const test=phases(import.meta.url);
import assert from 'node:assert/strict';
import {nativeHarness} from './harness.mjs';
import {unchanged} from './admission-equality.mjs';
import {nestedRecord,nestedCases,nestedUpload} from './nested-inputs.mjs';
import {archive} from './archive-inputs.mjs';
const root='/api/move-in/projects/p/imports',post=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});

import {step} from './steps.mjs';

test("refusals: refused uploads are located at their exact source place before any custody, queue, native write or outbound call",async()=>{
await step('all nested wrapper packagings refuse full custody, queues and effects after authority checks',async()=>{
 const h=await nativeHarness();try{const before=await h.snapshot();
  for(const [name,body,row,pointer] of nestedCases())for(const packed of [false,true]){
   const input=packed?archive([{name:'safe.json',body:JSON.stringify(nestedRecord)},{name:'inside/'+name,body}]):body,filename=packed?'nested.zip':name;
   for(const [actor,status] of [['operator',403],['foreign',404]]){const denied=await h.raw(`${root}?vendor=intercom`,{...nestedUpload(input,filename),actor});assert.equal(denied.response.status,status);assert.equal(h.lastWrites,0);assert.equal(h.queued.length,0)}
   const refused=await h.raw(`${root}?vendor=intercom`,nestedUpload(input,filename));assert.equal(refused.response.status,422);assert.deepEqual(refused.data.diagnostic,{code:'unsupported_nested_envelope',location:{artifact:packed?'inside/'+name:name,row,pointer}});assert.equal(h.lastWrites,0);assert.equal(h.queued.length,0);assert.equal((await (await h.files).list()).objects.length,0);
  }
  const bad=await h.raw(`${root}?vendor=zendesk`,nestedUpload('\n'+JSON.stringify({box:{nested:{user:{id:81,email:'imani@example.test'}}}}),'source.ndjson'));assert.equal(bad.response.status,422);assert.deepEqual(bad.data.diagnostic,{code:'unsupported_wrapper_requires_record_id',location:{artifact:'source.ndjson',row:2,pointer:'/box'}});assert.equal(h.lastWrites,0);assert.equal(h.queued.length,0);
  await unchanged(h,before,'nested-refusals-zero-custody');assert.equal(h.outbound,0);assert.equal((await (await h.files).list()).objects.length,0);
 }finally{await h.close()}
});
});

test("recovery: interrupted work resumes from durable state after a killed Worker, a broken checkpoint or tampered originals, without duplicating history",async()=>{
await step('known record payloads remain one decision across actual crash resume and keep erasure alias fences',async()=>{
 const h=await nativeHarness();try{
  await h.db.prepare("INSERT INTO contacts(id,project_id,email,created_at) VALUES('native','p','imani@example.test',1)").run();
  const payload={...nestedRecord,details:{container:{type:'article',id:'payload-only',body:'not an independent source record'}}},body=JSON.stringify({type:'list',unknown:payload}),run=(await h.call(`${root}?vendor=intercom`,nestedUpload(body,'known.json'))).data;
  await h.step();await h.crashDuringStep();await h.call(`${root}/${run.id}/resume`,post({}));await h.drain();const ready=(await h.call(`${root}/${run.id}`)).data;
  assert.equal(ready.state,'ready');assert.equal(ready.plan.counts.input,1);assert.equal(ready.plan.counts.unique,1);assert.equal(ready.plan.decisions.length,1);assert.equal(ready.plan.decisions[0].kind,'contact');assert.equal(ready.plan.decisions[0].sourceId,'nested-81');assert.deepEqual(ready.plan.decisions[0].location,{artifact:'known.json',row:1,pointer:'/unknown'});
  const stored=await h.db.prepare('SELECT record_json FROM move_in_records WHERE run_id=?').bind(run.id).first();assert.deepEqual(JSON.parse(stored.record_json).payload,payload);
  await h.call('/api/management/projects/p/contacts/native/erase',post({}));assert.equal((await h.call(`${root}/${run.id}`)).data.state,'erased');assert.equal((await (await h.files).list()).objects.length,0);
  const before=await h.snapshot();for(const record of [{...nestedRecord,email:'changed@example.test'},{...nestedRecord,id:'changed',email:'changed@example.test'}]){const replay=await h.raw(`${root}?vendor=intercom`,nestedUpload(JSON.stringify(record),'changed.json'));assert.equal(replay.response.status,410);assert.equal(h.lastWrites,0);assert.equal(h.queued.length,0)}
  for(const [name,body,row,pointer] of nestedCases()){const refused=await h.raw(`${root}?vendor=intercom`,nestedUpload(body,name));assert.equal(refused.response.status,422);assert.deepEqual(refused.data.diagnostic,{code:'unsupported_nested_envelope',location:{artifact:name,row,pointer}});assert.equal(h.lastWrites,0);assert.equal(h.queued.length,0)}
  await unchanged(h,before,'nested-erasure-and-replay');assert.equal(h.outbound,0);
 }finally{await h.close()}
});
});
