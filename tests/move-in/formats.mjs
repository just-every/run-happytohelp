import {companyJourney} from './company-journey.mjs';
import {phases} from '../journeys/kit/scenarios.mjs';
const test=phases(import.meta.url);
import assert from 'node:assert/strict';
import {nativeHarness} from './harness.mjs';
import {zip} from './zip.mjs';
const post=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
test('explicit company affiliations and group names from all four vendors preserve repeat and undo without granting visibility, domains or staff access',companyJourney);

test('Help Scout reviewed public upload reaches native history and knowledge, with inert reads, exact repeat/repackage equality and undo',async()=>{
 const {responses}=await import('./helpscout-fixtures.mjs'),{assertBusinessEquality}=await import('./business-equality.mjs'),h=await nativeHarness(),base='/api/move-in/projects/p/imports',input=responses(),body=JSON.stringify({responses:input});
 try{
  await h.db.prepare("INSERT INTO knowledge_articles(id,project_id,slug,title,content,status,updated_at) VALUES('native-guide','p','native-guide','Existing guide','Existing native body','published',1)").run();
  const before=await h.snapshot(),run=(await h.call(`${base}?vendor=helpscout`,{method:'POST',headers:{'X-Import-Filename':'helpscout.json'},body})).data;await h.drain();const ready=(await h.call(`${base}/${run.id}`)).data;assert.equal(ready.state,'ready');assert.equal(ready.plan.counts.rejected,0,JSON.stringify(ready.plan));assertBusinessEquality(before,await h.snapshot());assert.equal(h.outbound,0);
  assert.equal((await h.raw(`${base}/${run.id}/apply`,post({fingerprint:'obsolete'}))).response.status,409);assertBusinessEquality(before,await h.snapshot());
  await h.call(`${base}/${run.id}/apply`,post({fingerprint:ready.plan.fingerprint}));await h.drain();assert.equal((await h.call(`${base}/${run.id}`)).data.state,'completed');const conversation=await h.db.prepare('SELECT id,contact_id FROM conversations').first(),detail=await h.call(`/api/dashboard/projects/p/conversations/${conversation.id}`);assert.equal(detail.data.imported.vendor,'helpscout');assert.equal(detail.data.tags.length,2);
  assert.equal((await h.db.prepare('SELECT content FROM move_in_notes').first()).content,'Private note');assert.deepEqual((await h.db.prepare("SELECT status,content FROM knowledge_articles WHERE id<>'native-guide' ORDER BY status").all()).results,[{status:'draft',content:'Draft only'},{status:'published',content:'Public help'}]);assert.deepEqual((await h.db.prepare('SELECT name,parent_id,is_published FROM knowledge_categories ORDER BY parent_id').all()).results.map(c=>[c.name,c.parent_id!==null,c.is_published]),[['Help',false,1],['Getting started',true,1]]);assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM knowledge_article_categories').first()).n,2);assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM macros').first()).n,0);
  const publicArticles=await h.call('/api/knowledge/public/p/articles');assert.deepEqual(publicArticles.map(article=>article.title).sort(),['Existing guide','Published guide']);assert.equal((await h.call('/api/knowledge/public/p/categories')).length,2);
  const applied=await h.snapshot(),repeat=await h.call(`${base}?vendor=helpscout`,{method:'POST',headers:{'X-Import-Filename':'helpscout.json'},body});assert.equal(repeat.alreadyImported,true);assert.equal(repeat.writes,0);assert.equal(h.lastWrites,0);assertBusinessEquality(applied,await h.snapshot());
  const repacked=zip([{name:'original/responses.jsonl',body:input.map(JSON.stringify).join('\n')}]),second=(await h.call(`${base}?vendor=helpscout`,{method:'POST',headers:{'X-Import-Filename':'repacked.zip'},body:repacked})).data;await h.drain();const secondReady=(await h.call(`${base}/${second.id}`)).data;assert.equal(secondReady.plan.counts.rejected,0,JSON.stringify(secondReady.plan));await h.call(`${base}/${second.id}/apply`,post({fingerprint:secondReady.plan.fingerprint}));await h.drain();assert.equal((await h.call(`${base}/${second.id}`)).data.state,'completed');assertBusinessEquality(applied,await h.snapshot());
  await h.call(`${base}/${second.id}/undo`,post({}));await h.drain();await h.call(`${base}/${run.id}/undo`,post({}));await h.drain();assert.equal((await h.call(`${base}/${run.id}`)).data.state,'undone',JSON.stringify((await h.call(`${base}/${run.id}`)).data));
  assertBusinessEquality(before,await h.snapshot());assert.equal(h.outbound,0);assert.ok(h.maxStatements<=1000);
 }finally{await h.close()}
});
