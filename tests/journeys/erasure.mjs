import test from 'node:test'
import assert from 'node:assert/strict'
import {startApp,sha as hashToken} from './kit/app.mjs'
import {rerMailErasureJourney} from '../helpers/email/rer-erasure.mjs'

// Contact erasure through the real application router on real D1 and R2 with every migration applied.
let app,DB,FILES,env
// The only network is a connected webhook, which answers the erasure's deletion request.
const deletionRequests=[]
const webhook=async(request,entry)=>{if(new URL(request.url).host!=='hooks.crm-example.com')throw new Error('Unexpected outbound request: '+request.url);deletionRequests.push(JSON.parse(entry.body));return new Response('ok')}
const routes='/api/management',dashboardRoutes='/api/dashboard',conversationRoutes='/api/conversations'
const all=async(sql,...args)=>(await DB.prepare(sql).bind(...args).all()).results
const one=(sql,...args)=>DB.prepare(sql).bind(...args).first()
const call=(prefix,path,token,method='GET',body)=>app.request(prefix+path,{method,token,body,headers:{'Content-Type':'application/json'}})
const erase=(token,project='p',contact='ct')=>call(routes,`/projects/${project}/contacts/${contact}/erase`,token,'POST')
const objectText=async key=>{const object=await FILES.get(key);return object?object.text():null}

