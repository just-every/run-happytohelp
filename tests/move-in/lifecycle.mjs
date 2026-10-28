import assert from 'node:assert/strict';
import {nativeHarness} from './harness.mjs';
import {generate,generateDiagnostics} from './generator.mjs';
import {suppliedFreshdesk,publicBytes,privateBytes} from './supplied-attachments.mjs';
import {cannedResponse} from './freshdesk-fixtures.mjs';
import {configurationLifecycle} from './door-mapping.mjs';
import {assertBusinessEquality} from './business-equality.mjs';
const base='/api/move-in/projects/p/imports';
export const post=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
export const read=(h,run)=>h.call(`${base}/${run.id}`).then(r=>r.data);
export async function upload(h,vendor,source,name=`${vendor}.jsonl`){return (await h.call(`${base}?vendor=${vendor}`,{method:'POST',headers:{'X-Import-Filename':name,'X-Import-Schema':'2.16'},body:source})).data;}
export async function publish(h,run){await h.drain();const ready=await read(h,run);await h.call(`${base}/${run.id}/apply`,post({fingerprint:ready.plan.fingerprint}));await h.drain();assert.equal((await read(h,run)).state,'completed');}

// One workspace switches source exports in turn. Each review is inert, each
// publish is read through the inbox, and exact undo restores that workspace.
export async function importLifecycle(){
 const h=await nativeHarness();try{
  const rejected=await h.raw(`${base}?vendor=zendesk`,{method:'POST',headers:{'X-Import-Filename':'broken.jsonl'},body:'{"user":'});
  assert.equal(rejected.response.status,422);assert.equal(rejected.data.diagnostic.location.artifact,'broken.jsonl');assert.equal(h.lastWrites,0);assert.equal(h.queued.length,0);assert.equal((await (await h.files).list()).objects.length,0);
  for(const vendor of ['zendesk','intercom','helpscout','freshdesk']){
   const source=vendor==='freshdesk'?[...suppliedFreshdesk(),cannedResponse].map(JSON.stringify).join('\n'):generate(vendor,2);
   const authorityBefore=await h.db.prepare('SELECT * FROM integration_authority_epoch WHERE id=1').first();
   const before=await h.snapshot(),run=await upload(h,vendor,source);await h.drain();const review=await read(h,run);
   assert.equal(review.state,'ready');assert.equal(review.plan.counts.rejected,0,JSON.stringify(review.plan));assert.ok(review.plan.decisions.some(r=>r.kind===(['zendesk','freshdesk'].includes(vendor)?'ticket':'conversation')));assert.ok(review.plan.decisions.some(r=>r.kind===(vendor==='zendesk'?'user':'contact')));
   assertBusinessEquality(before,await h.snapshot());
   const custody=await h.db.prepare('SELECT object_key FROM move_in_runs WHERE id=?').bind(run.id).first();assert.equal(await (await (await h.files).get(custody.object_key)).text(),source);
   assert.equal((await h.raw(`${base}/${run.id}`,{actor:'foreign'})).response.status,404);
   assert.equal((await h.raw(`${base}/${run.id}/apply`,{...post({fingerprint:review.plan.fingerprint}),actor:'operator'})).response.status,403);
   await h.call(`${base}/${run.id}/apply`,post({fingerprint:review.plan.fingerprint}));
   await h.step();await h.call(`${base}/${run.id}/resume`,post({}));await h.drain();assert.equal((await read(h,run)).state,'completed');
   // These exports include resolved history; the default inbox only shows open
   // work. Read all history so the full imported count remains an assertion.
   const inbox=await h.call('/api/dashboard/projects/p/conversations?status=all');assert.equal(inbox.data.length,vendor==='freshdesk'?1:2);
   const c=await h.db.prepare('SELECT id,contact_id FROM conversations ORDER BY id LIMIT 1').first();
   const detail=await h.call(`/api/dashboard/projects/p/conversations/${c.id}`);assert.ok(detail.data.imported);assert.ok(detail.data.tags.length);
   assert.deepEqual(await h.db.prepare('SELECT * FROM integration_authority_epoch WHERE id=1').first(),authorityBefore,'import leaves native session authority unchanged');
   await h.contactSession('visitor','p',c.contact_id);
   const visitor=JSON.stringify(await h.call(`/api/conversations/${c.id}/messages`,{actor:'visitor'}));assert.doesNotMatch(visitor,/Private note|Private triage|private-triage/);
   assert.ok((await h.db.prepare('SELECT count(*) n FROM move_in_notes').first()).n);
   if(vendor==='freshdesk'){
    const media=(await h.db.prepare('SELECT * FROM media').all()).results;assert.equal(media.length,2);
    for(const file of media){const path=`/api/conversations/${c.id}/media/${file.id}`;assert.deepEqual((await h.download(path)).bytes,file.message_id?publicBytes:privateBytes);assert.equal((await h.download(path,'visitor')).status,file.message_id?200:404);assert.equal((await h.download(path,'foreign')).status,404);}
   }else{
    assert.equal((await h.db.prepare("SELECT count(*) n FROM knowledge_articles WHERE status='published'").first()).n,1);
    assert.equal((await h.db.prepare("SELECT count(*) n FROM knowledge_articles WHERE status='draft'").first()).n,1);
   }
   // The visitor signs in after publication, then signs out before undo. Both
   // native session operations advance authority; undo must retain that current
   // authority while restoring every other business row to the original state.
   assert.equal((await h.db.prepare("SELECT count(*) n FROM sessions WHERE role='contact'").first()).n,1);
   await h.db.prepare("DELETE FROM sessions WHERE role='contact'").run();
   assert.equal((await h.db.prepare("SELECT count(*) n FROM sessions WHERE role='contact'").first()).n,0);
   const authorityAfter=await h.db.prepare('SELECT * FROM integration_authority_epoch WHERE id=1').first();
   assert.deepEqual(authorityAfter,{...authorityBefore,revision:authorityBefore.revision+2},'only visitor session creation and deletion advance authority');
   const undoExpected={...before,integration_authority_epoch:before.integration_authority_epoch.map(row=>({...row,revision:{sqliteInteger:String(authorityAfter.revision)}}))};
   for(const table of ['conversation_resolutions','conversation_ratings','message_authorship','native_integration_events','native_integration_intents','integration_deliveries'])assert.equal((await h.db.prepare('SELECT count(*) n FROM '+table).first()).n,0,'imports stay outside outcomes and notifications');
   const landed=await h.snapshot(),repeat=await h.call(`${base}?vendor=${vendor}`,{method:'POST',headers:{'X-Import-Filename':`${vendor}.jsonl`,'X-Import-Schema':'2.16'},body:source});
   assert.equal(repeat.alreadyImported,true);assert.equal(h.lastWrites,0);assertBusinessEquality(landed,await h.snapshot());
   await h.call(`${base}/${run.id}/undo`,post({}));await h.drain();assert.equal((await read(h,run)).state,'undone');assertBusinessEquality(undoExpected,await h.snapshot());
   assert.equal(h.outbound,0);
  }
  await configurationLifecycle(h);
  const sample=generateDiagnostics('zendesk',2),reviewed=await upload(h,'zendesk',sample.body.slice(0,sample.body.lastIndexOf('{malformed')));await h.drain();
  const plan=(await read(h,reviewed)).plan;assert.equal(plan.duplicateRecords,2);
  assert.ok(plan.diagnostics.some(d=>d.code==='conflicting_duplicate_id'&&d.location.row===sample.duplicateLine));
  assert.equal(plan.decisions.find(d=>d.kind==='ticket').rejection,'conflicting_duplicate_id');assert.equal((await h.db.prepare('SELECT count(*) n FROM conversations').first()).n,0);
 }finally{await h.close();}
}
