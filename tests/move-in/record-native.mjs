import {phases,matrix} from '../journeys/kit/scenarios.mjs';
const test=phases(import.meta.url);
import assert from 'node:assert/strict';
import {nativeHarness} from './harness.mjs';
import {unchanged} from './admission-equality.mjs';
import {intercomRecords,zendeskRecords,recordPackages,ambiguousRecords} from './record-inputs.mjs';
import {zip} from './zip.mjs';
const root='/api/move-in/projects/p/imports',post=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const upload=(body,name='record.json',actor='owner')=>({method:'POST',actor,headers:{'X-Import-Filename':name,'X-Import-Schema':'2.16'},body});
test("root JSON retains known aliases and correct decisions through ordinary native erasure and changed replay",matrix(['contact','source','participant'],async (slot)=>{
 const h=await nativeHarness();try{
  await h.db.batch([h.db.prepare("INSERT INTO contacts(id,project_id,email,external_id,created_at) VALUES('erase','p','record-private@example.test','native-external',1)"),h.db.prepare("INSERT INTO contacts(id,project_id,email,name,created_at) VALUES('keeper','p','keep@example.test','Keep',2)")]);
  const keeper=await h.db.prepare("SELECT * FROM contacts WHERE id='keeper'").first(),runs=[];let toApply;
  for(const order of ['before','after']){
   const records=intercomRecords(),record=slot==='contact'?records.contact:records.conversation,person=slot==='contact'?record:slot==='source'?record.source.author:record.contacts.contacts[0];person.email='record-private@example.test';person.external_id=`${slot}-original-external`;const id=person.id;
   const decorated=order==='before'?{data:[],...record}:{...record,data:[]};
   for(const [name,body,pointer] of recordPackages(decorated)){
    const run=(await h.call(`${root}?vendor=intercom`,upload(body,`${order}-${name}`))).data;await h.drain();const ready=(await h.call(`${root}/${run.id}`)).data;runs.push(run);
    const kind=slot==='contact'?'contact':'conversation',decision=ready.plan.decisions.find(row=>row.kind===kind);assert.ok(decision,`${slot}/${order}/${name}`);assert.equal(decision.sourceId,record.id);assert.equal(ready.plan.counts.unique,slot==='contact'?1:2);assert.equal(ready.plan.counts.rejected,1);assert.equal(ready.plan.decisions.filter(row=>row.kind.startsWith('unsupported-field:')).length,0);assert.ok(ready.plan.diagnostics.some(row=>row.code==='unsupported_source_field'&&row.location.pointer===pointer+'/data'));
   }
   // Separate root documents in ZIP preserve the same conversation mapping.
   const entries=slot==='contact'?[{name:'root.json',body:JSON.stringify(decorated)}]:[{name:'person.json',body:JSON.stringify(records.contact)},{name:'root.json',body:JSON.stringify(decorated)}],run=(await h.call(`${root}?vendor=intercom`,upload(zip(entries),`${order}-multi.zip`))).data;await h.drain();runs.push(run);const ready=(await h.call(`${root}/${run.id}`)).data;
   if(slot!=='contact'){assert.equal(ready.plan.counts.rejected,0);assert.equal(ready.plan.counts.unique,3);assert.equal(ready.plan.counts.effects,3);if(order==='before')toApply={run,ready}}
   assert.ok(id);
  }
  if(toApply){await h.call(`${root}/${toApply.run.id}/apply`,post({fingerprint:toApply.ready.plan.fingerprint}));await h.drain();assert.equal((await h.call(`${root}/${toApply.run.id}`)).data.state,'completed')}
  await h.call('/api/management/projects/p/contacts/erase/erase',post({}));
  for(const run of runs)assert.equal((await h.call(`${root}/${run.id}`)).data.state,'erased');assert.equal((await (await h.files).list()).objects.length,0);assert.deepEqual(await h.db.prepare("SELECT * FROM contacts WHERE id='keeper'").first(),keeper);
  const original=intercomRecords(),id=slot==='contact'?original.contact.id:slot==='source'?original.conversation.source.author.id:original.conversation.contacts.contacts[0].id;
  const before=await h.snapshot();for(const changed of [{type:'contact',id,email:'changed@example.test',created_at:1704067200},{type:'contact',id:'changed-source',email:'changed-again@example.test',external_id:`${slot}-original-external`,created_at:1704067200}])for(const [name,body] of recordPackages(changed)){assert.equal((await h.raw(`${root}?vendor=intercom`,upload(body,name))).response.status,410);assert.equal(h.lastWrites,0);assert.equal(h.queued.length,0)}
  await unchanged(h,before,`record-${slot}-erased-replay`);assert.equal((await (await h.files).list()).objects.length,0);assert.equal(h.outbound,0);
 }finally{await h.close()}
}));
test('ambiguous documents and mixed wrappers refuse every packaging before D1/R2 custody, with authority and inertness intact',async()=>{
 const h=await nativeHarness();try{const before=await h.snapshot();
  for(const [record,code,pointer] of ambiguousRecords())for(const [name,body,prefix] of recordPackages(record).slice(0,4)){
   const result=await h.raw(`${root}?vendor=intercom`,upload(body,name));assert.equal(result.response.status,422);assert.deepEqual(result.data.diagnostic,{code,location:{artifact:name,row:2,pointer:prefix+pointer}});assert.equal(h.lastWrites,0);assert.equal(h.queued.length,0);assert.equal((await (await h.files).list()).objects.length,0);
  }
  const mixed={...zendeskRecords().user,...zendeskRecords().ticket};for(const record of [mixed,Object.fromEntries(Object.entries(mixed).reverse()),{users:[mixed.user]}]){const result=await h.raw(`${root}?vendor=zendesk`,upload('\n'+JSON.stringify(record),'mixed.ndjson'));assert.equal(result.response.status,422);assert.equal(result.data.diagnostic.code,'singular_wrapper_required');assert.equal(result.data.diagnostic.location.row,2);assert.equal(h.lastWrites,0)}
  const body=zip([{name:'first.json',body:JSON.stringify(intercomRecords().contact)},...Array.from({length:20},(_,i)=>({name:`control-${i}.json`,body:JSON.stringify(intercomRecords().article)})),{name:'later/bad.json',body:'\n'+JSON.stringify(ambiguousRecords()[0][0])}]),result=await h.raw(`${root}?vendor=intercom`,upload(body,'multi.zip'));assert.equal(result.response.status,422);assert.deepEqual(result.data.diagnostic,{code:'conflicting_record_discriminator',location:{artifact:'later/bad.json',row:2,pointer:'/kind'}});assert.equal(h.lastWrites,0);assert.equal(h.queued.length,0);
  for(const actor of ['operator','foreign']){const denied=await h.raw(`${root}?vendor=intercom`,upload(JSON.stringify(intercomRecords().contact),'record.json',actor));assert.ok([403,404].includes(denied.response.status));assert.equal(h.lastWrites,0)}
  await unchanged(h,before,'record-document-refusals');assert.equal((await (await h.files).list()).objects.length,0);assert.equal(h.outbound,0);
 }finally{await h.close()}
});
test('separate typed JSON documents with collection siblings map all four kinds and derived tags exactly in native Worker',async()=>{
 const h=await nativeHarness();try{
  const body=zip(Object.entries(intercomRecords()).map(([kind,record])=>({name:kind+'.json',body:JSON.stringify({...record,data:[]})}))),run=(await h.call(`${root}?vendor=intercom`,upload(body,'typed-roots.zip'))).data;await h.drain();const ready=(await h.call(`${root}/${run.id}`)).data;
  assert.equal(ready.plan.counts.unique,5);assert.equal(ready.plan.counts.rejected,0);assert.equal(ready.plan.counts.effects,5);assert.deepEqual(ready.plan.decisions.map(row=>row.kind).sort(),['article','contact','conversation','macro','tag-name']);
  await h.call(`${root}/${run.id}/apply`,post({fingerprint:ready.plan.fingerprint}));await h.drain();assert.equal((await h.call(`${root}/${run.id}`)).data.state,'completed');
  assert.deepEqual((await h.db.prepare('SELECT name,email,created_at FROM contacts').all()).results,[{name:'Mara',email:'person31@example.test',created_at:1704067200000}]);assert.deepEqual((await h.db.prepare('SELECT content,actor_role FROM messages').all()).results,[{content:'Opening message',actor_role:'operator'}]);assert.deepEqual((await h.db.prepare('SELECT content FROM move_in_notes').all()).results,[{content:'Private note'}]);assert.deepEqual((await h.db.prepare('SELECT title,content FROM macros').all()).results,[{title:'Greeting',content:'Hello Mara'}]);assert.deepEqual((await h.db.prepare('SELECT title,status FROM knowledge_articles').all()).results,[{title:'Guide',status:'draft'}]);assert.deepEqual((await h.db.prepare('SELECT name FROM workspace_tags').all()).results,[{name:'Returns'}]);
  const before=await h.snapshot(),repeat=await h.call(`${root}?vendor=intercom`,upload(body,'typed-roots.zip'));assert.equal(repeat.alreadyImported,true);assert.equal(h.lastWrites,0);await unchanged(h,before,'record-native-repeat');assert.equal(h.outbound,0);
 }finally{await h.close()}
});
