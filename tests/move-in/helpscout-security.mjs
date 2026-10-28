import {phases} from '../journeys/kit/scenarios.mjs';
const test=phases(import.meta.url);
import assert from 'node:assert/strict';
import {nativeHarness} from './harness.mjs';
import {customer,history,responses,docs} from './helpscout-fixtures.mjs';
import {assertBusinessEquality} from './business-equality.mjs';
const base='/api/move-in/projects/p/imports',json=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const upload=(h,rows,filename='helpscout.jsonl')=>h.call(`${base}?vendor=helpscout`,{method:'POST',headers:{'X-Import-Filename':filename},body:typeof rows==='string'?rows:rows.map(JSON.stringify).join('\n')}).then(r=>r.data);
const read=(h,run)=>h.call(`${base}/${run.id}`).then(r=>r.data);
async function apply(h,run){await h.drain();const ready=await read(h,run);assert.equal(ready.plan.counts.rejected,0,JSON.stringify(ready.plan));await h.call(`${base}/${run.id}/apply`,json({fingerprint:ready.plan.fingerprint}));await h.drain();assert.equal((await read(h,run)).state,'completed')}

import {step} from './steps.mjs';

test("helpscout: Help Scout conversations and Docs publish only complete public content, recheck category privacy, and keep undo and erasure safe",async()=>{
await step('Help Scout malformed syntax is refused before custody and incomplete/ambiguous sources remain inert at review',async()=>{
 const h=await nativeHarness();try{
  const before=await h.snapshot();for(const body of ['{"_embedded":{"customers":[]},"_embedded":{}}','{"id":7,"firstName":"A","id":8}','{"responses":[{"article":{"id":"a","text":"first","te\\u0078t":"second"}}]}','{"_embedded":{"conversations":[' ]){const result=await h.raw(`${base}?vendor=helpscout`,{method:'POST',headers:{'X-Import-Filename':'invalid.json'},body});assert.equal(result.response.status,422);assert.equal(h.lastWrites,0);assert.equal(h.queued.length,0);assert.equal((await (await h.files).list()).objects.length,0);assertBusinessEquality(before,await h.snapshot())}
  const rows=responses(),conversation=rows[1]._embedded.conversations[0];conversation._embedded={threads:rows[2]._embedded.threads};rows.splice(2,1);rows[0]._embedded.customers=[];rows[0].page.totalElements=0;const run=await upload(h,rows);await h.drain();const ready=await read(h,run);assert.ok(ready.plan.decisions.some(d=>d.kind==='conversation'&&d.rejection==='conversation_contact_unavailable'));assertBusinessEquality(before,await h.snapshot());assert.equal(h.outbound,0);
 }finally{await h.close()}
});
await step('Help Scout native edit and current authority changes prevent destructive undo and unapproved publication',async()=>{
 const h=await nativeHarness();try{
  const run=await upload(h,responses());await h.drain();const ready=await read(h,run);assert.equal((await h.raw(`${base}/${run.id}/apply`,{...json({fingerprint:ready.plan.fingerprint}),actor:'operator'})).response.status,403);assert.equal((await h.raw(`${base}/${run.id}`,{actor:'foreign'})).response.status,404);assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM conversations').first()).n,0);await apply(h,run);
  const conversation=await h.db.prepare('SELECT id FROM conversations').first();await h.db.prepare("INSERT INTO conversation_notes VALUES('later-note',?,'owner','Retain my later edit',123)").bind(conversation.id).run();const before=await h.snapshot();await h.call(`${base}/${run.id}/undo`,json({}));await h.drain();assert.equal((await read(h,run)).error,'NATIVE_EDIT_CONFLICT');const after=await h.snapshot();for(const table of ['contacts','conversations','messages','move_in_notes','conversation_notes','conversation_tags'])assert.deepEqual(after[table],before[table]);assert.equal(h.outbound,0);
  const knowledge=await upload(h,docs());await apply(h,knowledge);
  await h.db.prepare("UPDATE knowledge_categories SET name='Renamed natively' WHERE name='Getting started'").run();
  const existing=(await h.db.prepare('SELECT * FROM knowledge_articles ORDER BY id').all()).results,later=docs();later.push({article:{...later[2].article,id:'article-3',name:'New guide',text:'New body'}});
  const reimport=await upload(h,later);await h.drain();const reviewed=await read(h,reimport);await h.call(`${base}/${reimport.id}/apply`,json({fingerprint:reviewed.plan.fingerprint}));await h.drain();
  const finished=await read(h,reimport),articles=(await h.db.prepare('SELECT * FROM knowledge_articles ORDER BY id').all()).results;
  assert.deepEqual({state:finished.state,error:finished.error,categories:(await h.db.prepare('SELECT name FROM knowledge_categories ORDER BY name').all()).results,existing:articles.filter(article=>existing.some(prior=>prior.id===article.id)),added:articles.filter(article=>!existing.some(prior=>prior.id===article.id)).map(({title,content,status})=>({title,content,status})),outbound:h.outbound},{state:'completed',error:null,categories:[{name:'Help'},{name:'Renamed natively'}],existing,added:[{title:'New guide',content:'New body',status:'published'}],outbound:0});

 }finally{await h.close()}
});
await step('Help Scout management erasure removes native and D1/R2 content, fences source ID/email aliases and preserves peer data',async()=>{
 const h=await nativeHarness();try{
  const first=history(901,7),peer=history(902,8),rows=[customer(),customer(8,'person8@example.test'),first.conversation,first.page,peer.conversation,peer.page],run=await upload(h,rows);await apply(h,run);
  const peerRows=[customer(81,'person81@example.test'),history(903,81).conversation,history(903,81).page],peerRun=await upload(h,peerRows.map(row=>{if(row._embedded?.threads)for(const thread of row._embedded.threads)if(thread.createdBy.type==='user')thread.createdBy.id=7;return row.id===903?{...row,tags:[{id:77,tag:'Independent peer'}]}:row}));await apply(h,peerRun);
  const source=await h.db.prepare("SELECT target_id FROM move_in_origins WHERE target_kind='contact' AND source_id='7'").first(),other=await h.db.prepare("SELECT * FROM contacts WHERE external_id='import:helpscout:8'").first(),otherMessages=(await h.db.prepare('SELECT * FROM messages WHERE actor_id=?').bind(other.id).all()).results;
  await h.contactSession('visitor','p',source.target_id);const conversation=await h.db.prepare('SELECT id FROM conversations WHERE contact_id=?').bind(source.target_id).first(),transcript=await h.call(`/api/conversations/${conversation.id}/messages`,{actor:'visitor'});assert.match(JSON.stringify(transcript),/Historical reply/);assert.doesNotMatch(JSON.stringify(transcript),/Private note/);
  const pending=structuredClone(first.page);pending._embedded.threads[0].customer.email='alias@example.test';const aliasRun=await upload(h,[pending]);await h.drain();assert.equal((await read(h,aliasRun)).state,'ready');
  await h.call(`/api/management/projects/p/contacts/${source.target_id}/erase`,json({}));assert.equal((await read(h,run)).state,'erased');assert.equal((await read(h,aliasRun)).state,'erased');assert.equal((await read(h,peerRun)).state,'completed');assert.deepEqual(await h.db.prepare('SELECT * FROM contacts WHERE id=?').bind(other.id).first(),other);assert.deepEqual((await h.db.prepare('SELECT * FROM messages WHERE actor_id=?').bind(other.id).all()).results,otherMessages);
  const erasedConversations=(await h.db.prepare('SELECT id FROM conversations WHERE contact_id=?').bind(source.target_id).all()).results;for(const c of erasedConversations){assert.equal((await h.db.prepare("SELECT COUNT(*) n FROM messages WHERE conversation_id=? AND content<>''").bind(c.id).first()).n,0);assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM move_in_notes WHERE conversation_id=?').bind(c.id).first()).n,0)}
  for(const gone of [run,aliasRun]){assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM move_in_records WHERE run_id=?').bind(gone.id).first()).n,0);assert.equal((await (await h.files).list({prefix:`move-in/p/${gone.id}/`})).objects.length,0);assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM ik_jobs WHERE operation_key=? OR operation_key LIKE ?').bind(gone.id,`${gone.id}/%`).first()).n,0)}assert.ok((await (await h.files).list({prefix:`move-in/p/${peerRun.id}/`})).objects.length>0);
  const changed=structuredClone(rows);changed[0]._embedded.emails[0].value='changed@example.test';changed[2].primaryCustomer.email='changed@example.test';for(const thread of changed[3]._embedded.threads){if(thread.customer)thread.customer.email='changed@example.test';if(thread.createdBy.type==='customer')thread.createdBy.email='changed@example.test'}
  for(const body of [rows.map(JSON.stringify).join('\n'),'\n'+rows.map(JSON.stringify).join('\n'),changed.map(JSON.stringify).join('\n'),JSON.stringify(customer(999,'alias@example.test'))]){const result=await h.raw(`${base}?vendor=helpscout`,{method:'POST',headers:{'X-Import-Filename':'repeat.jsonl'},body});assert.equal(result.response.status,410,JSON.stringify(result.data));assert.equal(h.lastWrites,0)}assert.equal(h.outbound,0);
 }finally{await h.close()}
});
await step('category migration preserves unrelated article state while linked deletion and ancestor edits invalidate publication evidence',async()=>{
 const h=await nativeHarness();try{
  await h.db.prepare("INSERT INTO knowledge_categories(id,project_id,parent_id,name,slug) VALUES('root','p',NULL,'Root','root'),('child','p','root','Child','child'),('unrelated','p',NULL,'Unrelated','unrelated')").run();
  await h.db.prepare("INSERT INTO knowledge_articles(id,project_id,category_id,slug,title,content,status,updated_at) VALUES('linked','p',NULL,'linked','Linked','Linked body','published',1),('unrelated-article','p','unrelated','unrelated-article','Unrelated','Unrelated body','published',1)").run();await h.db.prepare("INSERT INTO knowledge_article_categories VALUES('linked','child')").run();
  const before=await h.db.prepare("SELECT * FROM knowledge_articles WHERE id='unrelated-article'").first(),linked=await h.db.prepare("SELECT source_revision FROM knowledge_articles WHERE id='linked'").first();await h.db.prepare("INSERT INTO knowledge_categories(id,project_id,name,slug) VALUES('new','p','New','new')").run();assert.deepEqual(await h.db.prepare("SELECT * FROM knowledge_articles WHERE id='unrelated-article'").first(),before);assert.equal((await h.db.prepare("SELECT source_revision FROM knowledge_articles WHERE id='linked'").first()).source_revision,linked.source_revision);
  await h.db.prepare("UPDATE knowledge_categories SET is_published=0 WHERE id='root'").run();assert.ok((await h.db.prepare("SELECT source_revision FROM knowledge_articles WHERE id='linked'").first()).source_revision>linked.source_revision,'changing ancestor visibility invalidates descendant article');
  const stable=await h.db.prepare("SELECT * FROM knowledge_articles WHERE id='unrelated-article'").first(),prior=await h.db.prepare("SELECT source_revision FROM knowledge_articles WHERE id='linked'").first();await h.db.prepare("DELETE FROM knowledge_categories WHERE id='child'").run();assert.ok((await h.db.prepare("SELECT source_revision FROM knowledge_articles WHERE id='linked'").first()).source_revision>prior.source_revision,'deleting a linked category invalidates article');assert.deepEqual(await h.db.prepare("SELECT * FROM knowledge_articles WHERE id='unrelated-article'").first(),stable);assert.equal((await h.db.prepare("SELECT COUNT(*) n FROM knowledge_article_categories WHERE category_id='child'").first()).n,0);
 }finally{await h.close()}
});
await step('Help Scout duplicate email decisions reject dependent history before apply, and later native category dependents block undo',async()=>{
 const h=await nativeHarness();try{
  const a=history(),run=await upload(h,[customer(),customer(8),a.conversation,a.page]);await h.drain();const ready=await read(h,run);assert.equal(ready.plan.decisions.filter(d=>d.rejection==='duplicate_source_email').length,2);assert.equal(ready.plan.decisions.find(d=>d.kind==='conversation').rejection,'conversation_contact_rejected');
  const privateDocs=docs();privateDocs[0].collections.items[0].visibility='private';const knowledge=await upload(h,privateDocs);await apply(h,knowledge);assert.deepEqual(await h.call('/api/knowledge/public/p/articles'),[]);assert.deepEqual(await h.call('/api/knowledge/public/p/categories'),[]);const category=await h.db.prepare("SELECT id FROM knowledge_categories WHERE name='Getting started'").first();await h.db.prepare("INSERT INTO knowledge_articles(id,project_id,category_id,slug,title,content,status,updated_at) VALUES('later','p',?,'later','Later','Keep this native article','draft',1)").bind(category.id).run();const before=await h.snapshot();await h.call(`${base}/${knowledge.id}/undo`,json({}));await h.drain();assert.equal((await read(h,knowledge)).error,'NATIVE_EDIT_CONFLICT');assertBusinessEquality(before,await h.snapshot());assert.equal(h.outbound,0);
 }finally{await h.close()}
});
await step('Help Scout article batches recheck category privacy after earlier category publication',async()=>{
 const {generateHelpScout}=await import('./helpscout-fixtures.mjs'),h=await nativeHarness();try{
  const run=await upload(h,generateHelpScout(12));await h.drain();const ready=await read(h,run);assert.equal(ready.plan.counts.rejected,0);await h.call(`${base}/${run.id}/apply`,json({fingerprint:ready.plan.fingerprint}));
  let turns=0;while(!(await h.db.prepare('SELECT COUNT(*) n FROM knowledge_categories').first()).n){assert.ok(turns++<30);await h.step()}
  await h.db.prepare("UPDATE knowledge_categories SET is_published=0 WHERE name='Help'").run();await h.drain();assert.equal((await read(h,run)).error,'native_category_changed_since_review');assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM knowledge_articles').first()).n,0);assert.deepEqual(await h.call('/api/knowledge/public/p/articles'),[]);assert.equal((await h.db.prepare("SELECT is_published FROM knowledge_categories WHERE name='Help'").first()).is_published,0);assert.equal(h.outbound,0);
 }finally{await h.close()}
});
});
