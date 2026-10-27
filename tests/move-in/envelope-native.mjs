import {phases} from '../journeys/kit/scenarios.mjs';
const test=phases(import.meta.url);
import assert from 'node:assert/strict';
import {nativeHarness} from './harness.mjs';
import {unchanged} from './admission-equality.mjs';
import {assertUnchangedTable} from './equality.mjs';
import {records,positions} from './envelope-inputs.mjs';
import {archive,invalidMembers} from './archive-inputs.mjs';
const root='/api/move-in/projects/p/imports',post=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),upload=(body,name)=>({method:'POST',headers:{'X-Import-Filename':name,'X-Import-Schema':'2.16'},body});

import {step} from './steps.mjs';

test("refusals: refused uploads are located at their exact source place before any custody, queue, native write or outbound call",async()=>{
await step('every invalid directory is refused in native Worker with no custody, queue, native or outbound mutation',async()=>{
 const h=await nativeHarness();try{const before=await h.snapshot();
  for(const [label,change,code] of invalidMembers())for(const offset of [0,21]){
   const body=archive([...Array.from({length:offset},(_,i)=>({name:`empty-${i}/`})),{name:'bad/',...change},{name:'safe.json',body:JSON.stringify(records().contact)}]),result=await h.raw(`${root}?vendor=intercom`,upload(body,'malformed.zip'));
   assert.equal(result.response.status,422,`${label}/${offset}`);assert.deepEqual(result.data.diagnostic,{code,location:{artifact:'bad/',row:1,pointer:''}},label);assert.equal(h.lastWrites,0);assert.equal(h.queued.length,0);assert.equal((await (await h.files).list()).objects.length,0);
  }
  await unchanged(h,before,'all-archive-member-refusals');assert.equal(h.outbound,0);
 }finally{await h.close()}
});
});

test("landing: an approved import lands each vendor's history, people, replies, notes, tags and knowledge exactly, keeps notes private, and repeats or repackages as a no-op",async()=>{
await step('unknown parent records map exact native history, reasoned siblings, repeat and undo without losing counts',async()=>{
 const h=await nativeHarness();try{
  await h.db.prepare("INSERT INTO contacts(id,project_id,name,email,created_at) VALUES('keeper','p','Existing','existing@example.test',5)").run();const before=await h.snapshot(),r=records();
  const body=archive([{name:'empty/'},{name:'people.json',body:JSON.stringify({type:'list',customers:[r.contact]})},{name:'thread.jsonl',body:'\n'+JSON.stringify({kind:'list',history:r.conversation})},{name:'supplements.json',body:JSON.stringify({type:'list',extras:[r.macro,r.article],unknown_metadata:null})}]);
  const run=(await h.call(`${root}?vendor=intercom`,upload(body,'envelopes.zip'))).data;await h.drain();const ready=(await h.call(`${root}/${run.id}`)).data;
  assert.equal(ready.state,'ready');assert.equal(ready.plan.counts.input,6);assert.equal(ready.plan.counts.unique,6);assert.equal(ready.plan.counts.rejected,0);assert.equal(ready.plan.counts.effects,5);
  assert.deepEqual(ready.plan.decisions.map(d=>[d.kind,d.sourceId]).sort(),[['article','envelope-guide'],['contact','envelope-person'],['conversation','envelope-thread'],['macro','envelope-reply'],['tag-name','delivery'],['unsupported-field:unknown_metadata','/unknown_metadata']]);
  assert.deepEqual(ready.plan.diagnostics.filter(d=>d.message.startsWith('unsupported_envelope_field:')).map(d=>[d.kind,d.sourceId,d.location.artifact,d.location.row,d.location.pointer]),[['contact','envelope-person','people.json',1,'/customers/0'],['conversation','envelope-thread','thread.jsonl',2,'/history'],['macro','envelope-reply','supplements.json',1,'/extras/0'],['article','envelope-guide','supplements.json',1,'/extras/1']]);
  await h.call(`${root}/${run.id}/apply`,post({fingerprint:ready.plan.fingerprint}));await h.drain();assert.equal((await h.call(`${root}/${run.id}`)).data.state,'completed');
  assert.deepEqual((await h.db.prepare("SELECT name,email,created_at FROM contacts WHERE id<>'keeper'").all()).results,[{name:'Nadia',email:'nadia@example.test',created_at:1711929600000}]);
  assert.deepEqual((await h.db.prepare('SELECT content,actor_role,created_at FROM messages ORDER BY created_at').all()).results,[{content:'Where is my parcel?',actor_role:'contact',created_at:1712016000000},{content:'It arrives tomorrow.',actor_role:'operator',created_at:1712016300000}]);
  assert.deepEqual((await h.db.prepare('SELECT content FROM move_in_notes').all()).results,[{content:'Checked tracking.'}]);assert.deepEqual((await h.db.prepare('SELECT title,content FROM macros').all()).results,[{title:'Delivery reply',content:'Your parcel is on its way.'}]);assert.deepEqual((await h.db.prepare('SELECT title,status FROM knowledge_articles').all()).results,[{title:'Delivery guide',status:'published'}]);assert.deepEqual((await h.db.prepare('SELECT name FROM workspace_tags').all()).results,[{name:'Delivery'}]);assert.deepEqual((await h.db.prepare('SELECT assigned_to,resolved_at FROM conversations').all()).results,[{assigned_to:null,resolved_at:1712016600000}]);
  const completed=await h.snapshot(),repeat=await h.call(`${root}?vendor=intercom`,upload(body,'envelopes.zip'));assert.equal(repeat.alreadyImported,true);assert.equal(h.lastWrites,0);await unchanged(h,completed,'envelope-native-repeat');
  await h.call(`${root}/${run.id}/undo`,post({}));await h.drain();assert.equal((await h.call(`${root}/${run.id}`)).data.state,'undone');const after=await h.snapshot();for(const [table,rows] of Object.entries(before))if(!table.startsWith('move_in_')&&!table.startsWith('ik_')&&table!=='audit_events')assertUnchangedTable(table,rows,after[table]);
  // Undo restores every application row; the security log keeps the import and its undo.
  assert.deepEqual([...new Set((await h.db.prepare("SELECT action FROM audit_events WHERE target_id=? ORDER BY rowid").bind(run.id).all()).results.map(row=>row.action).filter(action=>action!=='import.resume'))],['import.started','import.apply','import.undo']);assert.equal(h.outbound,0);
 }finally{await h.close()}
});
});

