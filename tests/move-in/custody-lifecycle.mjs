import assert from 'node:assert/strict';
import {customer,history} from './helpscout-fixtures.mjs';
import {nativeHarness} from './harness.mjs';
import {person,upload,state,json,root} from './correction-fixtures.mjs';
async function advanceUntil(h,run,ready){
 const deadline=Date.now()+120000;
 while(!await ready(await state(h,run))){
  assert.ok(Date.now()<deadline,'publication reaches the requested committed state');
  assert.ok(h.queued.length,'publication still has work before the requested state');
  await h.step();
 }
}


export async function custodyLifecycle(){const h=await nativeHarness();try{
{

 const run=await upload(h,Array.from({length:25},(_,i)=>person(`part-${i}`,`part-${i}@example.test`)));await h.drain();await h.call(`${root}/${run.id}/apply`,json({fingerprint:(await state(h,run)).plan.fingerprint}));await h.db.prepare("UPDATE memberships SET role='operator' WHERE project_id='p' AND user_id='owner'").run();
 assert.deepEqual((await h.step()).retried,[0]);assert.equal((await h.db.prepare('SELECT count(*) n FROM contacts').first()).n,0);
 await h.db.prepare("UPDATE memberships SET role='owner' WHERE project_id='p' AND user_id='owner'").run();await h.call(`${root}/${run.id}/resume`,json({}));await advanceUntil(h,run,row=>row.cursor===20);
 assert.equal((await state(h,run)).cursor,20);assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM contacts').first()).n,20);
 await h.db.prepare("INSERT INTO contacts(id,project_id,email,name,created_at) VALUES('keeper','p','PART-24@example.test','Native keeper',123)").run();const keeper=await h.db.prepare("SELECT * FROM contacts WHERE id='keeper'").first();await h.drain();
 let stopped=await state(h,run);assert.equal(stopped.state,'applying');assert.equal(stopped.cursor,20);assert.equal(stopped.error,'native_contact_changed_since_review');assert.equal(stopped.report.checkpoint,20);assert.equal(stopped.report.total,25);assert.equal(stopped.report.counts.mapped,25);
 assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM contacts').first()).n,21);assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM ik_provenance').first()).n,20);
 await h.call(`${root}/${run.id}/resume`,json({}));await h.drain();stopped=await state(h,run);assert.equal(stopped.error,'native_contact_changed_since_review');assert.equal(stopped.cursor,20);assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM contacts').first()).n,21);
 assert.equal((await h.raw(`${root}/${run.id}/undo`,{...json({}),actor:'operator'})).response.status,403);await h.call(`${root}/${run.id}/undo`,json({}));await h.drain();const undone=await state(h,run);assert.equal(undone.error,null);assert.equal(undone.state,'undone');assert.equal(undone.report.total,20);assert.equal(undone.report.checkpoint,20);assert.deepEqual((await h.db.prepare('SELECT * FROM contacts').all()).results,[keeper]);assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM move_in_origins').first()).n,0);assert.equal(h.outbound,0);

}
{
 const base=root;
 const upload=async(h,rows,filename='helpscout.jsonl')=>(await h.call(`${base}?vendor=helpscout`,{method:'POST',headers:{'X-Import-Filename':filename},body:typeof rows==='string'?rows:rows.map(JSON.stringify).join('\n')})).data;
 const read=state;
 const apply=async(h,run)=>{await h.drain();const ready=await read(h,run);await h.call(`${base}/${run.id}/apply`,json({fingerprint:ready.plan.fingerprint}));await h.drain();assert.equal((await read(h,run)).state,'completed')};

  const first=history(901,7),peer=history(902,8),rows=[customer(),customer(8,'person8@example.test'),first.conversation,first.page,peer.conversation,peer.page],run=await upload(h,rows);await apply(h,run);
  const importedConversation=await h.db.prepare('SELECT id FROM conversations ORDER BY id LIMIT 1').first();
  await h.db.prepare("INSERT INTO conversation_notes VALUES('later-review',?,'owner','Preserve later native review',123)").bind(importedConversation.id).run();
  await h.call(`${base}/${run.id}/undo`,json({}));await h.drain();assert.equal((await read(h,run)).error,'NATIVE_EDIT_CONFLICT');
  assert.equal((await h.db.prepare('SELECT content FROM conversation_notes WHERE conversation_id=?').bind(importedConversation.id).first()).content,'Preserve later native review');
  const peerRows=[customer(81,'person81@example.test'),history(903,81).conversation,history(903,81).page],peerRun=await upload(h,peerRows.map(row=>{if(row._embedded?.threads)for(const thread of row._embedded.threads)if(thread.createdBy.type==='user')thread.createdBy.id=7;return row.id===903?{...row,tags:[{id:77,tag:'Independent peer'}]}:row}));await apply(h,peerRun);
  const source=await h.db.prepare("SELECT target_id FROM move_in_origins WHERE target_kind='contact' AND source_id='7'").first(),other=await h.db.prepare("SELECT * FROM contacts WHERE external_id='import:helpscout:8'").first(),otherMessages=(await h.db.prepare('SELECT * FROM messages WHERE actor_id=?').bind(other.id).all()).results;
  await h.contactSession('visitor','p',source.target_id);const conversation=await h.db.prepare('SELECT id FROM conversations WHERE contact_id=?').bind(source.target_id).first(),transcript=await h.call(`/api/conversations/${conversation.id}/messages`,{actor:'visitor'});assert.match(JSON.stringify(transcript),/Historical reply/);assert.doesNotMatch(JSON.stringify(transcript),/Private note/);
  const pending=structuredClone(first.page);pending._embedded.threads[0].customer.email='alias@example.test';const aliasRun=await upload(h,[pending]);await h.drain();assert.equal((await read(h,aliasRun)).state,'ready');
  await h.call(`/api/management/projects/p/contacts/${source.target_id}/erase`,json({}));assert.equal((await read(h,run)).state,'erased');assert.equal((await read(h,aliasRun)).state,'erased');assert.equal((await read(h,peerRun)).state,'completed');assert.deepEqual(await h.db.prepare('SELECT * FROM contacts WHERE id=?').bind(other.id).first(),other);assert.deepEqual((await h.db.prepare('SELECT * FROM messages WHERE actor_id=?').bind(other.id).all()).results,otherMessages);
  const erasedConversations=(await h.db.prepare('SELECT id FROM conversations WHERE contact_id=?').bind(source.target_id).all()).results;for(const c of erasedConversations){assert.equal((await h.db.prepare("SELECT COUNT(*) n FROM messages WHERE conversation_id=? AND content<>''").bind(c.id).first()).n,0);assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM move_in_notes WHERE conversation_id=?').bind(c.id).first()).n,0)}
  for(const gone of [run,aliasRun]){assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM move_in_records WHERE run_id=?').bind(gone.id).first()).n,0);assert.equal((await (await h.files).list({prefix:`move-in/p/${gone.id}/`})).objects.length,0);assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM ik_jobs WHERE operation_key=? OR operation_key LIKE ?').bind(gone.id,`${gone.id}/%`).first()).n,0)}assert.ok((await (await h.files).list({prefix:`move-in/p/${peerRun.id}/`})).objects.length>0);
  const changed=structuredClone(rows);changed[0]._embedded.emails[0].value='changed@example.test';changed[2].primaryCustomer.email='changed@example.test';for(const thread of changed[3]._embedded.threads){if(thread.customer)thread.customer.email='changed@example.test';if(thread.createdBy.type==='customer')thread.createdBy.email='changed@example.test'}
  for(const body of [rows.map(JSON.stringify).join('\n'),'\n'+rows.map(JSON.stringify).join('\n'),changed.map(JSON.stringify).join('\n'),JSON.stringify(customer(999,'alias@example.test'))]){const result=await h.raw(`${base}?vendor=helpscout`,{method:'POST',headers:{'X-Import-Filename':'repeat.jsonl'},body});assert.equal(result.response.status,410,JSON.stringify(result.data));assert.equal(h.lastWrites,0)}assert.equal(h.outbound,0);

}
}finally{await h.close()}}
