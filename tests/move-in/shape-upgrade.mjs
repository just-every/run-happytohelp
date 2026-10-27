import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {nativeHarness} from './harness.mjs';
import {retainComparison,unchanged} from './admission-equality.mjs';
import {assertUnchangedTable} from './equality.mjs';
import {snapshotDatabase} from './snapshot.mjs';
import {documents} from './shape-inputs.mjs';
const root='/api/move-in/projects/p/imports',post=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
async function legacy(vendor,body,{extra=0}={}){let before,sequence;
 const h=await nativeHarness({async beforeIdentityAudit(db,directory,files){
  await db.batch([db.prepare("INSERT INTO contacts(id,project_id,email,created_at) VALUES('native','p','upgrade-private@example.test',1)"),db.prepare("INSERT INTO contacts(id,project_id,email,name,created_at) VALUES('keeper','p','keeper@example.test','Keep this row',2)")]);
  const hash=createHash('sha256').update(body).digest('hex');await files.put('move-in/p/old/original',body);
  await db.prepare("INSERT INTO move_in_runs(id,project_id,actor_id,session_hash,vendor,filename,artifact_hash,object_key,bytes,state,identity_complete,created_at,updated_at) VALUES('old','p','owner','old-session',?,'old-original.jsonl',?,'move-in/p/old/original',?,'uploaded',1,1,1)").bind(vendor,hash,Buffer.byteLength(body)).run();
  for(let i=1;i<=extra;i++){const raw='\n'.repeat(i)+body,id=`older-${i}`,key=`move-in/p/${id}/original`;await files.put(key,raw);await db.prepare("INSERT INTO move_in_runs(id,project_id,actor_id,session_hash,vendor,filename,artifact_hash,object_key,bytes,state,identity_complete,created_at,updated_at) VALUES(?,'p','owner','old-session',?,'old-original.jsonl',?, ?,?,'uploaded',1,1,1)").bind(id,vendor,createHash('sha256').update(raw).digest('hex'),key,Buffer.byteLength(raw)).run()}
  before=(await snapshotDatabase(directory,db)).tables;
 },async afterIdentityAudit(db,directory){const after=(await snapshotDatabase(directory,db)).tables;assert.deepEqual(Object.keys(after),Object.keys(before));
  await retainComparison(before,after,`${vendor}-pre-audit-upgrade`);
  for(const table of Object.keys(before)){const expected=table==='move_in_runs'?before[table].map(row=>({...row,identity_complete:{sqliteInteger:'0'},identity_audited:{sqliteInteger:'0'}})):before[table];const delta=assertUnchangedTable(table,expected,after[table]);if(delta)sequence=delta}
 }});return {h,sequence,tableCount:Object.keys(before).length};
}

import {step} from './steps.mjs';