const secret='Order 4471 for Alice Example, 12 Private Lane'
const objects={'p/conv1/contact-upload':'passport scan','p/conv2/operator-upload':'invoice for alice@example.com','delegation/p/job1/shot':'screenshot of alice account','p/convOther/other-upload':'other customer file','q/convQ/q-upload':'other project file','q/convQ/q-by-ct':'other project file uploaded by the same id'}
async function seed(){
 const now=1_700_000_000_000,rows=[
  "INSERT INTO projects(id,name,widget_key,allowed_origin,created_at) VALUES('p','Project','widget-p','https://p.example',1),('q','Other project','widget-q','https://q.example',1)",
  "INSERT INTO users(id,email,name,created_at) VALUES('owner','owner@example.com','Owner',1),('admin','admin@example.com','Admin',1),('operator','operator@example.com','Operator',1),('q-owner','q-owner@example.com','Q Owner',1)",
  "INSERT INTO memberships VALUES('p','owner','owner'),('p','admin','admin'),('p','operator','operator'),('q','q-owner','owner')",
  `INSERT INTO contacts(id,project_id,name,email,external_id,created_at,is_verified,metadata_json) VALUES('ct','p','Alice Example','alice@example.com','crm-alice',5,1,'{"provided_email":"Alice.Personal@example.com","phone":"+61 400 000 000","ip_address":"203.0.113.9","user_agent":"Private Browser"}'),('other','p','Bob Other','bob@example.com','crm-bob',6,1,'{"phone":"+61 411 111 111"}'),('qct','q','Quinn','quinn@example.com',NULL,7,0,'{}')`,
  "INSERT INTO conversations(id,project_id,contact_id,revision,last_message_id,created_at,updated_at) VALUES('conv1','p','ct',3,'m1c',10,13),('conv2','p','ct',1,'m2a',20,21),('convOther','p','other',1,'mo1',30,31),('convQ','q','qct',1,'mq1',40,41)",
  `INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at,intent_hash) VALUES('m1a','p','conv1','c-1','ct','contact','${secret}',1,11,'hash-c1'),('m1b','p','conv1','op-1','operator','operator','Thanks Alice, checking order 4471',2,12,'hash-op1'),('m1c','p','conv1','c-2','ct','contact','My card ends 4242',3,13,'hash-c2'),('m2a','p','conv2','c-3','ct','contact','Second conversation secret',1,21,'hash-c3'),('mo1','p','convOther','o-1','other','contact','Bob private question',1,31,'hash-o1'),('mq1','q','convQ','q-1','qct','contact','Quinn private question',1,41,'hash-q1')`,
  `UPDATE messages SET content_raw='Alice original email with quoted order history' WHERE id='m1a'`,
  "INSERT INTO email_reply_grants VALUES('reply-alice','p','conv1','alice@example.com',1),('reply-alias','p','convOther','alice.personal@example.com',1),('reply-bob','p','convOther','bob@example.com',1),('reply-q','q','convQ','alice@example.com',1)",
  "INSERT INTO conversation_outbox(project_id,conversation_id,message_id,created_at) VALUES('p','conv1','m1a',11),('p','conv1','m1b',12),('p','conv1','m1c',13),('p','conv2','m2a',21),('p','convOther','mo1',31),('q','convQ','mq1',41)",
  "INSERT INTO media(id,project_id,conversation_id,uploaded_by,object_key,filename,content_type,size,message_id,created_at) VALUES('md1','p','conv1','ct','p/conv1/contact-upload','passport.png','image/png',13,'m1a',11),('md2','p','conv2','operator','p/conv2/operator-upload','invoice.pdf','application/pdf',30,NULL,21),('mdo','p','convOther','other','p/convOther/other-upload','bob.txt','text/plain',19,'mo1',31),('mdq','q','convQ','qct','q/convQ/q-upload','q.txt','text/plain',18,'mq1',41),('mdq2','q','convQ','ct','q/convQ/q-by-ct','q2.txt','text/plain',40,NULL,42)",
  `INSERT INTO conversation_buckets(id,conversation_id,created_at,metadata_json) VALUES('bucket1','conv1',9,'{"id":"bucket1","summary":"Alice asked about a refund for order 4471"}'),('bucketOther','convOther',29,'{"id":"bucketOther","summary":"Bob asked about shipping"}')`,
  "INSERT INTO conversation_notes VALUES('note1','conv1','operator','Alice is a VIP, lives in Sydney',14),('noteOther','convOther','operator','Bob note',32)",
  "INSERT INTO conversation_participants(id,conversation_id,contact_id,created_at) VALUES('part-ct','convOther','ct',33),('part-other','conv1','other',15)",
  "INSERT INTO conversation_reads VALUES('conv1','ct',3),('convOther','other',1),('conv1','operator',3)",
  `INSERT INTO context_subjects(project_id,subject_id,consent,help_types,bot_enabled) VALUES('p','ct',1,'["billing"]',1),('p','other',1,'[]',1),('q','ct',1,'[]',1),('q','qct',0,'[]',1) ON CONFLICT(project_id,subject_id) DO UPDATE SET consent=excluded.consent,help_types=excluded.help_types,bot_enabled=excluded.bot_enabled`,
  "INSERT INTO context_evidence VALUES('ev1','p','ct','customer_message','Alice mentioned order 4471','private',11),('evo','p','other','customer_message','Bob evidence','private',31),('evq','q','ct','customer_message','Same id in another project','private',41)",
  `INSERT INTO context_profiles(project_id,subject_id,type,profile) VALUES('p','ct','contact','{"name":"Alice","city":"Sydney"}'),('p','other','contact','{"name":"Bob"}')`,
  `INSERT INTO context_insights VALUES('in1','p','ct','billing','Alice may want a refund','[]','["ev1"]',12,NULL),('ino','p','other','billing','Bob insight','[]','["evo"]',32,NULL)`,
  `INSERT INTO context_summaries VALUES('sum1','p','ct','Alice browsed pricing twice','["ev1"]',12),('sumo','p','other','Bob summary','["evo"]',32)`,
  "INSERT INTO context_collectors(project_id,subject_id,actions_count) VALUES('p','ct',2),('p','other',1)",
  `INSERT INTO context_actions VALUES('act1','p','ct','a-1','{"type":"click","target":"#buy"}',11),('acto','p','other','a-1','{"type":"click"}',31),('actq','q','ct','a-1','{"type":"click"}',41)`,
  `INSERT INTO context_tracked_events VALUES('pv1','p','ct','pv-1','PAGE_VIEW','{"url":"https://p.example/account/alice","conversation_id":"conv1"}',11),('pvo','p','other','pv-1','PAGE_VIEW','{"url":"https://p.example/bob"}',31),('pvq','q','ct','pv-1','PAGE_VIEW','{"url":"https://q.example/"}',41)`,
  `INSERT INTO context_jobs(id,project_id,subject_id,kind,state,source_revision,packet_json,model,created_at) VALUES('cj1','p','ct','contact','running',1,'{"transcript":"${secret}"}','model',12),('cjo','p','other','contact','completed',1,'{"transcript":"Bob"}','model',32)`,
  `INSERT INTO context_job_events(job_id,kind,payload,created_at) VALUES('cj1','provider','{"output":"Alice profile"}',12),('cjo','provider','{"output":"Bob profile"}',32)`,
  `INSERT INTO ai_generations(id,project_id,conversation_id,state,source_revision,actor_json,model,ai_id,ai_profile_json,kind,instruction,created_at,updated_at,output_json,options_json) VALUES('gen-run','p','conv1','running',3,'{"id":"operator"}','m','ai','{}','reply','Tell Alice about 4471','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z',NULL,'{"message":"Hi Alice, your parcel to 12 Private Lane shipped","client_request_id":"req-run","display_request_version":4}'),('gen-done','p','conv1','completed',2,'{"id":"operator"}','m','ai','{}','suggestions','','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z','{"result":{"responses":["Hi Alice"]},"usage":{"input_tokens":7}}','{"tool":"improve","instructions":"Mention Alice order 4471","message":"Dear Alice Example, card 4242 was refunded","loading_message":"Improving your draft","client_request_id":"req-done","display_request_version":3}'),('gen-other','p','convOther','completed',1,'{"id":"operator"}','m','ai','{}','suggestions','Bob','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z','{"result":{"responses":["Hi Bob"]},"usage":{"input_tokens":3}}','{"tool":"improve","instructions":"Mention Bob order","message":"Hi Bob","client_request_id":"req-other","display_request_version":1}')`,
  "INSERT INTO ai_attempts(id,generation_id,state,started_at) VALUES('att-run','gen-run','running','2026-01-01T00:00:00.000Z'),('att-other','gen-other','completed','2026-01-01T00:00:00.000Z')",
  `INSERT INTO ai_attempt_events(attempt_id,type,event_json,created_at) VALUES('att-run','agent_done','{"type":"agent_done","output":"Alice reply"}','2026-01-01T00:00:00.000Z'),('att-run','cost_update','{"type":"cost_update","usage":{"input_tokens":5}}','2026-01-01T00:00:00.000Z'),('att-other','agent_done','{"type":"agent_done","output":"Bob reply"}','2026-01-01T00:00:00.000Z')`,
  `INSERT INTO ai_round_usage VALUES('att-run','r1','m','{"input_tokens":5}',1),('att-other','r1','m','{"input_tokens":3}',1)`,
  "INSERT INTO local_devices(id,user_id,project_id,token_hash,name,provider,capabilities) VALUES('dev','operator','p','device-hash','Laptop','codex','[]')",
  `INSERT INTO local_jobs(id,project_id,conversation_id,operator_id,device_id,request_id,mode,instructions,status,context,result,created_at) VALUES('job1','p','conv1','operator','dev','req-1','investigate','Look up Alice order 4471','running','{"contact":{"name":"Alice Example"}}',NULL,'2026-01-01T00:00:00.000Z'),('jobo','p','convOther','operator','dev','req-2','investigate','Look up Bob','completed','{"contact":{"name":"Bob"}}','{"summary":"Bob done"}','2026-01-01T00:00:00.000Z')`,
  `INSERT INTO local_events VALUES('job1','e1','progress','{"text":"Found Alice order"}','2026-01-01T00:00:00.000Z'),('jobo','e1','progress','{"text":"Bob progress"}','2026-01-01T00:00:00.000Z')`,
  "INSERT INTO local_attachments VALUES('la1','job1','dev','delegation/p/job1/shot','image/png','shot.png',27)",
  "INSERT INTO local_attachment_grants VALUES('la1','job1','dev')",
  `INSERT INTO local_result_effects VALUES('job1','e2','{"summary":"Alice result"}','pending')`,
  "INSERT INTO local_receipts(job_id,proposal_id,kind,status,review_message) VALUES('job1','prop','reply','review','Draft to Alice about 4471')",
  "INSERT INTO email_deliveries VALUES('message:m1b:notification','p','alice@example.com','Reply to your support conversation','ih1','sent',NULL,NULL,1,1),('transcript-key','p','alice.personal@example.com','Conversation transcript','ih2','sent',NULL,NULL,1,1),('message:mo1:x','p','bob@example.com','Reply to your support conversation','ih3','sent',NULL,NULL,1,1)",
  `INSERT INTO legacy_import_runs VALUES('run','{}','digest-run','completed',1,2)`,
  // Inbound email claims (0104): evidence on the contact's conversation, from its address before admission, and for others.
  `INSERT INTO inbound_emails(id,project_id,conversation_id,intent_hash,state,created_at,automatic,evidence_json,local_id,message_id) VALUES
   ('seed-in-conv','p','conv1','hash-seed-conv','completed',11,1,'{"envelope_from":"alice@example.com","header_from":"Alice Example <alice@example.com>","subject":"Order 4471 refund","headers":{"x-mailer":"Private Client"},"reasons":["auto-submitted","list-header"]}','email:seed-1','m1a'),
   ('seed-in-sender','p',NULL,'hash-seed-sender','pending',12,0,'{"envelope_from":"bounce@mail.example","header_from":"\\"Alice Example\\" <Alice.Personal@example.com>","subject":"Sydney visit","headers":{},"reasons":[]}','email:seed-2',NULL),
   ('seed-in-other','p','convOther','hash-seed-other','completed',31,0,'{"envelope_from":"bob@example.com","header_from":"Bob <bob@example.com>","subject":"Bob question","headers":{},"reasons":["precedence-bulk"]}','email:seed-3','mo1'),
   ('seed-in-q','q',NULL,'hash-seed-q','completed',41,0,'{"envelope_from":"alice@example.com","header_from":"Alice <alice@example.com>","subject":"Other project mail","headers":{},"reasons":[]}','email:seed-4',NULL)`,
  `INSERT INTO legacy_import_rows VALUES('run','contacts','ct','d-ct','{"name":"Alice Example","email":"alice@example.com"}','contacts','ct','mapped'),('run','messages','m1a','d-m1a','{"content":"${secret}"}','messages','m1a','mapped'),('run','contacts','other','d-other','{"name":"Bob Other"}','contacts','other','mapped'),('run','profiles','old-p','d-prof','{"profile":"Alice lives in Sydney"}','context_profiles','p:ct:contact','mapped'),('run','buckets','bucket1','d-bucket1','{"id":"bucket1","summary":"Alice asked about a refund for order 4471"}','conversation_buckets','bucket1','mapped'),('run','buckets','bucketOther','d-bucketOther','{"id":"bucketOther","summary":"Bob asked about shipping"}','conversation_buckets','bucketOther','mapped')`,
 ]
 await DB.batch(rows.map(sql=>DB.prepare(sql)))
 const tokens={}
 for(const [name,actor,project,role,contact] of [['owner','owner','p','owner',null],['admin','admin','p','admin',null],['operator','operator','p','operator',null],['qOwner','q-owner','q','owner',null],['contact','ct','p','contact','ct'],['contact2','ct','p','contact','ct'],['otherContact','other','p','contact','other']]){tokens[name]='token-'+name;await DB.prepare('INSERT INTO sessions VALUES(?,?,?,?,?,?,NULL)').bind(await hashToken(tokens[name]),actor,project,role,contact,now*2).run();if(!contact)await DB.prepare("INSERT INTO session_factors VALUES(?,?,'password',?)").bind(await hashToken(tokens[name]),actor,Date.now()).run()}
 for(const [key,value] of Object.entries(objects))await FILES.put(key,value)
 return tokens
}

