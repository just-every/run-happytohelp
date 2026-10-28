import {phases} from '../journeys/kit/scenarios.mjs';
const test=phases(import.meta.url);
import assert from 'node:assert/strict';
import {nativeHarness} from './harness.mjs';
import {unchanged} from './admission-equality.mjs';
import {documents} from './shape-inputs.mjs';
import {base,upload,refusals} from './admission-inputs.mjs';
const post=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});

import {step} from './steps.mjs';

test("refusals: refused uploads are located at their exact source place before any custody, queue, native write or outbound call",async()=>{
await step('unindexable raw files are refused with exact locations before all custody and native effects',async()=>{const h=await nativeHarness();try{
 const before=await h.snapshot();for(const [vendor,name,body,code,row,pointer,artifact=name] of refusals()){
  const result=await h.raw(`${base}?vendor=${vendor}`,upload(vendor,body,name));assert.equal(result.response.status,422,`${name} ${JSON.stringify(result.data)}`);assert.deepEqual(result.data.diagnostic,{code,location:{artifact,row,pointer}});assert.equal(h.lastWrites,0,name);assert.equal(h.queued.length,0,name);assert.equal((await (await h.files).list()).objects.length,0,name);
 }
 await unchanged(h,before,'admission-refusals');assert.equal(h.outbound,0);
 }finally{await h.close()}});
await step('bounded identity traversal refuses every supported record kind regardless of property order',async()=>{const h=await nativeHarness();try{const before=await h.snapshot();
 for(const vendor of ['zendesk','intercom'])for(const [kind,value] of Object.entries(documents(vendor)))for(const order of ['early','late']){
  const opaque=Object.fromEntries(Array.from({length:4100},(_,i)=>[`x${i}`,null])),payload=vendor==='zendesk'?Object.values(value)[0]:value,record=order==='early'?{...opaque,...payload}:{...payload,...opaque},body=JSON.stringify(vendor==='zendesk'?{[Object.keys(value)[0]]:record}:record);
  const result=await h.raw(`${base}?vendor=${vendor}`,upload(vendor,body));assert.equal(result.response.status,422,`${vendor}/${kind}/${order}`);assert.equal(result.data.diagnostic.code,'source_identity_node_limit');assert.equal(result.data.diagnostic.location.artifact,'source.jsonl');assert.equal(result.data.diagnostic.location.row,1);assert.match(result.data.diagnostic.location.pointer,/\/(?:user\/|ticket\/|macro\/|article\/)?x\d+/);assert.equal(h.lastWrites,0);
 }
 await unchanged(h,before,'identity-traversal-refusals');assert.equal((await (await h.files).list()).objects.length,0);assert.equal(h.outbound,0);
 }finally{await h.close()}});
await step('multipart bytes and late archive failures cannot keep even an earlier valid member',async()=>{const h=await nativeHarness();try{
 const good=JSON.stringify(documents('intercom').person),boundary='admission-test-boundary',body=`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="first.jsonl"\r\n\r\n${good}\r\n--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="later.jsonl"\r\n\r\n{"type":\r\n--${boundary}--\r\n`,before=await h.snapshot();
 const result=await h.raw(`${base}?vendor=intercom`,{...upload('intercom',body,'multipart.jsonl'),headers:{'X-Import-Filename':'multipart.jsonl','X-Import-Schema':'2.16','Content-Type':`multipart/form-data; boundary=${boundary}`}});assert.equal(result.response.status,422);assert.equal(result.data.diagnostic.code,'invalid_json');assert.deepEqual(result.data.diagnostic.location,{artifact:'multipart.jsonl',row:1,pointer:''});assert.equal(h.lastWrites,0);assert.equal(h.queued.length,0);await unchanged(h,before,'multipart-refusal');assert.equal((await (await h.files).list()).objects.length,0);assert.equal(h.outbound,0);
 }finally{await h.close()}});
});

test("erasure: erasing a contact removes every import custody that holds them and refuses any later upload carrying their aliases, while other people's data stays",async()=>{
await step('presentation truncation never hides any later known participant or author alias in any property order',async()=>{const h=await nativeHarness();try{
 await h.db.prepare("INSERT INTO contacts(id,project_id,email,external_id,created_at) VALUES('native','p','erase@example.test','erase-external',1)").run();
 const runs=[],aliases=[];
 for(const order of ['early','late'])for(const slot of ['participant','source','part']){
  const {person,conversation}=documents('intercom'),opaque=Object.fromEntries(Array.from({length:150},(_,i)=>[`opaque${i}`,null]));
  const identity={type:'admin',id:`${order}-${slot}`,email:'erase@example.test',external_id:'erase-external'};aliases.push(identity.id);
  if(slot==='participant')conversation.contacts.contacts.push(identity);if(slot==='source')conversation.source.author=identity;if(slot==='part')conversation.conversation_parts.conversation_parts[0].author=identity;
  const record=order==='early'?{...opaque,...conversation}:{...conversation,...opaque};record.id=`${order}-${slot}`;
  const run=(await h.call(`${base}?vendor=intercom`,upload('intercom',[person,record].map(JSON.stringify).join('\n')))).data;await h.drain();runs.push(run);
 }
 await h.call('/api/management/projects/p/contacts/native/erase',post({}));
 for(const run of runs)assert.equal((await h.call(`${base}/${run.id}`)).data.state,'erased');
 for(const id of aliases){const record={type:'contact',id,email:'changed@example.test',created_at:1704067200};assert.equal((await h.raw(`${base}?vendor=intercom`,upload('intercom',JSON.stringify(record)))).response.status,410,id)}
 assert.equal((await (await h.files).list()).objects.length,0);assert.equal(h.outbound,0);
 }finally{await h.close()}});
});
