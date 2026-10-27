import {runSteps} from '../journeys/kit/steps.mjs';
import {phases} from '../journeys/kit/scenarios.mjs';const test=phases(import.meta.url);import assert from 'node:assert/strict';
import {harness,body,sha,allScopes} from './harness.mjs';
const settings='/api/management/projects/p/connections';

test("API credential lifecycle: issue, use scoped operations, paginate, refuse lost authority and erasure, then revoke",()=>runSteps([
  ['current native admins manage workspace credentials while operators cannot create or inspect them',async()=>{
 const h=await harness();try{
  for(const role of ['admin','operator']){await h.db.prepare('INSERT INTO users VALUES(?,?,?,1)').bind(role,role+'@example.test',role).run();await h.db.prepare('INSERT INTO memberships VALUES(?,?,?)').bind('p',role,role).run();await h.session(role,'p',role,role)}
  // Installing a credential needs a recent step-up: a sign-in older than 15 minutes is asked again.
  await h.db.prepare('UPDATE session_factors SET verified_at=? WHERE token_hash=?').bind(Date.now()-20*60000,sha(h.sessionToken('admin'))).run()
  const stale=await h.raw(settings+'/tokens',{actor:'admin',...body({name:'Admin grant',scopes:allScopes})});assert.equal(stale.status,403);assert.equal((await stale.json()).code,'step_up_required')
  await h.db.prepare('UPDATE session_factors SET verified_at=? WHERE token_hash=?').bind(Date.now(),sha(h.sessionToken('admin'))).run()
  const issued=await h.call(settings+'/tokens',{actor:'admin',...body({name:'Admin grant',scopes:allScopes,expires_at:new Date(Date.now()+60000).toISOString()})});assert.deepEqual(issued.data.scopes,[...allScopes].sort());assert.ok(issued.data.expiresAt);
  assert.equal((await h.raw('/api/v1/contacts',{token:issued.token})).status,200);assert.equal((await h.call(settings+'/tokens',{actor:'admin'})).data.length,1);
  for(const kind of ['tokens','webhooks','slack','deliveries'])assert.equal((await h.raw(settings+'/'+kind,{actor:'operator'})).status,403);assert.equal((await h.raw(settings+'/tokens',{actor:'operator',...body({name:'Forbidden',scopes:['contacts:read']})})).status,403);
  await h.call(settings+'/tokens/'+issued.data.id,{actor:'admin',method:'DELETE'});assert.equal((await h.raw('/api/v1/contacts',{token:issued.token})).status,401);assert.equal((await h.db.prepare('SELECT count(*) n FROM integration_tokens').first()).n,1);
  const audit=(await h.db.prepare("SELECT action FROM native_integration_audit WHERE actor_id='admin'").all()).results.map(row=>row.action);assert.ok(audit.includes('token.issued')&&audit.includes('token.list')&&audit.includes('token.revoke'));
 }finally{await h.close()}
}],
  ['issuance commit guard rejects session, membership and workspace races including ABA restoration',async()=>{
 for(const race of [
  [{sql:"UPDATE sessions SET revoked_at=1 WHERE actor_id='owner'"}],
  [{sql:"DELETE FROM memberships WHERE project_id='p' AND user_id='owner'"},{sql:"INSERT INTO memberships VALUES('p','owner','owner')"}],
  [{sql:"UPDATE memberships SET role='operator' WHERE project_id='p' AND user_id='owner'"},{sql:"UPDATE memberships SET role='owner' WHERE project_id='p' AND user_id='owner'"}],
  [{sql:"INSERT INTO project_settings VALUES('p','{\"deleted_at\":1}',1)"}]
 ]){const h=await harness();try{const result=await h.raw('/_test/race',body({path:settings+'/tokens',body:{name:'Race',scopes:['contacts:read']},race}));assert.equal(result.status,409);assert.equal((await h.db.prepare('SELECT count(*) n FROM integration_tokens').first()).n,0);assert.equal((await h.db.prepare('SELECT count(*) n FROM integration_token_events').first()).n,0)}finally{await h.close()}}
}],
  ['all foreign resource operations equal missing IDs and change no native data or recipient counts',async()=>{
 const h=await harness();try{
  await h.contact();await h.contact('foreign-visitor','q');const own=await h.conversation(),foreign=await h.conversation('foreign-visitor','q');
  await h.call('/api/knowledge/q/articles',{actor:'foreign',...body({id:'foreign-article',title:'Foreign',content:'PRIVATE',status:'draft'})});
  const {token}=await h.issue();
  const matrices=[['GET','conversations/'+foreign.id],['GET','conversations/'+foreign.id+'/messages'],['POST','conversations/'+foreign.id+'/messages',{content:'Attempt',localId:'attempt',expectedRevision:0}],['POST','conversations/'+foreign.id+'/resolve',{}],['GET','contacts/foreign-visitor'],['PUT','contacts/foreign-visitor',{name:'Attempt'}],['GET','articles/foreign-article'],['PUT','articles/foreign-article',{title:'Attempt',content:'Attempt',status:'published'}]];
  const snapshot=async()=>({conversations:(await h.db.prepare("SELECT * FROM conversations WHERE project_id='q' ORDER BY id").all()).results,messages:(await h.db.prepare("SELECT * FROM messages WHERE project_id='q' ORDER BY id").all()).results,contacts:(await h.db.prepare("SELECT * FROM contacts WHERE project_id='q' ORDER BY id").all()).results,articles:(await h.db.prepare("SELECT * FROM knowledge_articles WHERE project_id='q' ORDER BY id").all()).results});const before=await snapshot();
  for(const [method,path,input] of matrices){const options={token,method,...(input?{headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}:{})};const response=await h.raw('/api/v1/'+path,options);assert.equal(response.status,404,path);const deniedBody=await response.json();const missing=await h.raw('/api/v1/'+path.replace(foreign.id,'missing').replace('foreign-visitor','missing').replace('foreign-article','missing'),options);assert.equal(missing.status,404,path);assert.deepEqual(deniedBody,await missing.json())}
  for(const kind of ['webhooks','slack','deliveries','tokens'])for(const method of ['GET','POST']){const r=await h.raw('/api/management/projects/q/connections/'+kind,{token,method,...(method==='POST'?{headers:{'Content-Type':'application/json'},body:'{}'}:{})});assert.equal(r.status,404)}
  assert.deepEqual(await snapshot(),before);assert.equal(h.received.length,0);
  const list=await h.call('/api/v1/conversations',{token});assert.deepEqual(list.data.map(x=>x.id),[own.id]);assert.equal((await h.raw('/api/dashboard/projects/q/reports',{actor:'owner'})).status,403);assert.equal((await h.raw('/api/move-in/projects/q/runs',{actor:'owner'})).status,404);
 }finally{await h.close()}
}],
  ['native API replies and resolve keep frontiers and reject revoked-token write races',async()=>{
 const h=await harness();try{
  await h.contact();const c=await h.conversation(),issued=await h.issue(),token=issued.token;
  const command={content:'First reply',localId:'api-reply',expectedRevision:0,expectedLastMessageId:null};const first=await h.call('/api/v1/conversations/'+c.id+'/messages',{token,...body(command)});assert.equal(first.data.revision,1);assert.equal(first.data.content,'First reply');const again=await h.call('/api/v1/conversations/'+c.id+'/messages',{token,...body(command)});assert.equal(again.duplicate,true);assert.equal((await h.db.prepare('SELECT count(*) n FROM conversation_outbox WHERE conversation_id=?').bind(c.id).first()).n,1);
  const authored=await h.db.prepare('SELECT kind FROM message_authorship WHERE message_id=?').bind(first.data.id).first();assert.equal(authored.kind,'unknown');
  await h.call('/api/v1/conversations/'+c.id+'/resolve',{token,...body({})});const state=await h.db.prepare('SELECT resolved_at,revision,assigned_to FROM conversations WHERE id=?').bind(c.id).first();assert.ok(state.resolved_at);assert.equal(state.revision,1);assert.equal(state.assigned_to,null);
  const race=await h.raw('/_test/race',{token,...body({skipBatches:1,path:'/api/v1/conversations/'+c.id+'/messages',body:{...command,localId:'revoked-reply',expectedRevision:1},race:[{sql:'UPDATE integration_tokens SET revoked_at=1 WHERE id=?',params:[issued.data.id]}]})});assert.equal(race.status,409);assert.deepEqual(await h.db.prepare('SELECT resolved_at,revision,assigned_to FROM conversations WHERE id=?').bind(c.id).first(),state);
 }finally{await h.close()}
}],
  ['cursor pagination binds workspace and filters and preserves tied timestamps',async()=>{
 const h=await harness();try{await h.contact();for(const id of ['a','b','c'])await h.db.prepare("INSERT INTO conversations(id,project_id,contact_id,created_at,updated_at) VALUES(?,'p','visitor',123,123)").bind(id).run();const {token}=await h.issue(['conversations:read']);const one=await h.call('/api/v1/conversations?limit=2&status=open',{token});assert.deepEqual(one.data.map(x=>x.id),['c','b']);const two=await h.call('/api/v1/conversations?limit=2&status=open&cursor='+encodeURIComponent(one.next_cursor),{token});assert.deepEqual(two.data.map(x=>x.id),['a']);assert.equal(two.next_cursor,null);assert.equal((await h.raw('/api/v1/conversations?status=resolved&cursor='+encodeURIComponent(one.next_cursor),{token})).status,400);assert.equal((await h.raw('/api/v1/conversations?cursor=invalid',{token})).status,400);assert.equal(one.data[0].updated_at,'1970-01-01T00:00:00.123Z');await h.db.prepare("INSERT INTO workspace_tags VALUES('unicode','p','調査 🧭','調査 🧭')").run();for(const id of ['a','b','c'])await h.db.prepare("INSERT INTO conversation_tags VALUES('p',?,'unicode')").bind(id).run();const tagged=await h.call('/api/v1/conversations?limit=2&tag='+encodeURIComponent('調査 🧭'),{token});assert.deepEqual(tagged.data.map(x=>x.id),['c','b']);const final=await h.call('/api/v1/conversations?limit=2&tag='+encodeURIComponent('調査 🧭')+'&cursor='+encodeURIComponent(tagged.next_cursor),{token});assert.deepEqual(final.data.map(x=>x.id),['a'])}finally{await h.close()}
}],
  ['every API mutation rechecks its live token at the actual D1 write boundary',async()=>{
 const h=await harness();try{
  await h.contact();const conversation=await h.conversation();await h.call('/api/knowledge/p/articles',body({id:'guarded-article',title:'Original',content:'Original',status:'draft'}));
  const cases=[
   {path:'/contacts',method:'POST',body:{name:'Unauthorized creation'},match:'INSERT INTO contacts'},
   {path:'/contacts/visitor',method:'PUT',body:{name:'Unauthorized edit'},match:'UPDATE contacts SET'},
   {path:'/articles',method:'POST',body:{title:'Unauthorized article',content:'No'},match:'INSERT INTO knowledge_articles'},
   {path:'/articles/guarded-article',method:'PUT',body:{title:'Unauthorized publication',content:'No',status:'published'},match:'INSERT INTO knowledge_articles'},
   {path:'/conversations/'+conversation.id+'/messages',method:'POST',body:{content:'Unauthorized reply',localId:'guarded',expectedRevision:0},match:'INSERT INTO messages'},
   {path:'/conversations/'+conversation.id+'/resolve',method:'POST',body:{},match:'UPDATE conversations'}
  ];
  const snapshot=async()=>{const state={};for(const table of ['contacts','messages','conversations','conversation_resolutions','knowledge_articles','knowledge_article_categories','native_integration_events','native_integration_intents'])state[table]=(await h.db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()).results;return state};
  for(const command of cases)for(const change of ['revoked_at=1','expires_at=1',"scopes='[]'"]){
   const issued=await h.issue(),before=await snapshot();const response=await h.raw('/_test/race',{token:issued.token,...body({path:'/api/v1'+command.path,method:command.method,body:command.body,match:command.match,race:[{sql:'UPDATE '+(change.startsWith('scopes')?'api_credentials':'integration_tokens')+' SET '+change+' WHERE id=?',params:[issued.data.id]}]})});assert.equal(response.status,409,command.path+' '+change);assert.deepEqual(await snapshot(),before,command.path+' makes no partial mutation');
  }
 }finally{await h.close()}
}],
  ['API limits are per token and every miss and OPTIONS response uses the JSON envelope without CORS',async()=>{
 const h=await harness();try{
  const first=await h.issue(['contacts:read']),second=await h.issue(['contacts:read']);const now=Math.floor(Date.now()/60000)*60000;
  await h.db.prepare('INSERT INTO abuse_counters(key,window_start,used,expires_at) VALUES(?,?,120,?)').bind('rate:apiRequestsPerTokenMinute:'+sha(first.data.id),now,now+60000).run();
  const denied=await h.raw('/api/v1/contacts',{token:first.token});assert.equal(denied.status,429);assert.equal((await denied.json()).error.code,'rate_limited');assert.ok(denied.headers.get('Retry-After'));assert.equal((await h.raw('/api/v1/contacts',{token:second.token})).status,200);
  for(const method of ['GET','OPTIONS'])for(const path of ['/api/v1/missing','/api/v1/contacts/missing']){const response=await h.raw(path,{method,token:second.token,headers:{Origin:'https://untrusted.example'}});assert.equal(response.status,404);assert.deepEqual(Object.keys(await response.json()),['error']);assert.equal(response.headers.get('Access-Control-Allow-Origin'),null)}
 }finally{await h.close()}
}],
  ['foreign webhook and Slack settings have the same refusal as missing workspaces and destinations',async()=>{
 const h=await harness();try{
  const foreignRoot='/api/management/projects/q/connections',ownRoot='/api/management/projects/p/connections';
  for(const kind of ['webhooks','slack']){
   const config=kind==='webhooks'?{name:'Foreign hook',url:'https://receiver.example.com/foreign',events:['conversation.created']}:{name:'Foreign Slack',mode:'bot',token:'xoxb-synthetic-test-only-foreign-fixture',channel:'C12345678'};
   const saved=await h.call(foreignRoot+'/'+kind,{actor:'foreign',...body(config)});
   for(const [method,suffix,input] of [['GET','',null],['POST','',config],['DELETE','/'+saved.id,null],['POST','/'+saved.id+'/test',{}]]){
    const options={method,...(input?{headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}:{})};
    const denied=await h.raw(foreignRoot+'/'+kind+suffix,options),missing=await h.raw(foreignRoot.replace('/q/','/missing/')+'/'+kind+suffix,options);assert.equal(denied.status,403);assert.equal(missing.status,403);assert.deepEqual(await denied.json(),await missing.json());
   }
   for(const [method,suffix] of [['DELETE',''],['POST','/test']]){const options={method,...(method==='POST'?{headers:{'Content-Type':'application/json'},body:'{}'}:{})};const denied=await h.raw(ownRoot+'/'+kind+'/'+saved.id+suffix,options),missing=await h.raw(ownRoot+'/'+kind+'/missing'+suffix,options);assert.equal(denied.status,404);assert.equal(missing.status,404);assert.deepEqual(await denied.json(),await missing.json())}
   assert.equal((await h.call(foreignRoot+'/'+kind,{actor:'foreign'})).data[0].enabled,1);
  }
  assert.equal(h.received.length,0);assert.equal((await h.db.prepare('SELECT count(*) n FROM native_integration_events').first()).n,0);
 }finally{await h.close()}
}],
  ['erased identities cannot be recreated or assigned to another contact through API writes',async()=>{
 const h=await harness();try{
  await h.contact();await h.contact('another');await h.db.prepare("UPDATE contacts SET email='erased@example.test',external_id='customer-42' WHERE id='visitor'").run();await h.call('/api/management/projects/p/contacts/visitor/erase',body({}));const {token}=await h.issue(['contacts:write']);
  for(const input of [{email:'ERASED@example.test'},{external_id:'customer-42'},{provided_email:'erased@example.test'}]){
   if(!input.provided_email)assert.equal((await h.raw('/api/v1/contacts',{token,...body({name:'Restore attempt',...input})})).status,409);
   assert.equal((await h.raw('/api/v1/contacts/another',{token,...body(input),method:'PUT'})).status,409);
  }
  assert.equal((await h.db.prepare('SELECT count(*) n FROM contacts').first()).n,2);assert.equal((await h.db.prepare("SELECT email FROM contacts WHERE id='another'").first()).email,null);
  const foreign=await h.issue(['contacts:write'],'q');assert.equal((await h.raw('/api/v1/contacts',{token:foreign.token,...body({name:'Independent identity',email:'erased@example.test'})})).status,201,'erasure registry is workspace-scoped');
 }finally{await h.close()}
}],
  ['readback erasure races and article ownership boundaries cannot disclose identity or alter foreign category links',async()=>{
 const h=await harness();try{
  await h.contact();await h.db.prepare("INSERT INTO knowledge_categories(id,project_id,name,slug) VALUES('cat-a','p','A','a'),('cat-b','p','B','b')").run();await h.call('/api/knowledge/p/articles',body({id:'changing-owner',title:'Original',content:'Original',categoryIds:['cat-a']}));const {token}=await h.issue();
  const foreign=await h.issue(['articles:read','articles:write'],'q'),moved=await h.raw('/api/v1/articles/changing-owner',{token:foreign.token,...body({title:'Attempt',content:'Attempt',categoryIds:['cat-b']}),method:'PUT'}),missing=await h.raw('/api/v1/articles/missing',{token:foreign.token,...body({title:'Attempt',content:'Attempt'}),method:'PUT'});assert.equal(moved.status,404);assert.deepEqual(await moved.json(),await missing.json());assert.deepEqual((await h.db.prepare("SELECT category_id FROM knowledge_article_categories WHERE article_id='changing-owner'").all()).results,[{category_id:'cat-a'}]);assert.equal((await h.db.prepare("SELECT title FROM knowledge_articles WHERE id='changing-owner'").first()).title,'Original');
  const erased=await h.raw('/_test/race',{token,...body({path:'/api/v1/contacts/visitor',method:'PUT',body:{name:'Private update'},match:'SELECT * FROM contacts WHERE id=? AND project_id=?',race:[{sql:"UPDATE contacts SET metadata_json=json_set(metadata_json,'$.is_erasing',1) WHERE id='visitor'"}]})});assert.equal(erased.status,409);assert.ok(!(await erased.text()).includes('Private update'));
 }finally{await h.close()}
}],
  ['REST article edits preserve omitted categories while explicit categories replace or clear them',async()=>{
 const h=await harness();try{
  const categories=[];
  for(const name of ['Getting started','Account settings','Troubleshooting'])categories.push((await h.call('/api/knowledge/p/categories',body({name}))).id);
  const {token}=await h.issue(['articles:read','articles:write']);
  const initial={title:'Manage your account',content:'Original instructions',slug:'manage-your-account',status:'published',categoryIds:categories.slice(0,2)};
  const {data:article}=await h.call('/api/v1/articles',{token,...body(initial)});
  const path='/api/v1/articles/'+article.id;
  async function readback(expected,title,content){
   const rest=(await h.call(path,{token})).data;
   assert.equal(rest.category_id,expected[0]||null);assert.equal(rest.title,title);assert.equal(rest.content,content);assert.equal(rest.status,'published');
   const dashboard=(await h.call('/api/knowledge/p/articles')).find(row=>row.id===article.id);
   assert.ok(dashboard);assert.deepEqual([...dashboard.categoryIds].sort(),[...expected].sort());assert.equal(dashboard.categoryId,expected[0]||null);assert.equal(dashboard.title,title);assert.equal(dashboard.content,content);
   const published=await h.call('/api/knowledge/public/p/articles/'+initial.slug,{token:null});
   assert.equal(published.categoryId,expected[0]||null);assert.equal(published.title,title);assert.equal(published.content,content);
   const listed=(await h.call('/api/knowledge/public/p/articles',{token:null})).find(row=>row.id===article.id);
   assert.ok(listed);assert.equal(listed.categoryId,expected[0]||null);assert.equal(listed.title,title);
  }
  await readback(initial.categoryIds,initial.title,initial.content);
  const edit={title:'Updated account instructions',content:'Updated instructions from the integration'};
  await h.call(path,{token,...body(edit),method:'PUT'});
  await readback(initial.categoryIds,edit.title,edit.content);
  const concurrent=[categories[1],categories[2]];
  edit.content='Instructions edited during recategorization';
  await h.call('/_test/race',{token,...body({path,method:'PUT',body:edit,match:'INSERT INTO knowledge_articles',race:[
   {sql:'UPDATE knowledge_articles SET category_id=? WHERE id=?',params:[concurrent[0],article.id]},
   {sql:'DELETE FROM knowledge_article_categories WHERE article_id=?',params:[article.id]},
   ...concurrent.map(category=>({sql:'INSERT INTO knowledge_article_categories(article_id,category_id) VALUES(?,?)',params:[article.id,category]}))
  ]})});
  await readback(concurrent,edit.title,edit.content);
  for(const [input,expected] of [[{categoryIds:[categories[2],categories[1]]},[categories[2],categories[1]]],[{categories:[categories[0]]},[categories[0]]],[{categoryId:categories[2]},[categories[2]]],[{categoryIds:[]},[]]]){
   await h.call(path,{token,...body(input),method:'PUT'});
   await readback(expected,edit.title,edit.content);
  }
  const foreign=(await h.call('/api/knowledge/q/categories',{actor:'foreign',...body({name:'Foreign category'})})).id;
  for(const category of [foreign,'missing-category']){
   assert.equal((await h.raw(path,{token,...body({title:'Refused update',categoryIds:[category]}),method:'PUT'})).status,400);
   await readback([],edit.title,edit.content);
  }
  const moved=await h.raw('/_test/race',{token,...body({path,method:'PUT',body:{title:'Refused race',categoryIds:[categories[0]]},match:'INSERT INTO knowledge_articles',race:[{sql:'UPDATE knowledge_categories SET project_id=? WHERE id=?',params:['q',categories[0]]}]})});
  assert.equal(moved.status,409);await readback([],edit.title,edit.content);
 }finally{await h.close()}
}],
  ['token revocation rejects an issuer revoked between preflight and its Base transaction',async()=>{
 const h=await harness();try{const issued=await h.issue();const response=await h.raw('/_test/race',body({path:settings+'/tokens/'+issued.data.id,method:'DELETE',body:{},match:'UPDATE integration_tokens SET revoked_at',race:[{sql:"UPDATE sessions SET revoked_at=1 WHERE actor_id='owner'"}]}));assert.equal(response.status,409);assert.equal((await h.db.prepare('SELECT revoked_at FROM integration_tokens WHERE id=?').bind(issued.data.id).first()).revoked_at,null);assert.equal((await h.db.prepare("SELECT count(*) n FROM integration_token_events WHERE action='revoked'").first()).n,0)}finally{await h.close()}
}],
  ['malformed JSON is a client error and denied scope attempts consume the token quota',async()=>{
 const h=await harness();try{
  const full=await h.issue(),read=await h.issue(['contacts:read']);const bad=await h.raw('/api/v1/contacts',{token:full.token,method:'POST',headers:{'Content-Type':'application/json'},body:'{'});assert.equal(bad.status,400);assert.equal((await bad.json()).error.code,'invalid_request');
  assert.equal((await h.raw('/api/v1/articles',{token:read.token})).status,403);
  await h.contact();const contactPath='/api/v1/contacts/visitor';
  await h.db.prepare("UPDATE contacts SET metadata_json=? WHERE id='visitor'").bind(JSON.stringify({provided_email:'reply-target@example.test',provided_email_source:'reply_to'})).run();
  for(const provided_email of ['phone only please','a@example.test, b@example.test','a@example.test\r\nBcc: b@example.test',{},'a'.repeat(255)+'@example.test']){
   const rejected=await h.raw(contactPath,{token:full.token,...body({provided_email}),method:'PUT'});
   assert.equal(rejected.status,400);assert.match((await rejected.json()).error.message,/provided_email/);
  }
  const unchanged=await h.call(contactPath,{token:full.token,...body({provided_email:' REPLY-TARGET@example.test ',phone:'555 0100'}),method:'PUT'});
  assert.equal(JSON.parse(unchanged.data.metadata_json).provided_email_source,'reply_to');
  const beforeChoice=Date.now(),chosen=await h.call(contactPath,{token:full.token,...body({provided_email:'chosen@example.test'}),method:'PUT'}),flags=JSON.parse(chosen.data.metadata_json);
  assert.equal(flags.provided_email_source,'operator');assert.deepEqual(flags.provided_email_set_by,{type:'api',id:full.data.id});assert.ok(flags.provided_email_set_at>=beforeChoice);
  const readOnly=await h.raw(contactPath,{token:(await h.issue(['contacts:read'])).token,...body({provided_email:'forbidden@example.test'}),method:'PUT'});assert.equal(readOnly.status,403);
  const quota=await h.issue(['contacts:read']);
  // Exercise the public quota in one real clock window, never seed its counter.
  const remaining=60000-Date.now()%60000;if(remaining<10000)await new Promise(resolve=>setTimeout(resolve,remaining+25));
  for(let index=0;index<120;index++)assert.equal((await h.raw('/api/v1/articles',{token:quota.token})).status,403);
  assert.equal((await h.raw('/api/v1/articles',{token:quota.token})).status,429);
 }finally{await h.close()}
}],
  ['API replies and resolve cannot revive erased contacts at preflight, commit or readback',async()=>{
 const h=await harness();try{
  await h.contact();const c=await h.conversation(),{token}=await h.issue();const command={localId:'before-erasure',content:'Original reply',expectedRevision:0};
  await h.call('/api/v1/conversations/'+c.id+'/messages',{token,...body(command)});await h.call('/api/management/projects/p/contacts/visitor/erase',body({}));
  for(const suffix of ['', '/messages', '/resolve']){const response=await h.raw('/api/v1/conversations/'+c.id+suffix,{token,...(suffix?body(suffix==='/messages'?command:{}):{})});assert.equal(response.status,404)}
  assert.deepEqual((await h.call('/api/v1/conversations',{token})).data,[]);
  for(const marker of ['is_erasing','is_erased'])for(const operation of ['reply','resolve','readback']){
   const id=marker+'-'+operation;await h.contact(id);const fresh=await h.conversation(id),before=await h.db.prepare('SELECT revision,resolved_at FROM conversations WHERE id=?').bind(fresh.id).first();
   const reply={localId:'refuse',content:'Do not expose this post-erasure reply',expectedRevision:0};
   const response=await h.raw('/_test/race',{token,...body({path:'/api/v1/conversations/'+fresh.id+(operation==='resolve'?'/resolve':'/messages'),body:operation==='resolve'?{}:reply,match:operation==='resolve'?'INSERT INTO ticket_history':operation==='readback'?'SELECT * FROM messages WHERE id=?':'INSERT INTO messages',race:[{sql:`UPDATE contacts SET metadata_json=json_set(metadata_json,'$.${marker}',1) WHERE id=?`,params:[id]}]})});assert.equal(response.status,409,marker+' '+operation);assert.ok(!(await response.text()).includes(reply.content));
   if(operation!=='readback'){assert.deepEqual(await h.db.prepare('SELECT revision,resolved_at FROM conversations WHERE id=?').bind(fresh.id).first(),before);assert.equal((await h.db.prepare('SELECT count(*) n FROM messages WHERE conversation_id=?').bind(fresh.id).first()).n,0)}
   assert.equal((await h.db.prepare('SELECT count(*) n FROM native_integration_events WHERE conversation_id=? AND erased_at IS NULL').bind(fresh.id).first()).n,0);assert.equal(h.received.length,0);
  }
 }finally{await h.close()}
}],
  ['destination disable refuses a revoked issuer at commit without recording a successful action',async()=>{
 const h=await harness();try{
  const path=settings+'/webhooks',saved=await h.call(path,body({name:'Disable race',url:'https://receiver.example.com/audit',events:['conversation.created']}));await h.call(path+'/'+saved.id,{method:'DELETE'});
  const before=(await h.db.prepare("SELECT * FROM native_integration_audit WHERE action='destination.disabled'").all()).results;
  const result=await h.raw('/_test/race',body({path:path+'/'+saved.id,method:'DELETE',match:'UPDATE native_integration_destinations',race:[{sql:"UPDATE sessions SET revoked_at=1 WHERE actor_id='owner'"}]}));assert.equal(result.status,404);
  assert.deepEqual((await h.db.prepare("SELECT * FROM native_integration_audit WHERE action='destination.disabled'").all()).results,before,'refused command cannot mint a success audit');
 }finally{await h.close()}
}]
]));
