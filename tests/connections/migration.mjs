import assert from 'node:assert/strict';
import {harness,sha} from './harness.mjs';
import {randomBytes} from 'node:crypto';

export async function integrationMigrationJourney(){
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
 }finally{await h.close()}
}
