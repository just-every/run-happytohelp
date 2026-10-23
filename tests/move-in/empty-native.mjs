import {phases} from '../journeys/kit/scenarios.mjs';
const test=phases(import.meta.url);
import assert from 'node:assert/strict';
import {nativeHarness} from './harness.mjs';
import {unchanged} from './admission-equality.mjs';
import {emptyCases,emptyReason,laterSource,sourceName,upload} from './empty-inputs.mjs';
const root='/api/move-in/projects/p/imports';
const post=(body,actor='owner')=>({method:'POST',actor,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
for(const vendor of ['zendesk','intercom']){
 test(`${vendor}: current owners and admins refuse all empty uploads before private custody or effects`,async()=>{
  const h=await nativeHarness();try{
   const before=await h.snapshot(),cases=emptyCases(vendor);
   for(const [actor,status] of [['operator',403],['foreign',404]])for(const [name,body] of cases){
    const denied=await h.raw(`${root}?vendor=${vendor}`,upload(body,name,actor));assert.equal(denied.response.status,status);assert.equal(h.lastWrites,0);assert.equal(h.queued.length,0);
   }
   await unchanged(h,before,`${vendor}-empty-authority`);
   await h.db.batch([h.db.prepare("UPDATE memberships SET role='admin' WHERE project_id='p' AND user_id='operator'"),h.db.prepare("UPDATE sessions SET role='admin' WHERE project_id='p' AND actor_id='operator'")]);
   const authorizedBefore=await h.snapshot();
   for(const actor of ['owner','operator'])for(const [name,body] of [...cases,[vendor==='zendesk'?'absent.ndjson':'absent.json',undefined]]){
    const refused=await h.raw(`${root}?vendor=${vendor}`,upload(body,name,actor));assert.equal(refused.response.status,422);
    assert.deepEqual(refused.data.diagnostic,{code:'empty_export',location:{artifact:name,row:1,pointer:''}});
    assert.equal(refused.data.error,`Upload refused: ${name}, line 1, path /: ${emptyReason}. No source files or import were saved.`);
    assert.equal(h.lastWrites,0);assert.equal(h.queued.length,0);assert.equal((await (await h.files).list()).objects.length,0);
   }
   await unchanged(h,authorizedBefore,`${vendor}-empty-admission`);
   for(const table of ['move_in_runs','move_in_records','move_in_batches','move_in_identity_links','ik_jobs'])assert.equal((await h.db.prepare(`SELECT COUNT(*) n FROM ${table}`).first()).n,0);
   assert.equal(h.outbound,0);
  }finally{await h.close()}
 });
 test(`${vendor}: blank auxiliary members permit later records and unsupported records keep their reasoned plan`,async()=>{
  const h=await nativeHarness();try{
   const {body,entries}=laterSource(vendor),run=(await h.call(`${root}?vendor=${vendor}`,upload(body,'later.zip'))).data;
   await h.step();const first=await h.db.prepare('SELECT state,cursor,files_json FROM move_in_runs WHERE id=?').bind(run.id).first();assert.equal(first.state,'uploaded');assert.equal(first.cursor,20);assert.deepEqual(JSON.parse(first.files_json),[]);
   await h.drain();const ready=(await h.call(`${root}/${run.id}`)).data;
   assert.equal(ready.state,'ready');assert.equal(ready.error,null);assert.equal(ready.plan.counts.input,1);assert.equal(ready.plan.counts.unique,1);assert.equal(ready.plan.counts.effects,1);assert.equal(ready.plan.counts.rejected,0);
   assert.deepEqual(ready.plan.decisions.map(d=>[d.kind,d.sourceId,d.location]),[[vendor==='zendesk'?'user':'contact',vendor==='zendesk'?'83':'person-83',{artifact:sourceName(vendor),row:2}]]);
   const stored=await h.db.prepare('SELECT object_key,files_json,identity_complete FROM move_in_runs WHERE id=?').bind(run.id).first(),files=JSON.parse(stored.files_json),original=await (await h.files).get(stored.object_key);assert.deepEqual(Buffer.from(await original.arrayBuffer()),body);assert.equal(stored.identity_complete,1);
   const expected=entries.filter(entry=>!entry.name.endsWith('/'));assert.deepEqual(files.map(file=>file.name),expected.map(entry=>entry.name));for(let i=0;i<files.length;i++){assert.equal(await (await (await h.files).get(files[i].key)).text(),expected[i].body);assert.equal(files[i].index.length,i===files.length-1?1:0)}
   await h.call(`${root}/${run.id}/apply`,post({fingerprint:ready.plan.fingerprint}));await h.drain();assert.equal((await h.call(`${root}/${run.id}`)).data.state,'completed');assert.deepEqual((await h.db.prepare('SELECT name,email,created_at FROM contacts').all()).results,[{name:'Keira',email:'keira@example.test',created_at:1711929600000}]);
   const unsupported=laterSource(vendor,{unsupported:true}),omitted=(await h.call(`${root}?vendor=${vendor}`,upload(unsupported.body,'unsupported.zip'))).data;await h.drain();const plan=(await h.call(`${root}/${omitted.id}`)).data.plan,kind=vendor==='zendesk'?'organization':'company';
   assert.equal(plan.counts.input,1);assert.equal(plan.counts.unique,1);assert.equal(plan.counts.effects,0);assert.equal(plan.counts.rejected,0);assert.equal(plan.decisions.length,1);
   assert.deepEqual(plan.decisions.map(d=>[d.kind,d.sourceId,d.omissions,d.targets]),[[kind,vendor==='zendesk'?'91':'company-91',[{reason:`unsupported_record_kind:${kind}`}],[]]]);
   assert.equal(h.queued.length,0);assert.equal(h.outbound,0);
  }finally{await h.close()}
 });
}