// Everything outside the erased contact's scope; context_subjects.revision is a
// project-wide cache counter that message-content triggers deliberately bump.
async function outsideScope(){
 const snapshot={
  contacts:await all("SELECT * FROM contacts WHERE id<>'ct' ORDER BY id"),
  sessions:await all("SELECT * FROM sessions WHERE contact_id IS NULL OR contact_id<>'ct' ORDER BY token_hash"),
  conversations:await all('SELECT * FROM conversations ORDER BY id'),
  outbox:await all('SELECT * FROM conversation_outbox ORDER BY id'),
  messages:await all("SELECT * FROM messages WHERE conversation_id NOT IN ('conv1','conv2') ORDER BY id"),
  media:await all("SELECT * FROM media WHERE id NOT IN ('md1','md2') ORDER BY id"),
  notes:await all("SELECT * FROM conversation_notes WHERE conversation_id NOT IN ('conv1','conv2') ORDER BY id"),
  participants:await all("SELECT * FROM conversation_participants WHERE contact_id<>'ct' ORDER BY id"),
  reads:await all("SELECT * FROM conversation_reads WHERE user_id<>'ct' ORDER BY conversation_id,user_id"),
  subjects:await all("SELECT project_id,subject_id,consent,help_types,bot_enabled FROM context_subjects WHERE NOT (project_id='p' AND subject_id='ct') ORDER BY project_id,subject_id"),
  generations:await all("SELECT * FROM ai_generations WHERE conversation_id NOT IN ('conv1','conv2') ORDER BY id"),
  attemptEvents:await all("SELECT * FROM ai_attempt_events WHERE attempt_id<>'att-run' ORDER BY id"),
  usage:await all('SELECT * FROM ai_round_usage ORDER BY attempt_id,request_id'),
  localJobs:await all("SELECT * FROM local_jobs WHERE id<>'job1' ORDER BY id"),
  localEvents:await all("SELECT * FROM local_events WHERE job_id<>'job1'"),
  replyGrants:await all("SELECT * FROM email_reply_grants WHERE token_hash IN ('reply-bob','reply-q') ORDER BY token_hash"),
  email:await all("SELECT * FROM email_deliveries WHERE id='message:mo1:x'"),
  legacy:await all("SELECT * FROM legacy_import_rows WHERE source_id IN ('other','bucketOther') ORDER BY source_id"),
  buckets:await all("SELECT * FROM conversation_buckets WHERE conversation_id NOT IN ('conv1','conv2') ORDER BY id"),
  inbound:await all("SELECT * FROM inbound_emails WHERE id IN ('seed-in-other','seed-in-q') ORDER BY id"),
  objects:Object.fromEntries(await Promise.all(['p/convOther/other-upload','q/convQ/q-upload','q/convQ/q-by-ct'].map(async key=>[key,await objectText(key)]))),
 }
 for(const table of ['context_evidence','context_profiles','context_insights','context_summaries','context_collectors','context_actions','context_tracked_events','context_jobs'])snapshot[table]=await all(`SELECT * FROM ${table} WHERE NOT (project_id='p' AND subject_id='ct') ORDER BY 1,2,3`)
 snapshot.contextJobEvents=await all("SELECT * FROM context_job_events WHERE job_id<>'cj1'")
 return snapshot
}

