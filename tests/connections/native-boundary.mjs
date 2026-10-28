import {credentials,reads,money,uncertainty,erasure} from '../helpers/business-connectors/journeys.mjs';
import {runSteps} from '../journeys/kit/steps.mjs';
import {phases} from '../journeys/kit/scenarios.mjs';const test=phases(import.meta.url);
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {harness,body,sha,allScopes} from './harness.mjs';

const root=project=>`/api/management/projects/${project}/connections`;
const actors={p:'owner',q:'foreign'};
const config=kind=>kind==='webhooks'
 ? {name:'Private webhook',url:'https://receiver.example.com/private',events:['conversation.created']}
 : {name:'Private Slack',mode:'bot',token:'xoxb-synthetic-test-only-native-boundary-fixture',channel:'C12345678'};

// Include audit, quotas, jobs, delivery state and every business table. D1's own
// platform accounting is not business state; all row values remain unnormalized.
async function snapshot(h,excluded=[],credentialId=null){
 const names=(await h.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'_cf_METADATA' ORDER BY name").all()).results;
 const state={};
 for(const {name} of names)if(!excluded.includes(name))state[name]=(await h.db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"').all()).results.filter(row=>!(credentialId&&(name==='api_denial_counts'&&row.credential_id===credentialId||name==='audit_events'&&row.target_id===credentialId&&row.actor_id===credentialId&&row.source==='api'&&['credential.first_used','credential.denied'].includes(row.action)))).map(row=>JSON.stringify(row)).sort();
 return sha(JSON.stringify(state));
}

async function seedDestinations(h){
 const ids={p:{},q:{}};
 for(const project of ['p','q'])for(const kind of ['webhooks','slack']){
  ids[project][kind]=(await h.call(root(project)+'/'+kind,{actor:actors[project],...body(config(kind))})).id;
 }
 return ids;
}

function settingsRequests(project,ids){
 const requests=[];
 for(const kind of ['webhooks','slack']){
  const path=root(project)+'/'+kind;
  requests.push([path,{}],[path,body(config(kind))]);
  for(const id of [ids[kind],'nonexistent-destination'])requests.push(
   [path+'/'+id,{method:'DELETE'}],
   [path+'/'+id+'/test',body({})],
  );
 }
 requests.push(
  [root(project)+'/tokens',{}],
  [root(project)+'/tokens',body({name:'Escalation',scopes:allScopes})],
  [root(project)+'/tokens/nonexistent-token',{method:'DELETE'}],
  [root(project)+'/tokens/usage',{}],
  [root(project)+'/deliveries',{}],
 );
 if(ids.token)requests.push([root(project)+'/tokens/'+ids.token,{method:'DELETE'}]);
 return requests;
}

async function concealed(h,path,options){
 const response=await h.raw(path,options);
 assert.equal(response.status,404,`${options.method||'GET'} ${path}`);
 assert.deepEqual(await response.json(),{error:'Not found'},path);
}

test("native settings authority: machine credentials never substitute for current native cookie sessions",()=>runSteps([
  ['workspace API tokens conceal every native connection setting in both tenant directions without effects',async()=>{
 const h=await harness();try{
  const ids=await seedDestinations(h),credentials={p:await h.issue(),q:await h.issue(allScopes,'q')};
  for(const project of ['p','q'])ids[project].token=credentials[project].data.id;
  const before=await snapshot(h);
  for(const source of ['p','q'])for(const target of ['p','q','nonexistent-workspace']){
   for(const [path,options] of settingsRequests(target,ids[target]||ids[source])){
    await concealed(h,path,{...options,token:credentials[source].token});
   }
  }
  assert.equal(await snapshot(h),before,'native machine-token denials preserve every business row including audit and quota state');
  assert.equal(h.received.length,0);assert.equal(h.external,0);
 }finally{await h.close()}
}],
  ['credential validity and API scopes never confer native administration or leak through native settings',async()=>{
 const h=await harness();try{
  const ids=await seedDestinations(h);
  for(const project of ['p','q']){
   const live=await h.issue(allScopes,project),wrongScope=await h.issue(['articles:read'],project);
   const revoked=await h.issue(allScopes,project),expired=await h.issue(allScopes,project,{expires_at:new Date(Date.now()+60000).toISOString()});
   await h.call(root(project)+'/tokens/'+revoked.data.id,{actor:actors[project],method:'DELETE'});
   await h.db.prepare('UPDATE api_credentials SET expires_at=1 WHERE id=?').bind(expired.data.id).run();
   const unknown={token:'int_'+randomBytes(32).toString('hex')};
   const before=await snapshot(h);
   for(const credential of [live,wrongScope,revoked,expired,unknown])for(const target of ['p','q','nonexistent-workspace']){
    for(const [path,options] of settingsRequests(target,ids[target]||ids[project])){
     await concealed(h,path,{...options,token:credential.token});
    }
   }
   assert.equal(await snapshot(h),before,'all machine-token states are denied before native side effects');
   for(const [credential,status,code] of [[live,200,null],[wrongScope,403,'insufficient_scope'],[revoked,401,'unauthorized'],[expired,401,'unauthorized'],[unknown,401,'unauthorized']]){
    const response=await h.raw('/api/v1/contacts',{token:credential.token});
    assert.equal(response.status,status);if(code)assert.equal((await response.json()).error.code,code);
   }
  }
  assert.equal(h.received.length,0);assert.equal(h.external,0);
 }finally{await h.close()}
}],
  ['native owner and admin cookie sessions retain settings access without machine-bearer fallback',async()=>{
 const h=await harness();try{
  for(const project of ['p','q']){
   const admin='admin-'+project;
   await h.db.prepare('INSERT INTO users VALUES(?,?,?,1)').bind(admin,admin+'@example.test',admin).run();
   await h.db.prepare("INSERT INTO memberships VALUES(?,?,'admin')").bind(project,admin).run();
   await h.session(admin,project,admin,'admin');
   for(const actor of [actors[project],admin]){
    const cookie={token:null,headers:{Cookie:'h2h_session='+h.sessionToken(actor),Origin:'https://app.example'}};
    const json=input=>({...body(input),...cookie,headers:{...cookie.headers,...body(input).headers}});
    const issued=await h.call(root(project)+'/tokens',json({name:'Cookie grant',scopes:['contacts:read']}));
    for(const kind of ['tokens','tokens/usage','webhooks','slack','deliveries'])assert.equal((await h.raw(root(project)+'/'+kind,cookie)).status,200);
    for(const kind of ['webhooks','slack']){
     const saved=await h.call(root(project)+'/'+kind,json(config(kind)));
     assert.ok((await h.call(root(project)+'/'+kind,cookie)).data.some(row=>row.id===saved.id));
     await h.call(root(project)+'/'+kind+'/'+saved.id,{...cookie,method:'DELETE'});
    }
    const before=await snapshot(h);
    for(const target of [project,project==='p'?'q':'p','nonexistent-workspace']){
     await concealed(h,root(target)+'/webhooks',{...cookie,token:issued.token});
     await concealed(h,root(target)+'/slack',{...json(config('slack')),token:issued.token});
    }
    assert.equal(await snapshot(h),before,'an explicit machine bearer cannot fall back to a native owner cookie');
    assert.equal((await h.raw(root(project)+'/webhooks',{...json(config('webhooks')),headers:{...json({}).headers,Origin:'https://foreign.example'}})).status,403);
    await h.call(root(project)+'/tokens/'+issued.data.id,{...cookie,method:'DELETE'});
    assert.equal((await h.raw('/api/v1/contacts',{token:issued.token})).status,401);
   }
  }
  const path=root('p')+'/webhooks';
  assert.equal((await h.raw(path,{token:null})).status,401);
  assert.equal((await h.raw(path,{token:randomBytes(32).toString('hex')})).status,401);
  await h.db.prepare("UPDATE sessions SET revoked_at=1 WHERE actor_id='owner'").run();
  assert.equal((await h.raw(path)).status,401);
  await h.db.prepare("UPDATE sessions SET expires_at=1 WHERE actor_id='foreign'").run();
  assert.equal((await h.raw(root('q')+'/slack',{actor:'foreign'})).status,401);
  assert.equal(h.received.length,0);assert.equal(h.external,0);
 }finally{await h.close()}
}],
  ['both workspace tokens retain API foreign-resource concealment and cannot enter native resource routes',async()=>{
 const h=await harness();try{
  const conversations={};
  for(const project of ['p','q']){
   await h.contact('visitor-'+project,project);conversations[project]=await h.conversation('visitor-'+project,project);
   await h.call('/api/knowledge/'+project+'/articles',{actor:actors[project],...body({id:'article-'+project,title:'Private article',content:'Private content',status:'draft'})});
  }
  const credentials={p:await h.issue(),q:await h.issue(allScopes,'q')};
  const seededEvents=['p','q'].map(project=>({project_id:project,event:'conversation.created',conversation_id:conversations[project].id}));
  const events=async()=>(await h.db.prepare('SELECT project_id,event,conversation_id FROM native_integration_events ORDER BY project_id').all()).results;
  assert.deepEqual(await events(),seededEvents,'the two native fixture conversations each produced their required event');
  for(const source of ['p','q']){
   const target=source==='p'?'q':'p',token=credentials[source].token,id=conversations[target].id;
   const requests=[
    ['conversations/'+id,{}],['conversations/'+id+'/messages',{}],
    ['conversations/'+id+'/messages',body({content:'Denied reply',localId:'denied',expectedRevision:0})],
    ['conversations/'+id+'/resolve',body({})],['contacts/visitor-'+target,{}],
    ['contacts/visitor-'+target,{...body({name:'Denied edit'}),method:'PUT'}],
    ['articles/article-'+target,{}],['articles/article-'+target,{...body({title:'Denied edit',content:'Denied',status:'published'}),method:'PUT'}],
   ];
   const accounting=['integration_token_usage','abuse_counters'],beforeApi=await snapshot(h,accounting,credentials[source].data.id);
   for(const [path,options] of requests){
    const denied=await h.raw('/api/v1/'+path,{...options,token});
    const missing=await h.raw('/api/v1/'+path.replace(id,'missing').replace('visitor-'+target,'missing').replace('article-'+target,'missing'),{...options,token});
    assert.equal(denied.status,404,path);assert.equal(missing.status,404,path);assert.deepEqual(await denied.json(),await missing.json());
   }
   assert.equal(await snapshot(h,accounting,credentials[source].data.id),beforeApi,'API foreign-resource denials preserve all business state apart from permitted token usage and quota accounting');
   const credentialId=credentials[source].data.id;
   assert.equal((await h.db.prepare('SELECT sum(count) n FROM api_denial_counts WHERE project_id=? AND credential_id=?').bind(source,credentialId).first()).n,8,'each named-conversation refusal is counted against the credential');
   const usageAudit=(await h.db.prepare("SELECT action,count(*) n FROM audit_events WHERE project_id=? AND target_id=? GROUP BY action ORDER BY action").bind(source,credentialId).all()).results;
   assert.deepEqual(usageAudit,[{action:'credential.denied',n:1},{action:'credential.first_used',n:1}],'legacy credentials also audit one denial window and one first use');
   const nativePaths=[
    '/api/conversations/'+id,'/api/conversations/'+id+'/messages',
    '/api/knowledge/'+target+'/articles','/api/management/projects/'+target+'/contacts',
    '/api/dashboard/projects/'+target+'/reports','/api/move-in/projects/'+target+'/imports',
   ];
   for(const path of nativePaths)assert.equal((await h.raw(path,{actor:actors[target]})).status,200,'the native owner can actually reach '+path);
   const before=await snapshot(h);
   for(const path of nativePaths)await concealed(h,path,{token});
   await concealed(h,'/api/conversations/'+id+'/messages',{token,...body({content:'Denied native reply',localId:'denied-native',expectedRevision:0})});
   assert.equal(await snapshot(h),before,'shared native authority denies machine credentials before any resource-specific work');
   assert.equal((await h.db.prepare('SELECT revision,resolved_at FROM conversations WHERE id=?').bind(id).first()).revision,0);
   assert.equal((await h.db.prepare('SELECT name FROM contacts WHERE id=?').bind('visitor-'+target).first()).name,'Visitor visitor-'+target);
   assert.equal((await h.db.prepare('SELECT title,status FROM knowledge_articles WHERE id=?').bind('article-'+target).first()).title,'Private article');
  }
  assert.equal((await h.db.prepare('SELECT count(*) n FROM messages').first()).n,0);
  assert.deepEqual(await events(),seededEvents,'denied API and native requests added no event to the two fixture creation events');
  assert.equal(h.received.length,0);assert.equal(h.external,0);
 }finally{await h.close()}
}],
 ['connect business accounts with current workspace authority',credentials],
 ['map and refresh business context without foreign access',reads],
 ['approve bounded provider actions and publish their confirmed result once',money],
 ['reconcile uncertain provider work without replay',uncertainty],
 ['erase business context and prevent its return',erasure]
]));