export async function upgradeSteps(){
for(const vendor of ['intercom','zendesk'])await step(`${vendor} persisted old completeness claims upgrade conservatively without changing any native row`,async()=>{
 const person=vendor==='intercom'?{type:'contact',id:'old-customer',email:'other@example.test',name:{email:'upgrade-private@example.test'},created_at:1704067200}:{user:{id:931,role:'end-user',email:'other@example.test',name:{email:'upgrade-private@example.test'},created_at:'2024-01-01T00:00:00Z'}},body=JSON.stringify(person),{h,sequence,tableCount}=await legacy(vendor,body);try{
 const files=await h.files,keeper=await h.db.prepare("SELECT * FROM contacts WHERE id='keeper'").first();assert.equal(await (await files.get('move-in/p/old/original')).text(),body);
 const beforeRepeat=await h.snapshot(),repeat=await h.call(`${root}?vendor=${vendor}`,{method:'POST',headers:{'X-Import-Filename':'old-original.jsonl','X-Import-Schema':'2.16'},body});assert.equal(repeat.data.id,'old');assert.equal(repeat.writes,0);assert.equal(h.lastWrites,0);await unchanged(h,beforeRepeat,`${vendor}-pre-audit-repeat`);
 await h.call(`${root}/old/resume`,post({}));await h.drain();assert.equal((await h.call(`${root}/old`)).data.state,'ready');
 await h.call('/api/management/projects/p/contacts/native/erase',post({}));assert.equal((await h.call(`${root}/old`)).data.state,'erased');assert.equal((await files.list({prefix:'move-in/p/'})).objects.length,0);assert.deepEqual(await h.db.prepare("SELECT * FROM contacts WHERE id='keeper'").first(),keeper);
 const replay=structuredClone(person);if(vendor==='intercom')replay.id='new-customer';else replay.user.id=932;
 assert.equal((await h.raw(`${root}?vendor=${vendor}`,{method:'POST',headers:{'X-Import-Filename':'old-original.jsonl','X-Import-Schema':'2.16'},body:JSON.stringify(replay)})).response.status,410);assert.equal(h.outbound,0);
 console.log(JSON.stringify({proof:'shape-upgrade',vendor,tableCount,sequence,literalEquality:'UNFULFILLED',changedCells:'move_in_runs.identity_complete plus additive audit status only; explicit D1 sequence increment',privateObjectsAfterErasure:0}));
 }finally{await h.close()}});
await step('upgrade reindexes real original bytes before ordinary native erasure loses old unrecorded aliases',async()=>{
 const {conversation}=documents('intercom'),fields=Object.fromEntries(Array.from({length:150},(_,i)=>[`opaque${i}`,null]));conversation.source.author={type:'admin',id:'old-unrecorded-staff',email:'upgrade-private@example.test',external_id:'old-external'};
 const {h}=await legacy('intercom',JSON.stringify({...fields,...conversation}));try{
 assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM move_in_identity_links').first()).n,0);
 await h.call('/api/management/projects/p/contacts/native/erase',post({}));assert.equal((await h.call(`${root}/old`)).data.state,'erased');assert.equal((await (await h.files).list()).objects.length,0);
 for(const identity of [{id:'old-unrecorded-staff'},{id:'new-source',external_id:'old-external'}]){const body=JSON.stringify({type:'contact',email:'changed@example.test',created_at:1704067200,...identity});assert.equal((await h.raw(`${root}?vendor=intercom`,{method:'POST',headers:{'X-Import-Filename':'changed.jsonl','X-Import-Schema':'2.16'},body})).response.status,410)}assert.equal(h.outbound,0);
 }finally{await h.close()}});
await step('unprocessable pre-audit custody yields to native erasure and cannot authorize unchecked changed imports',async()=>{
 const {h}=await legacy('intercom','{"type":"contact","id":"old-source","email":"upgrade-private@example.test",');try{
 const keeper=await h.db.prepare("SELECT * FROM contacts WHERE id='keeper'").first();await h.call('/api/management/projects/p/contacts/native/erase',post({}));assert.equal((await h.call(`${root}/old`)).data.state,'erased');assert.equal((await (await h.files).list()).objects.length,0);assert.deepEqual(await h.db.prepare("SELECT * FROM contacts WHERE id='keeper'").first(),keeper);
 assert.equal((await h.db.prepare("SELECT identity_audited FROM move_in_runs WHERE id='old'").first()).identity_audited,-1);
 const result=await h.raw(`${root}?vendor=intercom`,{method:'POST',headers:{'X-Import-Filename':'changed.jsonl','X-Import-Schema':'2.16'},body:JSON.stringify({type:'contact',id:'old-source',email:'changed@example.test',created_at:1704067200})});assert.equal(result.response.status,410);assert.match(result.data.error,/older export/);assert.equal(h.lastWrites,0);assert.equal(h.outbound,0);
 }finally{await h.close()}});
await step('bounded old-original erasure continuation survives real owned process death',async()=>{
 const {conversation}=documents('intercom');conversation.source.author={type:'admin',id:'continued-staff',email:'upgrade-private@example.test'};
 const {h}=await legacy('intercom',JSON.stringify(conversation),{extra:2});try{
 const first=await h.raw('/api/management/projects/p/contacts/native/erase',post({}));assert.equal(first.response.status,409);assert.match(first.data.error,/Retry erasure/);assert.equal((await (await h.files).list()).objects.length,3);assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM move_in_runs WHERE identity_audited=1').first()).n,2);
 await h.crashDuringStep();await h.call('/api/management/projects/p/contacts/native/erase',post({}));assert.equal((await (await h.files).list()).objects.length,0);assert.equal((await h.db.prepare("SELECT COUNT(*) n FROM move_in_runs WHERE state='erased'").first()).n,3);
 const result=await h.raw(`${root}?vendor=intercom`,{method:'POST',headers:{'X-Import-Filename':'changed.jsonl','X-Import-Schema':'2.16'},body:JSON.stringify({type:'contact',id:'continued-staff',email:'changed@example.test',created_at:1704067200})});assert.equal(result.response.status,410);assert.equal(h.outbound,0);
 }finally{await h.close()}});}