// Every row or object that held the erased contact's personal data.
async function erasedScope(){
 return {
  contact:await one("SELECT * FROM contacts WHERE id='ct'"),
  sessions:await all("SELECT * FROM sessions WHERE contact_id='ct'"),
  messages:await all("SELECT id,local_id,actor_id,actor_role,content,revision,intent_hash,erased_at IS NOT NULL erased FROM messages WHERE conversation_id IN ('conv1','conv2') ORDER BY id"),
  media:await all("SELECT * FROM media WHERE id IN ('md1','md2')"),
  objects:await Promise.all(['p/conv1/contact-upload','p/conv2/operator-upload','delegation/p/job1/shot'].map(objectText)),
  notes:await all("SELECT * FROM conversation_notes WHERE conversation_id IN ('conv1','conv2')"),
  participants:await all("SELECT * FROM conversation_participants WHERE contact_id='ct'"),
  reads:await all("SELECT * FROM conversation_reads WHERE user_id='ct'"),
  context:Object.fromEntries(await Promise.all(['context_subjects','context_evidence','context_profiles','context_insights','context_summaries','context_collectors','context_actions','context_tracked_events','context_jobs'].map(async table=>[table,(await one(`SELECT count(*) n FROM ${table} WHERE project_id='p' AND subject_id='ct'`)).n]))),
  contextJobEvents:await all("SELECT * FROM context_job_events WHERE job_id='cj1'"),
  generations:await all("SELECT id,state,instruction,output_json,options_json FROM ai_generations WHERE conversation_id='conv1' ORDER BY id"),
  buckets:await all("SELECT * FROM conversation_buckets WHERE conversation_id IN ('conv1','conv2') ORDER BY id"),
  attemptEvents:await all("SELECT type,event_json FROM ai_attempt_events WHERE attempt_id='att-run' ORDER BY id"),
  localJob:await one("SELECT status,cancel_requested,instructions,context,result FROM local_jobs WHERE id='job1'"),
  localEvents:await all("SELECT payload FROM local_events WHERE job_id='job1'"),
  localAttachments:await all("SELECT * FROM local_attachments WHERE job_id='job1'"),
  localGrants:await all("SELECT * FROM local_attachment_grants WHERE job_id='job1'"),
  localEffect:await one("SELECT payload,state FROM local_result_effects WHERE job_id='job1'"),
  localReceipt:await one("SELECT review_message FROM local_receipts WHERE job_id='job1'"),
  email:await all("SELECT id,recipient FROM email_deliveries WHERE id IN ('message:m1b:notification','transcript-key') ORDER BY id"),
  legacy:await all("SELECT source_id,row_digest,source_json FROM legacy_import_rows WHERE source_id IN ('bucket1','ct','m1a','old-p') ORDER BY source_id"),
  inbound:await all("SELECT id,automatic,evidence_json,local_id,message_id FROM inbound_emails WHERE id IN ('seed-in-conv','seed-in-sender') ORDER BY id"),
  staged:await all('SELECT * FROM contact_erasure_objects'),
 }
}

