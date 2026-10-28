import {phases} from '../journeys/kit/scenarios.mjs';const test=phases(import.meta.url);import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {harness,sha} from './harness.mjs';
import {randomBytes} from 'node:crypto';
import {nativeHarness} from '../move-in/harness.mjs';import {generate} from '../move-in/generator.mjs';
test('additive integration ledger preserves a genuinely populated 46-migration database',async()=>{
 const legacyId=crypto.randomUUID(),legacySecret='int_'+randomBytes(32).toString('hex'),legacyScopes=['conversations:read','messages:write'];
 let before;const h=await harness({beforeIntegrations:async db=>{
  await db.prepare("INSERT INTO projects VALUES('prior','Prior Workspace','prior-widget','https://prior.example',7,NULL)").run();
  await db.prepare("INSERT INTO users VALUES('prior-owner','prior@example.test','Prior Owner',8)").run();await db.prepare("INSERT INTO memberships VALUES('prior','prior-owner','owner')").run();
  await db.prepare("INSERT INTO contacts(id,project_id,name,email,metadata_json,created_at) VALUES('prior-contact','prior','Original Name','original@example.test','{\"retained\":true}',9)").run();
  await db.prepare("INSERT INTO conversations(id,project_id,contact_id,created_at,updated_at,revision) VALUES('prior-conversation','prior','prior-contact',10,11,1)").run();
  await db.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at) VALUES('prior-message','prior','prior-conversation','prior-local','prior-contact','contact','Exact original transcript',1,11)").run();
  // Keep the full-row comparison, including every original cell and the new
  // ticket defaults and nullable mailbox link added to this populated conversation.
  before={};for(const table of ['projects','users','memberships','contacts','conversations','messages'])before[table]=(await db.prepare('SELECT * FROM '+table).all()).results.map(row=>table==='messages'?{...row,content_raw:null}:table==='conversations'?{...row,status_id:'open',status_category:'open',subject:'',priority:'normal',channel:'widget',brand_id:'prior',group_id:null,requester_id:'prior-contact',submitter_id:'prior-contact',submitter_type:'contact',ticket_version:0,ticket_actor_id:null,ticket_actor_type:'system',ticket_source:'system',mailbox_id:null}:row);
 },beforeMigration:async(db,file)=>{if(file==='253_api_requests.sql')await db.prepare('INSERT INTO integration_tokens(namespace,id,token_hash,name,scopes,created_at) VALUES(?,?,?,?,?,?)').bind('prior',legacyId,sha(legacySecret),'Synthetic prior workspace token',JSON.stringify(legacyScopes),12).run()}});try{
  for(const table of Object.keys(before)){const field=table==='projects'?'id':table==='users'?'id':'project_id',key=table==='users'?'prior-owner':'prior';assert.deepEqual((await h.db.prepare('SELECT * FROM '+table+' WHERE '+field+'=?').bind(key).all()).results,before[table])}
  for(const table of ['native_integration_events','native_integration_intents','integration_deliveries'])assert.equal((await h.db.prepare('SELECT count(*) n FROM '+table).first()).n,0,'upgrade never replays prior data');
  const legacy=await h.db.prepare('SELECT * FROM api_credentials WHERE namespace=? AND id=?').bind('prior',legacyId).first();assert.equal(legacy.source_product,null);assert.deepEqual(JSON.parse(legacy.scopes),legacyScopes);
  assert.equal((await h.raw('/api/v1/conversations/prior-conversation',{token:legacySecret})).status,200);assert.ok((await h.call('/api/v1/conversations',{token:legacySecret})).data.some(row=>row.id==='prior-conversation'));
  assert.equal(await readFile('migrations/114_integrations_core.sql','utf8'),await readFile('src/vendor/base/modules/integrations/core/schema.sql','utf8'));
 }finally{await h.close()}
});
test('real Move in apply and complete undo never emit webhook or Slack intents',async()=>{
 const h=await nativeHarness();try{
  const base='/api/move-in/projects/p/imports',post=data=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  const run=(await h.call(base+'?vendor=intercom',{method:'POST',headers:{'X-Import-Filename':'integrations-inert.jsonl','X-Import-Schema':'2.16'},body:generate('intercom',2)})).data;await h.drain();const ready=(await h.call(base+'/'+run.id)).data;await h.call(base+'/'+run.id+'/apply',post({fingerprint:ready.plan.fingerprint}));await h.drain();assert.equal((await h.call(base+'/'+run.id)).data.state,'completed');
  for(const table of ['native_integration_events','native_integration_intents','integration_deliveries'])assert.equal((await h.db.prepare('SELECT count(*) n FROM '+table).first()).n,0);
  await h.call(base+'/'+run.id+'/undo',post({}));await h.drain();assert.equal((await h.call(base+'/'+run.id)).data.state,'undone');
  for(const table of ['native_integration_events','native_integration_intents','integration_deliveries'])assert.equal((await h.db.prepare('SELECT count(*) n FROM '+table).first()).n,0);assert.equal(h.outbound,0)
 }finally{await h.close()}
});
test('latest Base strict jobs retain native import behavior and erasure removes new custody only in its workspace',async()=>{
 const h=await nativeHarness();try{
  for(const [project,actor] of [['p','owner'],['q','foreign']]){
   const root='/api/move-in/projects/'+project+'/imports',run=(await h.call(root+'?vendor=intercom',{actor,method:'POST',headers:{'X-Import-Filename':'custody.jsonl','X-Import-Schema':'2.16'},body:generate('intercom',1)})).data;await h.drain();const ready=(await h.call(root+'/'+run.id,{actor})).data;await h.call(root+'/'+run.id+'/apply',{actor,method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fingerprint:ready.plan.fingerprint})});await h.drain();assert.equal((await h.call(root+'/'+run.id,{actor})).data.state,'completed');
   const jobs=(await h.db.prepare('SELECT id,reversal_policy,reversal_cursor FROM ik_jobs WHERE destination=?').bind(project).all()).results;assert.ok(jobs.length);assert.ok(jobs.every(job=>job.reversal_policy==='strict'&&job.reversal_cursor===0));
   // The new table can retain native snapshots. Exercise erasure custody even
   // though this product deliberately does not enable preserve-conflicts undo.
   for(const job of jobs)await h.db.prepare('INSERT INTO ik_d1_reversal_reports VALUES(?,?,?,?)').bind(job.id,'custody-fixture',0,JSON.stringify({private:'retained-'+project})).run();
  }
  const indexed=['ik_d1_plan_index','ik_d1_indexed_jobs','ik_d1_custody_states','ik_d1_custody_revisions'];
  const otherCustody={};for(const table of indexed){assert.ok((await h.db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE job_id IN (SELECT id FROM ik_jobs WHERE destination='p')`).first()).n>0);otherCustody[table]=(await h.db.prepare(`SELECT * FROM ${table} WHERE job_id IN (SELECT id FROM ik_jobs WHERE destination='q') ORDER BY job_id`).all()).results;}
  const foreign=(await h.db.prepare("SELECT * FROM ik_d1_reversal_reports WHERE job_id IN (SELECT id FROM ik_jobs WHERE destination='q')").all()).results;assert.ok(foreign.length);
  const contact=await h.db.prepare("SELECT id FROM contacts WHERE project_id='p' LIMIT 1").first();await h.call('/api/management/projects/p/contacts/'+contact.id+'/erase',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  assert.deepEqual((await h.db.prepare('SELECT * FROM ik_d1_reversal_reports').all()).results,foreign);assert.equal((await h.db.prepare('SELECT count(*) n FROM ik_d1_creation_plans').first()).n,0);for(const table of indexed)assert.deepEqual((await h.db.prepare(`SELECT * FROM ${table} ORDER BY job_id`).all()).results,otherCustody[table],'other workspace custody remains exact: '+table);assert.equal(h.outbound,0);
 }finally{await h.close()}
});