test("erasure: erasing a contact removes every import custody that holds them and refuses any later upload carrying their aliases, while other people's data stays",async()=>{
await step('unknown parents retain known aliases for ordinary native erasure and changed replay in every admitted package',async()=>{
 const h=await nativeHarness();try{
  await h.db.prepare("INSERT INTO contacts(id,project_id,email,created_at) VALUES('ordinary','p','courier@example.test',1)").run();const runs=[];
  for(const [name,body] of positions(records().conversation).filter(([name])=>name.startsWith('foreign'))){const run=(await h.call(`${root}?vendor=intercom`,upload(body,name))).data;await h.drain();const ready=(await h.call(`${root}/${run.id}`)).data;assert.ok(ready.plan.decisions.some(d=>d.kind==='conversation'&&d.sourceId==='envelope-thread'));runs.push(run)}
  await h.call('/api/management/projects/p/contacts/ordinary/erase',post({}));for(const run of runs)assert.equal((await h.call(`${root}/${run.id}`)).data.state,'erased');assert.equal((await (await h.files).list()).objects.length,0);
  const before=await h.snapshot();for(const record of [{type:'contact',id:'courier-agent',email:'changed@example.test',created_at:1711929600},{type:'contact',id:'changed',external_id:'agent-archive',email:'changed@example.test',created_at:1711929600}]){const response=await h.raw(`${root}?vendor=intercom`,upload(JSON.stringify(record),'repackaged.json'));assert.equal(response.response.status,410);assert.equal(h.lastWrites,0);assert.equal(h.queued.length,0)}await unchanged(h,before,'unknown-parent-alias-fences');assert.equal(h.outbound,0);
 }finally{await h.close()}
});
});

test("recovery: interrupted work resumes from durable state after a killed Worker, a broken checkpoint or tampered originals, without duplicating history",async()=>{
await step('directory-heavy extraction resumes after actual SIGKILL with physical cursor and exact file custody',async()=>{
 const h=await nativeHarness();try{
  const r=records(),entries=[...Array.from({length:25},(_,i)=>({name:`empty-${i}/`,method:i%2?0:8})),{name:'person.json',body:JSON.stringify({type:'list',unknown:r.contact})},{name:'thread.json',body:JSON.stringify({type:'list',unknown:r.conversation})}],body=archive(entries),run=(await h.call(`${root}?vendor=intercom`,upload(body,'resume.zip'))).data;
  await h.step();const first=await h.db.prepare('SELECT state,cursor,files_json FROM move_in_runs WHERE id=?').bind(run.id).first();assert.equal(first.state,'uploaded');assert.equal(first.cursor,20);assert.deepEqual(JSON.parse(first.files_json),[]);
  await h.crashDuringStep();await h.call(`${root}/${run.id}/resume`,post({}));await h.drain();const ready=(await h.call(`${root}/${run.id}`)).data;assert.equal(ready.state,'ready');assert.equal(ready.plan.counts.unique,3);assert.equal(ready.plan.counts.rejected,0);
  const files=JSON.parse((await h.db.prepare('SELECT files_json FROM move_in_runs WHERE id=?').bind(run.id).first()).files_json);assert.deepEqual(files.map(f=>f.name),['person.json','thread.json']);assert.equal(new Set(files.map(f=>f.key)).size,2);for(let i=0;i<2;i++)assert.equal(await (await (await h.files).get(files[i].key)).text(),entries[i+25].body);
  await h.call(`${root}/${run.id}/apply`,post({fingerprint:ready.plan.fingerprint}));await h.drain();assert.equal((await h.call(`${root}/${run.id}`)).data.state,'completed');assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM conversations').first()).n,1);assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM messages').first()).n,2);assert.equal(h.outbound,0);
 }finally{await h.close()}
});
});