test('an owner erases a populated customer, observes coherent redacted history and external deletion, and safely completes repeats and interrupted erasures',async()=>{
 app=await startApp({outbound:webhook,bindings:{INTEGRATION_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64')}});DB=app.db;FILES=await app.files;env={DB,FILES}
 try{
let tokens,before
{
 tokens=await seed();before=await outsideScope()
 assert.equal((await erasedScope()).objects.every(Boolean),true)
 assert.equal((await call(conversationRoutes,'/conv1/messages',tokens.contact)).status,200)
}

{
 assert.equal((await erase(tokens.operator)).status,403,'operator refused')
 assert.equal((await erase(tokens.contact)).status,403,'contact session refused')
 assert.equal((await erase(tokens.qOwner)).status,403,'owner of another project refused')
 assert.equal((await erase(tokens.qOwner,'q')).status,404,'another project cannot address the contact')
 assert.equal((await erase(tokens.owner,'p','qct')).status,404,'contact outside the project is not found')
 assert.equal((await erase(tokens.owner,'p','missing')).status,404)
 const unchanged=await erasedScope()
 assert.equal(unchanged.contact.name,'Alice Example');assert.equal(unchanged.messages[0].content,secret);assert.equal(unchanged.sessions.length,2);assert.equal(unchanged.staged.length,0)
 assert.deepEqual(await outsideScope(),before)
}

let first,opAfter
{
 const hook=await call(routes,'/projects/p/connections/webhooks',tokens.owner,'POST',{name:'CRM',url:'https://hooks.crm-example.com/erasure',events:['conversation.created']});assert.equal(hook.status,201)
 const destination=(await hook.json()).id
 const response=await erase(tokens.admin);assert.equal(response.status,200)
 first=(await response.json()).data
 assert.deepEqual(first.providers.requests.map(r=>[r.store,r.state]),[['ai_provider','unsupported'],['local_computers','unsupported'],['webhook','pending']])
 assert.deepEqual(first.providers.counts,{completed:0,pending:1,failed:0,unsupported:2})
 // A destination test dispatches the workspace's queue: the deletion request goes out signed, with ids only.
 assert.equal((await call(routes,`/projects/p/connections/webhooks/${destination}/test`,tokens.owner,'POST')).status,202)
 const request=deletionRequests.find(body=>body.event==='contact.erased');assert.deepEqual(request.data,{contact_id:'ct',external_id:'crm-alice'})
 const settled=(await(await call(routes,'/projects/p/contacts/ct/erasure',tokens.admin)).json()).data.providers
 assert.deepEqual(settled.counts,{completed:1,pending:0,failed:0,unsupported:2})
 assert.equal((await one("SELECT count(*) n FROM audit_events WHERE action='contact.erased' AND target_id='ct'")).n,1)
 assert.equal(first.erased_by,'admin');assert.equal(first.runs,1);assert.equal(first.erased_at,first.last_erased_at)
 assert.deepEqual({conversations:first.conversations,messages:first.messages,attachments:first.attachments,tracked_events:first.tracked_events,context_records:first.context_records,sessions:first.sessions},{conversations:2,messages:4,attachments:3,tracked_events:2,context_records:7,sessions:2})
 const erased=await erasedScope()
 assert.deepEqual(await all("SELECT * FROM email_reply_grants WHERE token_hash IN ('reply-alice','reply-alias')"),[])
 assert.ok((await all("SELECT content_raw FROM messages WHERE conversation_id IN ('conv1','conv2')")).every(message=>message.content_raw===null))
 assert.deepEqual({name:erased.contact.name,email:erased.contact.email,external_id:erased.contact.external_id,is_verified:erased.contact.is_verified},{name:null,email:null,external_id:null,is_verified:0})
 assert.deepEqual(JSON.parse(erased.contact.metadata_json),{is_deleted:1,is_blocked:1,is_erased:1,erased_at:first.erased_at})
 assert.deepEqual(erased.sessions,[])
 assert.deepEqual(erased.messages.map(m=>[m.id,m.local_id,m.actor_id,m.revision,m.content,m.intent_hash,m.erased]),[['m1a','erased:m1a','ct',1,'',null,1],['m1b','erased:m1b','operator',2,'',null,1],['m1c','erased:m1c','ct',3,'',null,1],['m2a','erased:m2a','ct',1,'',null,1]])
 assert.deepEqual(erased.media,[]);assert.deepEqual(erased.objects,[null,null,null])
 assert.deepEqual(erased.notes,[]);assert.deepEqual(erased.participants,[]);assert.deepEqual(erased.reads,[])
 assert.deepEqual(Object.values(erased.context),Array(9).fill(0));assert.deepEqual(erased.contextJobEvents,[])
 assert.deepEqual(erased.generations,[{id:'gen-done',state:'completed',instruction:'',output_json:'{"usage":{"input_tokens":7}}',options_json:'{"tool":"improve","client_request_id":"req-done","display_request_version":3}'},{id:'gen-run',state:'cancelled',instruction:'',output_json:null,options_json:'{"client_request_id":"req-run","display_request_version":4}'}])
 assert.deepEqual(erased.buckets,[{id:'bucket1',conversation_id:'conv1',created_at:9,metadata_json:'{}'}])
 assert.deepEqual(erased.attemptEvents,[{type:'agent_done',event_json:'{"type":"agent_done","erased":1}'},{type:'cost_update',event_json:'{"type":"cost_update","usage":{"input_tokens":5}}'}])
 assert.deepEqual(erased.localJob,{status:'cancelled',cancel_requested:1,instructions:'',context:null,result:null})
 assert.deepEqual(erased.localEvents,[{payload:'{}'}]);assert.deepEqual(erased.localAttachments,[]);assert.deepEqual(erased.localGrants,[])
 assert.deepEqual(erased.localEffect,{payload:'{}',state:'cancelled'});assert.equal(erased.localReceipt.review_message,null)
 assert.deepEqual(erased.email,[{id:'message:m1b:notification',recipient:''},{id:'transcript-key',recipient:''}])
 assert.deepEqual(erased.legacy,[{source_id:'bucket1',row_digest:'d-bucket1',source_json:'{}'},{source_id:'ct',row_digest:'d-ct',source_json:'{}'},{source_id:'m1a',row_digest:'d-m1a',source_json:'{}'},{source_id:'old-p',row_digest:'d-prof',source_json:'{}'}])
 assert.deepEqual(erased.inbound,[
  {id:'seed-in-conv',automatic:1,evidence_json:'{"reasons":["auto-submitted","list-header"]}',local_id:'email:seed-1',message_id:'m1a'},
  {id:'seed-in-sender',automatic:0,evidence_json:'{"reasons":[]}',local_id:'email:seed-2',message_id:null},
 ])
 assert.deepEqual(erased.staged,[])
 const dump=JSON.stringify(await Promise.all(['contacts','conversation_buckets','messages','media','conversation_notes','context_evidence','context_profiles','context_insights','context_summaries','context_tracked_events','context_jobs','context_job_events','ai_generations','ai_attempt_events','local_jobs','local_events','local_result_effects','local_receipts','email_deliveries','legacy_import_rows'].map(table=>all(`SELECT * FROM ${table}`))))
 for(const fragment of ['Alice','alice','4471','4242','Sydney','crm-alice','203.0.113.9','Private Lane','Second conversation secret'])assert.equal(dump.includes(fragment),false,`${fragment} remains in D1`)
 // Another project's claim from the same address is not the erased contact's data.
 const inbound=JSON.stringify(await all("SELECT * FROM inbound_emails WHERE project_id='p'"))
 for(const fragment of ['Alice','alice','4471','Sydney','Private Client'])assert.equal(inbound.includes(fragment),false,`${fragment} remains in inbound email evidence`)
}

{
 assert.deepEqual(await outsideScope(),before)
}

{
 assert.equal((await call(conversationRoutes,'/conv1/messages',tokens.contact)).status,401,'erased widget session is gone')
 const transcript=await(await call(conversationRoutes,'/conv1/messages',tokens.operator)).json()
 assert.equal(transcript.revision,3);assert.equal(transcript.lastMessageId,'m1c');assert.deepEqual(transcript.messages.map(m=>[m.revision,m.content,m.media.length]),[[1,'',0],[2,'',0],[3,'',0]])
 const buckets=await(await call(dashboardRoutes,'/projects/p/conversations/conv1/buckets',tokens.operator)).json()
 assert.equal(buckets.data[0].messages.length,3);assert.ok(buckets.data[0].messages.every(m=>m.erased_at&&m.content===''))
 const detail=await(await call(dashboardRoutes,'/projects/p/conversations/conv1',tokens.operator)).json()
 assert.equal(detail.data.contact.display_name,'Erased contact')
 const replay=await (await call(conversationRoutes,'/conv1/messages',tokens.operator,'POST',{localId:'op-1',content:'Thanks Alice, checking order 4471',expectedRevision:1,expectedLastMessageId:'m1a'})).json()
 assert.equal(replay.accepted,false,'an erased command cannot be replayed into the transcript')
 const next=await (await call(conversationRoutes,'/conv1/messages',tokens.operator,'POST',{localId:'op-after',content:'Closing this conversation',expectedRevision:3,expectedLastMessageId:'m1c'})).json()
 assert.equal(next.accepted,true);assert.equal(next.message.revision,4);opAfter=next.message.id
 const list=await(await call(routes,'/projects/p/contacts',tokens.operator)).json()
 assert.deepEqual(list.data.map(c=>c.id),['other'])
 assert.equal((await call(routes,'/projects/p/contacts/ct',tokens.owner,'PUT',{name:'Alice again'})).status,409)
}

{
 const state=await erasedScope(),outside=await outsideScope()
 const followupHistory=await all("SELECT type,payload FROM context_tracked_events WHERE project_id='p' AND subject_id='ct'")
 const sender=await one('SELECT actor_id FROM messages WHERE id=?',opAfter)
 const newTicketRecords=(await one("SELECT count(*) n FROM ticket_history WHERE project_id='p' AND conversation_id IN ('conv1','conv2') AND changes_json<>'{\"erased\":true}'")).n
 assert.ok(followupHistory.some(event=>event.type==='AGENT_ASSIGNED'&&JSON.parse(event.payload).agent_id===sender.actor_id),'the follow-up operator reply also records its server-authored handoff')
 const response=await erase(tokens.owner);assert.equal(response.status,200)
 const second=(await response.json()).data
 assert.equal(second.erased_at,first.erased_at);assert.equal(second.erased_by,'admin');assert.equal(second.runs,2);assert.ok(second.last_erased_at>=first.last_erased_at)
 // The operator message written after the first erasure belongs to the erased conversation.
 // A repeat asks the connected webhook again; the latest request replaces the settled one.
 assert.deepEqual(second.providers.counts,{completed:0,pending:1,failed:0,unsupported:2})
 const {providers:secondProviders,...secondRecord}=second,{providers:firstProviders,...firstRecord}=first
 assert.deepEqual({...secondRecord,runs:1,last_erased_at:first.last_erased_at,messages:second.messages-1,tracked_events:second.tracked_events-followupHistory.length,ticket_records:second.ticket_records-newTicketRecords},firstRecord)
 const again=await erasedScope()
 assert.deepEqual(await one('SELECT content,local_id FROM messages WHERE id=?',opAfter),{content:'',local_id:'erased:'+opAfter})
 assert.deepEqual({...again,messages:again.messages.filter(m=>m.id!==opAfter)},{...state,messages:state.messages.filter(m=>m.id!==opAfter),context:{...state.context,context_tracked_events:state.context.context_tracked_events-followupHistory.length}})
 assert.deepEqual(await all("SELECT type,payload FROM context_tracked_events WHERE project_id='p' AND subject_id='ct'"),[],'repeat erasure removes the new handoff observation too')
 assert.deepEqual(await outsideScope(),outside)
 const third=(await(await erase(tokens.owner)).json()).data
 const {providers:thirdProviders,...thirdRecord}=third
 assert.deepEqual({...thirdRecord,runs:2,last_erased_at:second.last_erased_at},secondRecord)
 assert.deepEqual(await erasedScope(),again)
}


 {
 await DB.batch([
  DB.prepare("INSERT INTO contacts(id,project_id,name,email,created_at) VALUES('late','p','Late Visitor','late@example.com',8)"),
  DB.prepare("INSERT INTO conversations(id,project_id,contact_id,revision,last_message_id,created_at,updated_at) VALUES('convLate','p','late',1,'ml1',50,51)"),
  DB.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at) VALUES('ml1','p','convLate','l-1','late','contact','Late private detail',1,51)"),
  DB.prepare("INSERT INTO media(id,project_id,conversation_id,uploaded_by,object_key,filename,content_type,size,message_id,created_at) VALUES('mdl','p','convLate','late','p/convLate/late-upload','late.txt','text/plain',12,'ml1',51)"),
  DB.prepare("INSERT INTO sessions VALUES(?,'late','p','contact','late',?,NULL)").bind(await hashToken('token-late'),Date.now()+999999),
 ])
 await FILES.put('p/convLate/late-upload','late private')
 // The request stops after deleting objects and before the D1 erasure commits.
 await DB.prepare("CREATE TRIGGER erasure_outage BEFORE INSERT ON contact_erasures WHEN NEW.contact_id='late' BEGIN SELECT RAISE(ABORT,'synthetic storage outage'); END").run()
 assert.equal((await erase(tokens.owner,'p','late')).status,500)
 await DB.prepare('DROP TRIGGER erasure_outage').run()
 assert.equal(await objectText('p/convLate/late-upload'),null)
 assert.equal((await one("SELECT content FROM messages WHERE id='ml1'")).content,'Late private detail')
 assert.equal((await all("SELECT * FROM contact_erasure_objects WHERE contact_id='late'")).length,1,'the object ledger survives the interruption')
 assert.equal((await call(conversationRoutes,'/convLate/messages','token-late')).status,401,'the fenced contact can no longer write')
 const response=await erase(tokens.owner,'p','late');assert.equal(response.status,200)
 const erasure=(await response.json()).data
 assert.deepEqual([erasure.messages,erasure.attachments,erasure.sessions,erasure.runs],[1,1,1,1])
 assert.deepEqual(await all("SELECT content FROM messages WHERE id='ml1'"),[{content:''}])
 assert.deepEqual(await all("SELECT * FROM media WHERE id='mdl'"),[])
 assert.deepEqual(await all("SELECT * FROM contact_erasure_objects"),[])

 }
 {
 const inbound=`email:${await hashToken('p:lid-inbound')}`
 await DB.batch([
  DB.prepare("INSERT INTO contacts(id,project_id,name,email,created_at) VALUES('lid','p','Lid Visitor','lid@example.com',9)"),
  DB.prepare("INSERT INTO conversations(id,project_id,contact_id,revision,last_message_id,created_at,updated_at) VALUES('convLid','p','lid',5,'mlid5',60,65)"),
  DB.prepare("INSERT INTO ai_generations(id,project_id,conversation_id,state,source_revision,actor_json,model,ai_id,ai_profile_json,kind,instruction,created_at,updated_at) VALUES('gen-lid','p','convLid','completed',2,'{\"role\":\"contact\"}','m','ai','{}','reply','','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')"),
  DB.prepare("INSERT INTO ai_attempts(id,generation_id,state,started_at) VALUES('att-lid','gen-lid','running','2026-01-01T00:00:00.000Z')"),
  DB.prepare(`INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at,intent_hash) VALUES
   ('mlid1','p','convLid','Lid Visitor free text 4471','lid','contact','Visitor text',1,61,'hash-l1'),
   ('mlid2','p','convLid',?1,'lid','contact','Mail from Lid Visitor',2,62,'hash-l2'),
   ('mlid3','p','convLid','generation:gen-lid','ai','ai','AI reply to Lid Visitor',3,63,'hash-l3'),
   ('mlid4','p','convLid','generation:Lid Visitor forged','ai','ai','Insight for Lid Visitor',4,64,NULL),
   ('mlid5','p','convLid','email:Lid Visitor forged','lid','contact','Forged mail id',5,65,'hash-l5')`).bind(inbound),
  DB.prepare("INSERT INTO inbound_emails(id,project_id,conversation_id,intent_hash,state,created_at,automatic,evidence_json,local_id,message_id) VALUES('lid-claim','p','convLid','hash-lid-claim','completed',62,1,'{\"envelope_from\":\"lid@example.com\",\"subject\":\"Lid Visitor out of office\",\"reasons\":[\"auto-submitted\"]}',?,'mlid2')").bind(inbound),
 ])
 const response=await erase(tokens.owner,'p','lid');assert.equal(response.status,200)
 const rows=await all("SELECT id,local_id,content FROM messages WHERE conversation_id='convLid' ORDER BY revision")
 assert.deepEqual(rows.map(m=>[m.id,m.local_id,m.content]),[['mlid1','erased:mlid1',''],['mlid2',inbound,''],['mlid3','generation:gen-lid',''],['mlid4','erased:mlid4',''],['mlid5','erased:mlid5','']])
 assert.equal(JSON.stringify(await all('SELECT local_id FROM messages')).match(/Lid|Visitor|free text|forged/g),null,'no client-supplied local id text remains')
 // The inbound claim still owns its message, so the operator transcript keeps its origin.
 const transcript=await(await call(conversationRoutes,'/convLid/messages',tokens.operator)).json()
 assert.deepEqual(transcript.messages.find(m=>m.id==='mlid2').origin,{channel:'email',automatic:true,reasons:['auto-submitted']})
 // Erased commands and reserved IDs cannot restore personal content through the message route.
 assert.equal((await (await call(conversationRoutes,'/convLid/messages',tokens.operator,'POST',{localId:'Lid Visitor free text 4471',content:'Visitor text',expectedRevision:0})).json()).accepted,false)
 const reserved=await call(conversationRoutes,'/convOther/messages',tokens.operator,'POST',{localId:'erased:mo1',content:'Collide',expectedRevision:1})
 assert.equal(reserved.status,400);assert.equal((await one("SELECT revision FROM conversations WHERE id='convOther'")).revision,1)
 // Repeating the erasure leaves the rewritten ids as they are.
 assert.equal((await erase(tokens.owner,'p','lid')).status,200)
 assert.deepEqual(await all("SELECT id,local_id,content FROM messages WHERE conversation_id='convLid' ORDER BY revision"),rows)

 }
 }finally{await app.close()}
 await rerMailErasureJourney()
})
