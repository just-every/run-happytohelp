import assert from 'node:assert/strict'
import {nativeHarness} from './harness.mjs'
import {generate} from './generator.mjs'
import {assertBusinessEquality} from './business-equality.mjs'
import {root,json,upload,review,state} from './journey-kit.mjs'

// Concurrent real queue requests exercise the checkpoint claim and conditional
// private writes; duplicate delivery never acquires another delivery's bytes.
async function duplicates(h){
 let count=0
 while(h.queued.length){assert.ok(count++<1000);const job=h.queued.shift(),results=await Promise.all([h.step([job]),h.step([job])]);for(const result of results)assert.deepEqual(result.retried,[])}
}
const h=await nativeHarness()
try{
 const before=await h.snapshot(),run=await upload(h,'zendesk',generate('zendesk',6),'synthetic-hh-duplicate.jsonl')
 await duplicates(h);const ready=await state(h,run);assert.equal(ready.state,'ready');assert.equal(ready.error,null)
 await h.call(`${root}/${run.id}/apply`,json({fingerprint:ready.plan.fingerprint}))
 // A late private writer retaining identical bytes must not poison a winner.
 await (await h.files).put(`move-in/p/${run.id}/original`,generate('zendesk',6));await duplicates(h)
 assert.equal((await state(h,run)).state,'completed')
 assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM conversations').first()).n,6)
 assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM messages').first()).n,12)
 await h.call(`${root}/${run.id}/undo`,json({}));await duplicates(h)
 assert.equal((await state(h,run)).state,'undone');assertBusinessEquality(before,await h.snapshot())
 // Replacing a source with different bytes of the same size, or deleting it,
 // cannot be hidden behind the approved D1 checkpoint.
 for(const mutation of ['replace','delete']){
  const source=generate('zendesk',1)+(mutation==='delete'?'\n':''),ready=await review(h,'zendesk',source,`synthetic-hh-${mutation}.jsonl`),snapshot=await h.snapshot()
  await h.call(`${root}/${ready.id}/apply`,json({fingerprint:ready.plan.fingerprint}))
  const files=await h.files,key=`move-in/p/${ready.id}/original`
  if(mutation==='replace')await files.put(key,source.replace('Published guide','Published guidx'));else await files.delete(key)
  await h.drain();const stopped=await state(h,ready)
  assert.equal(stopped.state,'applying');assert.equal(stopped.error,'source_custody_changed');assertBusinessEquality(snapshot,await h.snapshot())
 }
 assert.equal(h.outbound,0)
 console.log('APPLY_FENCES duplicate apply/undo, private custody, replacement and deletion passed')
}finally{await h.close()}
