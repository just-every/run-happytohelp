import {phases,matrix} from '../journeys/kit/scenarios.mjs';
const test=phases(import.meta.url);
import assert from 'node:assert/strict';
import {nativeHarness} from './harness.mjs';
import {person,upload,state,apply,json,root} from './correction-fixtures.mjs';
async function advanceUntil(h,run,ready){
 const deadline=Date.now()+120000;
 while(!await ready(await state(h,run))){
  assert.ok(Date.now()<deadline,'publication reaches the requested committed state');
  assert.ok(h.queued.length,'publication still has work before the requested state');
  await h.step();
 }
}
test('a native collision between committed batches stops publication, survives resume and permits safe undo',async()=>{const h=await nativeHarness();try{
 const run=await upload(h,Array.from({length:25},(_,i)=>person(`part-${i}`,`part-${i}@example.test`)));await h.drain();await h.call(`${root}/${run.id}/apply`,json({fingerprint:(await state(h,run)).plan.fingerprint}));await advanceUntil(h,run,row=>row.cursor===20);
 assert.equal((await state(h,run)).cursor,20);assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM contacts').first()).n,20);
 await h.db.prepare("INSERT INTO contacts(id,project_id,email,name,created_at) VALUES('keeper','p','PART-24@example.test','Native keeper',123)").run();const keeper=await h.db.prepare("SELECT * FROM contacts WHERE id='keeper'").first();await h.drain();
 let stopped=await state(h,run);assert.equal(stopped.state,'applying');assert.equal(stopped.cursor,20);assert.equal(stopped.error,'native_contact_changed_since_review');assert.equal(stopped.report.checkpoint,20);assert.equal(stopped.report.total,25);assert.equal(stopped.report.counts.mapped,25);
 assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM contacts').first()).n,21);assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM ik_provenance').first()).n,20);
 await h.call(`${root}/${run.id}/resume`,json({}));await h.drain();stopped=await state(h,run);assert.equal(stopped.error,'native_contact_changed_since_review');assert.equal(stopped.cursor,20);assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM contacts').first()).n,21);
 assert.equal((await h.raw(`${root}/${run.id}/undo`,{...json({}),actor:'operator'})).response.status,403);await h.call(`${root}/${run.id}/undo`,json({}));await h.drain();const undone=await state(h,run);assert.equal(undone.error,null);assert.equal(undone.state,'undone');assert.equal(undone.report.total,20);assert.equal(undone.report.checkpoint,20);assert.deepEqual((await h.db.prepare('SELECT * FROM contacts').all()).results,[keeper]);assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM move_in_origins').first()).n,0);assert.equal(h.outbound,0);
 }finally{await h.close()}});

test('publication predicates above two megabytes execute as individually bounded native D1 statements',async()=>{const h=await nativeHarness();try{
 const contacts=Array.from({length:3615},(_,i)=>({id:'mi_'+String(i).padStart(40,'0'),email:'a'.repeat(64),external:'import:intercom:'+String(i).padStart(512,'x')}));assert.ok(Buffer.byteLength(JSON.stringify(contacts))>2000000);
 const limits=await h.call('/_test/publication-boundary',json(contacts));assert.equal(limits.predicates,9);assert.ok(limits.statements<1000);assert.ok(limits.maxBindings<=100);assert.ok(limits.maxParameterBytes<2000000);assert.ok(limits.maxSqlBytes<100000);assert.equal((await h.db.prepare("SELECT COUNT(*) n FROM workspace_tags WHERE id='boundary'").first()).n,1);console.log(JSON.stringify({publicationBoundaryContacts:3615,...limits}));
 }finally{await h.close()}});

test("previous review manifest remains resumable with current collision protection",matrix([false,true],async (collision)=>{const h=await nativeHarness();try{
 const run=await upload(h,[person()]);await h.drain();assert.deepEqual(await h.call('/_test/legacy-review',json({id:run.id})),{legacy:true});
 if(collision)await h.db.prepare("INSERT INTO contacts(id,project_id,email,created_at) VALUES('native','p','CUSTOMER@example.test',1)").run();
 const result=await apply(h,run);assert.equal(result.state,collision?'applying':'completed');assert.equal(result.error,collision?'native_contact_changed_since_review':null);assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM contacts').first()).n,1);
 }finally{await h.close()}}));

test("stopped publication can undo a queued child at every saved progress boundary",matrix([0,20],async (progress)=>{const h=await nativeHarness();try{
 const run=await upload(h,Array.from({length:25},(_,i)=>person(`queued-${i}`,`queued-${i}@example.test`)));await h.drain();await h.call(`${root}/${run.id}/apply`,json({fingerprint:(await state(h,run)).plan.fingerprint}));await advanceUntil(h,run,async row=>row.cursor===progress&&(await h.db.prepare("SELECT COUNT(*) n FROM ik_jobs WHERE state='queued'").first()).n===1);
 assert.equal((await state(h,run)).cursor,progress);assert.equal((await h.db.prepare("SELECT COUNT(*) n FROM ik_jobs WHERE state='queued'").first()).n,1);await h.db.prepare("INSERT INTO contacts(id,project_id,email,name,created_at) VALUES('keeper','p','QUEUED-24@example.test','Native keeper',123)").run();const keeper=await h.db.prepare("SELECT * FROM contacts WHERE id='keeper'").first();await h.drain();assert.equal((await state(h,run)).error,'native_contact_changed_since_review');
 await h.call(`${root}/${run.id}/undo`,json({}));await h.drain();const undone=await state(h,run);assert.equal(undone.state,'undone');assert.equal(undone.error,null);assert.equal(undone.report.checkpoint,progress);assert.equal(undone.report.total,progress);assert.deepEqual((await h.db.prepare('SELECT * FROM contacts').all()).results,[keeper]);assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM move_in_origins').first()).n,0);assert.equal(h.outbound,0);
 }finally{await h.close()}}));
