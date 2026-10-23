import {migrationStatements} from './helpers/migration-statements.mjs';
import {registerHooks} from 'node:module';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
// Node has no Workers runtime module; the demo guard reads only RER_DEMO from it, which is off here.
registerHooks({resolve(s,c,next){if(s==='cloudflare:workers')return{url:'data:text/javascript,export const env={}',shortCircuit:true};if(s.startsWith('.')&&c.parentURL){const u=new URL(s+'.ts',c.parentURL);if(existsSync(u))return next(u.href,c)}return next(s,c)}});
const {dashboard}=await import('../src/modules/management/dashboard.ts');
const {hashToken}=await import('../src/platform/auth.ts');
const {bucketData}=await import('../src/modules/management/buckets.ts');
const {handleContextWidgetAction}=await import('../src/modules/customer-context/widget.ts');
const {getBucketTranscriptItems,groupTranscriptItems}=await import('../src/ui/dashboard/utils/transcriptGrouping.js');
const {getPlatformProxy}=await import('wrangler');
const proxy=await getPlatformProxy({persist:false});
try{
 const env=proxy.env,db=env.DB;
 for(const file of ['0001_identity.sql','0002_conversations.sql','0005_widget_identity.sql','0007_conversation_history.sql','0070_management.sql','0050_knowledge.sql','0060_customer_context.sql','0060_customer_context_engine.sql','020_ai_support.sql','0110_move_in.sql','180_account_security.sql','142_collaboration.sql','0080_integrations.sql','130_ticket_model.sql','244_enterprise_identity.sql','245_scoped_access.sql']){
  for(const sql of migrationStatements(await readFile(new URL('../migrations/'+file,import.meta.url),'utf8')))await db.prepare(sql).run();
 }
 await db.batch([
  db.prepare("INSERT INTO projects(id,name,widget_key,allowed_origin,created_at) VALUES('p','P','p','https://p.test',1),('q','Q','q','https://q.test',1)"),
  db.prepare("INSERT INTO users VALUES('agent','a@example.test','Agent',1),('foreign','f@example.test','Foreign',1)"),
  db.prepare("INSERT INTO memberships VALUES('p','agent','owner'),('q','foreign','owner')"),
  db.prepare("INSERT INTO contacts(id,project_id,name,email,external_id,created_at) VALUES('contact','p','Visitor',NULL,NULL,1),('other','p','Other',NULL,NULL,1)"),
  db.prepare("INSERT INTO conversations(id,project_id,contact_id,created_at,updated_at) VALUES('c','p','contact',1,200),('c2','p','contact',1,200)"),
  db.prepare("INSERT INTO conversation_buckets VALUES('old','c',1,'{}')"),
  db.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at) VALUES('m','p','c','m','contact','contact','Hello',1,100)"),
  db.prepare("INSERT INTO conversation_notes VALUES('note','c','agent','Private note',150)"),
  db.prepare("INSERT INTO context_subjects(project_id,subject_id,consent) VALUES('p','contact',1)"),
  db.prepare("INSERT INTO context_insights VALUES('insight','p','contact','support','Helpful', '[]','[]',1,NULL)"),
 ]);
 const add=async(id,type,payload,project='p',subject='contact',time=200)=>db.prepare('INSERT INTO context_tracked_events VALUES(?,?,?,?,?,?,?)').bind(id,project,subject,id,type,JSON.stringify(payload),time).run();
 const scope={conversation_id:'c',bucket_id:'c'};
 await add('page1','PAGE_VIEW',{...scope,url:'https://p.test/help'});
 await add('page2','PAGE_VIEW',{...scope,url:'https://p.test/shipping'},'p','contact',201);
 await add('assigned','AGENT_ASSIGNED',{...scope,is_ai:false,name:'Agent',agent_id:'agent'},'p','contact',202);
 await add('insight-event','USED_INSIGHT',{...scope,insight_id:'insight',close:true},'p','contact',203);
 await add('oldpage','PAGE_VIEW',{...scope,bucket_id:'old',url:'/old'});
 await add('foreignproject','PAGE_VIEW',{...scope,url:'/private'},'q');
 await add('foreignsubject','PAGE_VIEW',{...scope,url:'/private'},'p','other');
 await add('foreignconversation','PAGE_VIEW',{...scope,conversation_id:'c2',url:'/private'});
 await add('unscoped','PAGE_VIEW','/unknown');
 await add('badactor','PAGE_VIEW',{...scope,url:'/private',agent_id:'foreign'});
 await add('badinsight','USED_INSIGHT',{...scope,insight_id:'unknown'});
 await add('unsafe','PAGE_VIEW',{...scope,url:'javascript:alert(1)'});
 await add('unsupported','RESOLVED',scope);
 await db.prepare("INSERT INTO sessions VALUES(?,'agent','p','owner',NULL,?,NULL)").bind(await hashToken('token'),Date.now()+100000).run();
 const response=await dashboard.request('https://app.test/conversations/c/buckets',{headers:{Authorization:'Bearer token'}},env);
 assert.equal(response.status,200);const listing=await response.json();assert.deepEqual(listing.data.map(b=>b.id),['c','old']);
 const before=await dashboard.request('https://app.test/conversations/c/buckets?created_before='+encodeURIComponent(new Date(100).toISOString()),{headers:{Authorization:'Bearer token'}},env);assert.deepEqual((await before.json()).data.map(b=>b.id),['old']);
 const conversation=await db.prepare("SELECT * FROM conversations WHERE id='c'").first();
 const bucket=await bucketData(env,conversation,'c');
 assert.deepEqual(bucket.events.map(e=>e.id),['note','page1','page2','assigned','insight-event']);
 assert.equal(bucket.created_at,new Date(100).toISOString());assert.equal(bucket.updated_at,new Date(203).toISOString());
 assert.equal(bucket.counts.contact_events_page_view,2);assert.equal(bucket.counts.agent_events_internal_note,1);assert.equal(bucket.counts.agent_events_agent_assigned,1);
 assert.equal(bucket.events[1].payload,'https://p.test/help');assert.equal(bucket.events[1].contact.display_name,'Visitor');
 assert.equal(bucket.events[3].agent.display_name,'Agent');assert.equal(bucket.events[4].close,true);
 assert.equal((await bucketData(env,conversation,'old')).events[0].id,'oldpage');
 assert.equal(await bucketData(env,conversation,'missing'),null);
 const items=getBucketTranscriptItems(bucket);assert.ok(items.some(Array.isArray),'adjacent pageviews form the renderer page visit group');assert.ok(groupTranscriptItems(items).length>1);
 await handleContextWidgetAction(env,{role:'contact',contactId:'contact',projectId:'p'},'c','saveEvents',[{localId:'live',type:'PAGE_VIEW',payload:{url:'/live',conversation_id:'c2',bucket_id:'old',agent_id:'foreign'}}]);
 const live=(await bucketData(env,conversation,'c')).events.find(e=>e.id&&!['note','page1','page2','assigned','insight-event'].includes(e.id));
 assert.equal(live.payload,'/live');assert.equal(live.contact_id,'contact');assert.equal(live.agent_id,null);assert.equal(live.bucket_id,'c');
 const actor={role:'contact',contactId:'contact',projectId:'p'};
 const save=(conversationId,events)=>handleContextWidgetAction(env,actor,conversationId,'saveEvents',events);
 const count=async()=>Number((await db.prepare('SELECT count(*) n FROM context_tracked_events').first()).n);
 const beforeSpoof=await count();
 await save('c',[{type:'AGENT_ASSIGNED',localId:'spoof',payload:{name:'Forged human',is_ai:false}},{type:'USED_INSIGHT',localId:'spoof-insight',payload:{insight_id:'insight'}}]);
 assert.equal(await count(),beforeSpoof,'public telemetry cannot forge assignment or insight history');
 await save('c',[{type:'PAGE_VIEW',payload:{url:'/stable',conversation_id:'fake',bucket_id:'fake',agent_id:'foreign'}}]);
 const stableCount=await count();
 await save('c',[{type:'PAGE_VIEW',payload:{url:'/stable',conversation_id:'other-forgery',bucket_id:'old',agent_id:'agent',noise:'ignored'}}]);
 assert.equal(await count(),stableCount,'content identity is computed after trusted normalization');
 await save('c',[{type:'PAGE_VIEW',localId:'shared',payload:'/shared'}]);
 await save('c2',[{type:'PAGE_VIEW',localId:'shared',payload:'/shared'}]);
 const sharedRows=(await db.prepare("SELECT payload FROM context_tracked_events WHERE json_extract(payload,'$.url')='/shared'").all()).results;
 assert.equal(sharedRows.length,2,'client IDs are conversation scoped');
 assert.deepEqual(sharedRows.map(row=>JSON.parse(row.payload).conversation_id).sort(),['c','c2']);
 await db.prepare("INSERT INTO conversation_buckets VALUES('new-empty','c',?,'{}')").bind(Date.now()+1000).run();
 await save('c',[{type:'PAGE_VIEW',localId:'shared',payload:'/shared'}]);
 const newBucket=await bucketData(env,conversation,'new-empty');
 assert.equal(newBucket.events.length,1,'new empty bucket supersedes older message frontier');
 assert.equal(newBucket.events[0].payload,'/shared','same client identity is also bucket scoped');
 await save('c',[{type:'PAGE_VIEW',localId:'shared',payload:{url:'/shared',bucket_id:'old'}}]);
 assert.equal((await bucketData(env,conversation,'new-empty')).events.length,1,'replays stay deduplicated');
 console.log('Tracked transcript: real D1 scope, payloads, actors, counts, bucket boundaries, grouping and trusted widget attribution passed.');
}finally{await proxy.dispose()}
