import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdir,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {nativeHarness} from './harness.mjs'
import {largeUndoFixture} from './large-undo-fixture.mjs'
import {assertBusinessEquality,businessSnapshot} from './business-equality.mjs'
import {root,json,upload,state,review} from './journey-kit.mjs'

const hash=snapshot=>createHash('sha256').update(JSON.stringify(businessSnapshot(snapshot))).digest('hex')
export async function largeUndoJourney(){
 const h=await nativeHarness({withConversations:true}),source=largeUndoFixture(),steps=[],reads=[]
 try{
  await h.db.batch([h.db.prepare("INSERT INTO contacts(id,project_id,name,email,created_at) VALUES('native-contact','p','Native','native@example.test',1)"),h.db.prepare("INSERT INTO conversations(id,project_id,contact_id,created_at,updated_at) VALUES('native-conversation','p','native-contact',1,1)")])
  const before=await h.snapshot(),run=await upload(h,'zendesk',source,'synthetic-hh-large-undo.jsonl')
  await h.drain();console.log('LARGE_UNDO_PHASE reviewed');const ready=await state(h,run);assert.equal(ready.state,'ready');assert.equal(ready.plan.counts.rejected,0)
  await h.call(`${root}/${run.id}/apply`,json({fingerprint:ready.plan.fingerprint}));await h.drain()
  console.log('LARGE_UNDO_PHASE applied');const applied=await state(h,run);assert.equal(applied.state,'completed')
  for(const [table,count] of [['contacts',1001],['conversations',1001],['messages',1000],['move_in_notes',1000],['workspace_tags',2],['macros',1],['knowledge_articles',1]])assert.equal((await h.db.prepare(`SELECT COUNT(*) n FROM ${table}`).first()).n,count,table)
  const after=await h.snapshot(),repeat=await upload(h,'zendesk',source,'synthetic-hh-large-undo.jsonl')
  assert.equal(repeat.id,run.id);assert.equal(h.lastWrites,0);const repeated=await h.snapshot();assertBusinessEquality(after,repeated)
  const {data:initial}=await h.call(`${root}/${run.id}/undo`,json({})),total=ready.plan.counts.effects
  assert.equal(initial.report.total,total);assert.equal(initial.report.checkpoint,0);assert.equal(initial.cursor,0);assert.equal(initial.report.retained,total)
  let previous=0,restarted=false,checks=0
  while(h.queued.length){
   const start=performance.now()
   const pending=h.step()
   // An ordinary owner read must finish even while the reversal is executing.
   const readAt=performance.now();await h.call('/api/dashboard/projects/p/conversations');reads.push(performance.now()-readAt)
   const result=await pending;steps.push(performance.now()-start);assert.deepEqual(result.retried,[]);assert.deepEqual(result.effects,{widget:0});assert.ok(result.statements<=1000)
   const current=await state(h,run);assert.equal(current.error,null);assert.equal(current.report.total,total);assert.ok(current.report.checkpoint>=previous);assert.ok(current.report.checkpoint-previous<=20,'one delivery reverses at most one native batch');assert.equal(current.report.retained,total-current.report.checkpoint);assert.equal(current.report.removed+current.report.restored,current.report.checkpoint);previous=current.report.checkpoint
   if(++checks%50===0)console.log('LARGE_UNDO_PHASE reversing',previous,total);
   if(checks%20===0){await h.call('/api/dashboard/projects/p/contacts');await h.call('/api/dashboard/projects/p/contacts/native-contact');await h.call('/api/dashboard/projects/p/conversations/native-conversation/triage');await h.call('/health')}
   if(!restarted&&previous>20&&previous<total){
    await h.crashDuringStep();const recovered=await state(h,run);assert.equal(recovered.report.total,total);assert.ok(recovered.report.checkpoint>=previous);previous=recovered.report.checkpoint
    await h.call(`${root}/${run.id}/resume`,json({}));restarted=true
   }
   assert.ok(checks<2000)
  }
  const undone=await state(h,run);assert.equal(undone.state,'undone');assert.deepEqual(undone.report,{state:'undone',total,checkpoint:total,removed:total,restored:0,retained:0});assert.ok(restarted)
  const end=await h.snapshot();assertBusinessEquality(before,end);assert.equal(h.outbound,0)
  assert.ok(Math.max(...steps)<5000,'undo yields in under five seconds per delivery');assert.ok(Math.max(...reads)<5000,'ordinary inbox reads remain usable during undo')
  const receipt={head:process.env.H2H_CANDIDATE_SHA??null,sourceBytes:Buffer.byteLength(source),customers:1000,tickets:1000,reviewRecords:ready.plan.counts.unique,nativeEffects:total,undo:undone.report,undoSteps:steps.length,maxUndoStepMs:Math.max(...steps),maxConcurrentReadMs:Math.max(...reads),maxStatements:h.maxStatements,restarted,businessTables:Object.keys(businessSnapshot(before)),beforeImportHash:hash(before),afterUndoHash:hash(end),beforeRepeatHash:hash(after),afterRepeatHash:hash(repeated),repeatWrites:0,outbound:h.outbound}
  const directory=process.env.H2H_EVIDENCE_DIR||'test-results';await mkdir(directory,{recursive:true});await writeFile(join(directory,'large-undo-business-equality.json'),JSON.stringify(receipt,null,2)+'\n');console.log('LARGE_UNDO',JSON.stringify(receipt))
 }finally{await h.close()}
}

export async function partialUndoJourney(){
 const h=await nativeHarness()
 try{
  const before=await h.snapshot(),source=largeUndoFixture(25),run=await review(h,'zendesk',source,'synthetic-hh-partial-undo.jsonl')
  await h.call(`${root}/${run.id}/apply`,json({fingerprint:run.plan.fingerprint}))
  while(!(await h.db.prepare('SELECT 1 FROM contacts LIMIT 1').first()))await h.step()
  // A database failure after a committed child is a real stopped partial apply.
  await h.db.prepare("CREATE TRIGGER synthetic_stop BEFORE INSERT ON contacts BEGIN SELECT RAISE(ABORT,'synthetic interruption'); END").run()
  await h.drain();assert.equal((await state(h,run)).state,'applying');assert.ok((await state(h,run)).error)
  await h.db.prepare('DROP TRIGGER synthetic_stop').run()
  const {data:initial}=await h.call(`${root}/${run.id}/undo`,json({}));assert.ok(initial.report.total>0&&initial.report.total<run.plan.counts.effects)
  const total=initial.report.total
  while(h.queued.length){await h.step();assert.equal((await state(h,run)).report.total,total)}
  const done=await state(h,run);assert.equal(done.state,'undone');assert.equal(done.report.removed,total);assert.equal(done.report.retained,0);const after=await h.snapshot();assertBusinessEquality(before,after);assert.equal(h.outbound,0)
  const directory=process.env.H2H_EVIDENCE_DIR||'test-results';await mkdir(directory,{recursive:true});await writeFile(join(directory,'partial-undo-business-equality.json'),JSON.stringify({head:process.env.H2H_CANDIDATE_SHA??null,plannedEffects:run.plan.counts.effects,undo:done.report,beforeImportHash:hash(before),afterUndoHash:hash(after),outbound:h.outbound},null,2)+'\n')
  console.log('PARTIAL_UNDO',JSON.stringify(done.report))
 }finally{await h.close()}
}
