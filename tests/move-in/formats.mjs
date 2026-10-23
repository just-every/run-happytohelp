import {phases,matrix} from '../journeys/kit/scenarios.mjs';
const test=phases(import.meta.url);
import assert from 'node:assert/strict';
import {nativeHarness} from './harness.mjs';
import {zip} from './zip.mjs';
const post=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
test("private ZIP upload maps all kinds with handwritten publication, content, author and time expectations",matrix(['zendesk','intercom'],async (vendor)=>{
 const h=await nativeHarness(),base='/api/move-in/projects/p/imports';try{
 const zendesk=[
  {user:{id:7,role:'end-user',name:'Ada',email:'ada@example.test',created_at:'2024-01-01T00:00:00Z',tags:['Customer only']}},
  {user:{id:8,role:'agent',name:'Historical helper',email:'helper@example.test',created_at:'2024-01-01T00:00:00Z'}},
  {ticket:{id:9,requester_id:7,subject:'A question',status:'solved',created_at:'2024-01-02T00:00:00Z',updated_at:'2024-01-02T00:02:00Z',tags:['Billing'],comments:[{id:10,author_id:7,plain_body:'Question',public:true,created_at:'2024-01-02T00:00:00Z'},{id:11,author_id:8,plain_body:'Private detail',public:false,created_at:'2024-01-02T00:01:00Z'},{id:12,author_id:8,plain_body:'Answer',public:true,created_at:'2024-01-02T00:02:00Z'}]}},
  {macro:{id:13,title:'Greeting',restriction:null,actions:[{field:'comment_value',value:'Hello'}],created_at:'2024-01-01T00:00:00Z',updated_at:'2024-01-02T00:00:00Z'}},
  {article:{id:14,title:'Guide',body:'<h1>Guide</h1><p><strong>Hello</strong></p><script>unsafe()</script>',draft:false,user_segment_id:null,created_at:'2024-01-01T00:00:00Z',updated_at:'2024-01-02T00:00:00Z'}},
  {article:{id:15,title:'Unpublished',body:'Draft',draft:true,user_segment_ids:[],created_at:'2024-01-01T00:00:00Z',updated_at:'2024-01-02T00:00:00Z'}}
 ];
 const intercom=[
  {type:'contact',id:'c7',name:'Ada',email:'ada@example.test',created_at:1704067200,tags:{type:'list',data:[{id:'personal',name:'Customer only'}]}},
  {type:'conversation',id:'v9',state:'closed',created_at:1704153600,updated_at:1704153720,channel:{initial:'email'},contacts:{type:'contact.list',contacts:[{id:'c7'}]},source:{id:'s10',body:'Question',author:{type:'contact',id:'c7',name:'Ada'}},conversation_parts:{type:'conversation_part.list',conversation_parts:[{id:'n11',part_type:'note',body:'Private detail',created_at:1704153660,author:{id:'a8',type:'admin',name:'Historical helper'}},{id:'r12',part_type:'comment',body:'Answer',created_at:1704153720,author:{id:'a8',type:'admin',name:'Historical helper'}}]},tags:{type:'tag.list',tags:[{id:'billing',name:'Billing'}]}},
  {type:'macro',id:'m13',name:'Greeting',body:'Hello',visible_to:'everyone',available_on:['inbox'],created_at:'2024-01-01T00:00:00Z',updated_at:'2024-01-02T00:00:00Z'},
  {type:'article',id:'a14',title:'Guide',body:null,body_markdown:'# Guide\n\n**Hello**',state:'published',created_at:1704067200,updated_at:1704153600},
  {type:'article',id:'a15',title:'Unpublished',body:'<p>Draft</p>',state:'draft',created_at:1704067200,updated_at:1704153600}
 ];
 const body=zip([{name:vendor==='zendesk'?'nested/account.ndjson':'nested/records.json',body:vendor==='zendesk'?zendesk.map(JSON.stringify).join('\n'):JSON.stringify({type:'list',data:intercom})}]);
 const run=(await h.call(`${base}?vendor=${vendor}`,{method:'POST',headers:{'X-Import-Filename':'export.zip','X-Import-Schema':'2.16'},body})).data;await h.drain();const ready=(await h.call(`${base}/${run.id}`)).data;assert.equal(ready.plan.counts.rejected,0);assert.equal(ready.plan.decisions.filter(row=>row.kind==='article').length,2);assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM contacts').first()).n,0,'review has no native writes');
 await h.call(`${base}/${run.id}/apply`,post({fingerprint:ready.plan.fingerprint}));await h.drain();assert.equal((await h.call(`${base}/${run.id}`)).data.state,'completed');
 const contact=await h.db.prepare('SELECT * FROM contacts').first();assert.equal(contact.name,'Ada');assert.equal(contact.created_at,1704067200000);assert.equal(contact.is_verified,0);assert.deepEqual(JSON.parse(contact.metadata_json).imported_tags,['Customer only']);
 assert.deepEqual((await h.db.prepare('SELECT name FROM workspace_tags').all()).results,[{name:'Billing'}]);assert.deepEqual((await h.db.prepare('SELECT actor_role,content,created_at FROM messages ORDER BY revision').all()).results,[{actor_role:'contact',content:'Question',created_at:1704153600000},{actor_role:'operator',content:'Answer',created_at:1704153720000}]);
 const note=await h.db.prepare('SELECT * FROM move_in_notes').first();assert.equal(note.content,'Private detail');assert.equal(note.created_at,1704153660000);assert.equal(JSON.parse(note.author_json).name,'Historical helper');
 const source=(await h.db.prepare('SELECT source_time,time_provenance FROM move_in_message_sources s JOIN messages m ON m.id=s.message_id ORDER BY m.revision').all()).results;
 assert.deepEqual(source,vendor==='zendesk'?[{source_time:'"2024-01-02T00:00:00Z"',time_provenance:'source'},{source_time:'"2024-01-02T00:02:00Z"',time_provenance:'source'}]:[{source_time:null,time_provenance:'conversation-created-context'},{source_time:'1704153720',time_provenance:'source'}]);
 const articles=(await h.db.prepare('SELECT title,content,status,updated_at FROM knowledge_articles ORDER BY title').all()).results;assert.deepEqual(articles,[{title:'Guide',content:'# Guide\n\n**Hello**',status:'published',updated_at:1704153600000},{title:'Unpublished',content:'Draft',status:'draft',updated_at:1704153600000}]);
 assert.deepEqual((await h.db.prepare('SELECT title,content,created_at,updated_at FROM macros').all()).results,[{title:'Greeting',content:'Hello',created_at:1704067200000,updated_at:1704153600000}]);assert.equal((await h.db.prepare('SELECT COUNT(*) n FROM users').first()).n,3,'no staff access created');assert.equal(h.outbound,0);
 }finally{await h.close()}
}));

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
