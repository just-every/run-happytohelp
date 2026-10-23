import {phases} from '../journeys/kit/scenarios.mjs';
const test=phases(import.meta.url);
import assert from 'node:assert/strict';
import {harness} from './harness.mjs';
const time=Date.parse;
async function seedQuestions(h){await h.db.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at) SELECT 'question-'||c.id,c.project_id,c.id,'question-'||c.id,c.contact_id,'contact','Question',1,c.created_at FROM conversations c WHERE NOT EXISTS(SELECT 1 FROM messages m WHERE m.conversation_id=c.id)").run()}
async function seed(h){
 await h.contact();await h.contact('foreign-visitor','q');await h.db.prepare("INSERT INTO project_settings(project_id,settings_json,updated_at) VALUES('p','{\"timezone\":\"America/New_York\"}',1)").run();
 // Hand-computed samples: response 1,3,5,7s -> median4,p907;
 // resolution 10,20,40,80s -> median30,p9080. Four current resolutions,
 // one AI; two current ratings, one up. Reopened d retains duration only.
 const rows=[['a','2026-03-07T05:00:00Z',1,10,'ai',1,'Thanks'],['b','2026-03-07T12:00:00Z',3,20,'assisted',-1,'=IMPORT("bad")'],['c','2026-03-08T06:59:59Z',5,40,'human',null,null],['d','2026-03-08T07:00:00Z',7,80,'ai',1,'old cycle'],['e','2026-03-09T03:59:59Z',null,null,'unknown',null,null],['f','2026-03-10T03:59:59Z',null,null,null,null,null]];
 for(const [id,date,response,resolution,outcome,value,comment] of rows){const created=time(date),resolved=outcome&&id!=='d'?created+(resolution??90)*1000:null;
 await h.db.prepare('INSERT INTO conversations(id,project_id,contact_id,created_at,updated_at,resolved_at,revision) VALUES(?,?,?,?,?,?,2)').bind(id,'p','visitor',created,created,resolved).run();
 await h.db.prepare('INSERT INTO conversation_tracking(conversation_id,project_id,initial_history_complete,cycle_history_complete,cycle_start_at,first_resolved_at) VALUES(?,?,1,1,?,?)').bind(id,'p',created,resolution===null?null:created+resolution*1000).run();
 if(response!==null){await h.db.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at) VALUES(?,'p',?,?,'visitor','contact','Question',1,?),(?,'p',?,?,'owner','owner','Answer',2,?)").bind(id+'v',id,id+'v',created+100,id+'r',id,id+'r',created+100+response*1000).run()}
 if(outcome){await h.db.prepare("INSERT INTO conversation_resolutions(id,project_id,conversation_id,contact_id,ordinal,resolved_at,resolved_revision,cycle_start_revision,outcome,evidence_json,reopened_at) VALUES(?,'p',?,'visitor',1,?,2,0,?,'{}',?)").bind('r'+id,id,created+(resolution??90)*1000,outcome,id==='d'?created+100000:null).run();if(value!==null)await h.db.prepare('INSERT INTO conversation_ratings VALUES(?,?,?,?,1)').bind('r'+id,value,comment,created+200000).run()}
 }
 for(const [id,created,project] of [['before',time('2026-03-07T04:59:59Z'),'p'],['end',time('2026-03-10T04:00:00Z'),'p'],['foreign',time('2026-03-08T12:00:00Z'),'q'],['imported',time('2026-03-08T12:00:00Z'),'p'],['legacy',time('2026-03-08T12:00:00Z'),'p']])await h.db.prepare('INSERT INTO conversations(id,project_id,contact_id,created_at,updated_at) VALUES(?,?,?,?,?)').bind(id,project,project==='q'?'foreign-visitor':'visitor',created,created).run();
 await h.db.prepare("INSERT INTO move_in_conversations(conversation_id,project_id,vendor,source_id,subject,source_state,source_channel) VALUES('imported','p','intercom','i','Imported','closed','chat')").run();await h.db.prepare("INSERT INTO reporting_legacy_conversations VALUES('p','legacy','legacy-run')").run();await seedQuestions(h)
}
const path='/api/dashboard/projects/p/reports?period=custom&start=2026-03-07&end=2026-03-10';
test('workspace calendar cohort, distributions, latest-cycle rates, comments and complete safe CSV',async()=>{const h=await harness();try{await seed(h);const response=await h.raw(path),report=await response.json();assert.equal(response.status,200);assert.equal(report.volume,6);assert.deepEqual(report.firstResponse,{count:4,median:4000,p90:7000});assert.deepEqual(report.firstResolution,{count:4,median:30000,p90:80000});assert.deepEqual(report.aiResolution,{count:1,total:4,rate:.25});assert.deepEqual(report.satisfaction,{positive:1,total:2,rate:.5});assert.deepEqual(report.daily.map(x=>[x.date,x.conversations]),[['2026-03-07',2],['2026-03-08',3],['2026-03-09',1]]);assert.deepEqual(report.comments.map(x=>x.conversationId),['b','a']);assert.equal(report.range.startAt,time('2026-03-07T05:00:00Z'));assert.equal(report.range.endAt,time('2026-03-10T04:00:00Z'));
 const csv=await(await h.raw(path+'&format=conversations.csv')).text();assert.equal(csv.trim().split('\r\n').length,7);assert.match(csv,/"'=IMPORT\(""bad""\)"/);assert.doesNotMatch(csv,/imported|legacy|foreign/);assert.match(csv,/"d",.*"open","ai","up","old cycle"/);assert.match(csv,/First reply \(UTC\)/);const summary=await(await h.raw(path+'&format=summary.csv')).text();assert.match(summary,/"First response median seconds","4"/);assert.match(summary,/"AI resolution rate","0.25"/);assert.match(summary,/"Date","Conversations","Currently resolved"/);assert.match(summary,/"2026-03-07","2","2","1","2","1"/);assert.doesNotMatch(summary,/"ID","Created|Latest comment|IMPORT|Thanks|old cycle|2026-03-10T03:59:59/);
 assert.equal((await h.raw(path,{actor:'foreign'})).status,403);await h.db.prepare("INSERT INTO project_settings(project_id,settings_json,updated_at) VALUES('q','{}',1)").run();const other=await h.call('/api/dashboard/projects/q/reports?period=custom&start=2026-03-07&end=2026-03-10',{actor:'foreign'});assert.equal(other.volume,1);assert.equal(other.comments.length,0)
 const brandsPath='/api/management/projects/p/brands/reports?projects=p,q&period=custom&start=2026-03-07&end=2026-03-10';
 assert.equal((await h.raw(brandsPath)).status,403,'a brand owner cannot infer another brand’s report without membership');
 await h.db.prepare("INSERT INTO memberships VALUES('q','owner','operator')").run();
 const brands=await h.call(brandsPath);assert.equal(brands.data.brands.length,2);assert.equal(brands.data.aggregate.volume,7);
 assert.equal(brands.data.aggregate.resolved,4);assert.equal(brands.data.aggregate.aiResolutionRate,.25);assert.equal(brands.data.aggregate.satisfactionRate,.5);
 assert.deepEqual(brands.data.brands.map(b=>b.volume),[6,1]);assert.ok(brands.data.brands.every(b=>!('comments' in b)));
 assert.ok(!JSON.stringify(brands).includes('Thanks'));assert.ok(!JSON.stringify(brands).includes('IMPORT'));
 assert.equal((await h.raw(brandsPath.replace('p,q','p,unavailable'))).status,403);
 await h.db.prepare("DELETE FROM memberships WHERE project_id='q' AND user_id='owner'").run();assert.equal((await h.raw(brandsPath)).status,403,'revocation ends aggregate access immediately');
 await proveTranscriptExport(h);
 }finally{await h.close()}});
test('aggregate and summary stay bounded above 10,000 while conversation CSV includes every row',async()=>{
 const h=await harness();try{
  await h.contact();
  const path='/api/dashboard/projects/p/reports?period=custom&start=2026-04-01&end=2026-04-02';
  const empty=await h.raw(path+'&format=summary.csv');assert.equal(empty.status,200);await empty.text();
  await h.db.prepare("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<10001) INSERT INTO conversations(id,project_id,contact_id,created_at,updated_at) SELECT printf('bulk-%05d',i),'p','visitor',1775001600000,1775001600000 FROM n").run();await seedQuestions(h);
  const response=await h.raw(path),report=await response.json();assert.equal(response.status,200);assert.equal(report.volume,10001);
  const detail=await h.raw(path+'&format=conversations.csv'),csv=await detail.text();
  assert.equal((csv.match(/"bulk-\d{5}"/g)||[]).length,10001);assert.match(csv,/"bulk-10001"/);
  assert.ok(Number(detail.headers.get('X-Test-Statements'))>=21,'audit includes every consumed keyset page');
  assert.ok(Number(detail.headers.get('X-Test-Max-Rows'))<=500,'conversation pages remain bounded');
  const historyResponse=await h.raw(path+'&format=transcripts.json'),history=await historyResponse.json();
  assert.equal(historyResponse.status,200);assert.equal(history.conversations.length,10001,'complete history exports every conversation beyond 10,000');
  assert.equal(history.conversations.find(row=>row.id==='bulk-10001').messages.length,1);
  assert.ok(Number(historyResponse.headers.get('X-Test-Max-Rows'))<=100,'large workspace history keeps every collection bounded');
  assert.ok(Number(historyResponse.headers.get('X-Test-Statements'))<250,'history export pages globally rather than querying each conversation');
  const result=await h.raw(path+'&format=summary.csv'),summary=await result.text();
  assert.equal(result.status,200);assert.match(summary,/"Conversations","10001"/);assert.match(summary,/"2026-04-01","10001","0","0","0","0"/);
  assert.doesNotMatch(summary,/bulk-|"ID","Created|Latest comment/);
  assert.equal(result.headers.get('X-Test-Statements'),empty.headers.get('X-Test-Statements'),'summary query count independent of cohort');
  assert.ok(Number(result.headers.get('X-Test-Statements'))<=5);assert.equal(result.headers.get('X-Test-Max-Rows'),'1');
  assert.equal(h.external,0);
 }finally{await h.close()}
});

test('summary CSV is only the independent six-conversation oracle and stays constant-query as the cohort grows',async()=>{
 const h=await harness();try{
  await seed(h);
  const first=await h.raw(path+'&format=summary.csv'),summary=await first.text();
  assert.equal(first.status,200);
  const expected=[
   '"Metric","Value"',
   '"Timezone","America/New_York"',
   '"Created on or after","2026-03-07"',
   '"Created before","2026-03-10"',
   '"Conversations","6"',
   '"First response sample","4"',
   '"First response median seconds","4"',
   '"First response p90 seconds","7"',
   '"First resolution sample","4"',
   '"First resolution median seconds","30"',
   '"First resolution p90 seconds","80"',
   '"Currently resolved","4"',
   '"AI resolutions","1"',
   '"AI resolution rate","0.25"',
   '"Rated resolutions","2"',
   '"Thumbs up","1"',
   '"Satisfaction rate","0.5"',
   '',
   '"Date","Conversations","Currently resolved","AI resolutions","Rated","Thumbs up"',
   '"2026-03-07","2","2","1","2","1"',
   '"2026-03-08","3","2","0","0","0"',
   '"2026-03-09","1","0","0","0","0"',
  ].join('\r\n')+'\r\n';
  assert.equal(summary,expected,'exact hand-calculated summary, with no detail header, IDs or comments');
  await h.db.prepare("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<10001) INSERT INTO conversations(id,project_id,contact_id,created_at,updated_at) SELECT printf('summary-bulk-%05d',i),'p','visitor',1772884800000,1772884800000 FROM n").run();await seedQuestions(h);
  const larger=await h.raw(path+'&format=summary.csv'),expanded=await larger.text();
  assert.equal(expanded,expected.replace('"Conversations","6"','"Conversations","10007"').replace('"2026-03-07","2","2"','"2026-03-07","10003","2"'));
  assert.equal(larger.headers.get('X-Test-Statements'),first.headers.get('X-Test-Statements'));
  assert.ok(Number(larger.headers.get('X-Test-Statements'))<=5);assert.equal(larger.headers.get('X-Test-Max-Rows'),'1');assert.equal(h.external,0);
 }finally{await h.close()}
});

test('Reports and both CSVs refuse a deleted target with retained membership and a live other-workspace session',async()=>{
 const h=await harness();try{
  // Prior-data/recovery can retain a membership even when a workspace is marked
  // deleted. Session owner belongs to p, so target q must be checked separately.
  await h.db.prepare("INSERT INTO memberships VALUES('q','owner','owner')").run();
  await h.contact('target-contact','q');
  await h.db.prepare("INSERT INTO conversations(id,project_id,contact_id,created_at,updated_at) VALUES('target-private-conversation','q','target-contact',1775001600000,1775001600000)").run();await seedQuestions(h);
  const target='/api/dashboard/projects/q/reports?period=custom&start=2026-04-01&end=2026-04-02';
  const suffixes=['','&format=summary.csv','&format=conversations.csv','&format=transcripts.json'];
  for(const suffix of suffixes){const response=await h.raw(target+suffix);assert.equal(response.status,200,'live target is accessible through the other-workspace session');const body=await response.text();if(!suffix)assert.equal(JSON.parse(body).volume,1);else if(suffix.includes('conversations')||suffix.includes('transcripts'))assert.match(body,/target-private-conversation/);else assert.match(body,/"Conversations","1"/)}
  await h.db.prepare("INSERT INTO project_settings(project_id,settings_json,updated_at) VALUES('q','{\"deleted_at\":1775001600001}',1)").run();
  for(const suffix of suffixes){const denied=await h.raw(target+suffix);assert.equal(denied.status,403);const body=await denied.text();assert.doesNotMatch(body,/target-private-conversation|target-contact|"volume"|"Conversations","1"/)}
  assert.equal((await h.raw('/api/dashboard/projects/p/reports?period=custom&start=2026-04-01&end=2026-04-02')).status,200,'the originating session remains live');
  assert.equal((await h.db.prepare("SELECT count(*) n FROM memberships WHERE project_id='q' AND user_id='owner'").first()).n,1,'refusal does not mutate retained membership');
  assert.equal((await h.db.prepare("SELECT count(*) n FROM conversations WHERE id='target-private-conversation'").first()).n,1,'denied reads do not mutate target data');
  assert.equal(h.external,0);
 }finally{await h.close()}
});

test('native delete retires invitations and neither existing nor new invitees can resurrect the workspace',async()=>{
 const h=await harness();try{
  const invite=async email=>{const response=await h.raw('/api/management/projects/q/agents',{actor:'foreign',method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})});assert.equal(response.status,201);return new URL((await response.json()).data.invitationUrl).searchParams.get('token')};
  const existing=await invite('owner@example.test'),fresh=await invite('new-person@example.test');
  const accepted=await h.raw('/api/identity/accept-invitation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:existing})});assert.equal(accepted.status,200,'active workspace invitation succeeds');
  await h.db.prepare("DELETE FROM memberships WHERE project_id='q' AND user_id='owner'").run();
  const waiting=await invite('owner@example.test');
  const deleted=await h.raw('/api/management/projects/q',{actor:'foreign',method:'DELETE'});assert.equal(deleted.status,200);
  assert.equal((await h.db.prepare("SELECT count(*) n FROM identity_tokens WHERE project_id='q' AND kind='invite' AND consumed_at IS NULL").first()).n,0,'all pending links retired in deletion batch');
  const denied=await h.raw('/api/identity/accept-invitation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:waiting})});assert.equal(denied.status,400);
  const newDenied=await h.raw('/api/identity/accept-token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:fresh,name:'New Person',password:'a-long-test-only-password'})});assert.ok([400,409].includes(newDenied.status));
  assert.equal((await h.db.prepare("SELECT count(*) n FROM memberships WHERE project_id='q'").first()).n,0);
  assert.equal((await h.db.prepare("SELECT count(*) n FROM users WHERE email='new-person@example.test'").first()).n,0);
  for(const format of ['', '&format=conversations.csv','&format=summary.csv','&format=transcripts.json'])assert.equal((await h.raw('/api/dashboard/projects/q/reports?period=custom&start=2026-04-01&end=2026-04-02'+format)).status,403);
  // Reconstituted prior-data links must also fail independently of retirement.
  await h.db.prepare("UPDATE identity_tokens SET consumed_at=NULL WHERE project_id='q' AND kind='invite'").run();
  assert.equal((await h.raw('/api/identity/accept-invitation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:waiting})})).status,400);
  const previous=await h.db.prepare('SELECT count(*) n FROM users').first();
  assert.equal((await h.raw('/api/identity/accept-token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:fresh,name:'New Person',password:'a-long-test-only-password'})})).status,409);
  assert.deepEqual(await h.db.prepare('SELECT count(*) n FROM users').first(),previous);
  assert.equal((await h.db.prepare("SELECT count(*) n FROM memberships WHERE project_id='q'").first()).n,0);
  assert.equal(h.external,0);
 }finally{await h.close()}
});

test('invitation acceptance rechecks target and signed-in session at the native write boundary',async()=>{
 for(const race of ['target-deleted','session-revoked','membership-removed','new-account-target-deleted']){
  const h=await harness();try{
   const email=race.startsWith('new-account')?'race-new@example.test':'owner@example.test';
   const response=await h.raw('/api/management/projects/q/agents',{actor:'foreign',method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})});assert.equal(response.status,201);const token=new URL((await response.json()).data.invitationUrl).searchParams.get('token');
   const sql=race.includes('target-deleted')?"INSERT INTO project_settings VALUES('q','{\"deleted_at\":1}',1)":race==='session-revoked'?"UPDATE sessions SET revoked_at=1 WHERE actor_id='owner'":"DELETE FROM memberships WHERE project_id='p' AND user_id='owner'";
   const result=await h.raw('/_test/invitation-race',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sql,newAccount:race.startsWith('new-account'),command:{token,name:'Race New',password:'synthetic-long-native-test-password'}})});
   assert.equal(result.status,race.startsWith('new-account')?409:400,race);
   assert.equal((await h.db.prepare("SELECT count(*) n FROM memberships WHERE project_id='q' AND user_id='owner'").first()).n,0,race);
   assert.equal((await h.db.prepare("SELECT count(*) n FROM users WHERE email='race-new@example.test'").first()).n,0,race);
   assert.equal((await h.db.prepare("SELECT count(*) n FROM identity_tokens WHERE project_id='q' AND consumed_at IS NOT NULL").first()).n,0,'refused race does not spend its invitation');
   assert.equal(h.external,0)
  }finally{await h.close()}
 }
});

test('calendar days follow the workspace zone through the report route, including non-hour offsets, and malformed ranges are refused',async()=>{const h=await harness();try{
 await h.contact();await h.db.prepare("INSERT INTO project_settings(project_id,settings_json,updated_at) VALUES('p','{\"timezone\":\"Asia/Kathmandu\"}',1)").run()
 // Kathmandu is UTC+05:45, so 2026-01-01 begins at 2025-12-31T18:15:00Z.
 for(const [id,at] of [['before','2025-12-31T18:14:59Z'],['first','2025-12-31T18:15:00Z'],['last','2026-01-01T18:14:59Z'],['after','2026-01-01T18:15:00Z']])await h.db.prepare('INSERT INTO conversations(id,project_id,contact_id,created_at,updated_at) VALUES(?,?,?,?,?)').bind(id,'p','visitor',time(at),time(at)).run();await seedQuestions(h)
 const day=await h.call('/api/dashboard/projects/p/reports?period=custom&start=2026-01-01&end=2026-01-02');assert.equal(day.volume,2,'exactly the two conversations inside the Kathmandu calendar day')
 const csv=await(await h.raw('/api/dashboard/projects/p/reports?period=custom&start=2026-01-01&end=2026-01-02&format=conversations.csv')).text();assert.match(csv,/"first"/);assert.match(csv,/"last"/);assert.doesNotMatch(csv,/"before"|"after"/)
 for(const query of ['period=2','period=custom&start=2026-02-30&end=2026-03-02','period=custom&start=2026-03-02&end=2026-03-01'])assert.equal((await h.raw('/api/dashboard/projects/p/reports?'+query)).status,400,query)
}finally{await h.close()}});

async function proveTranscriptExport(h){
 const empty=await h.conversation();
 await h.db.prepare('UPDATE conversations SET created_at=? WHERE id=?').bind(time('2026-03-08T12:00:00Z'),empty.id).run();
 assert.equal((await h.call(path)).volume,6,'opening an empty conversation does not inflate Reports');
 const analyticalCSV=await(await h.raw(path+'&format=conversations.csv')).text();assert.ok(!analyticalCSV.includes(empty.id),'message-free conversations stay outside the Reports CSV');
 const conversation=await h.conversation();
 const upload=await h.call('/api/conversations/'+conversation.id+'/media',{method:'POST',headers:{'Content-Type':'text/plain','X-Filename':'customer invoice.txt'},body:'Invoice attachment'});
 const content='Full conversation export: visitor-safe answer';
 const reply=await h.call('/api/conversations/'+conversation.id+'/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content,localId:'export-reply',expectedRevision:0,mediaIds:[upload.id],authoring:{kind:'human'}})});
 assert.equal(reply.accepted,true);
 const privateText='Private account review: keep this note';
 await h.call('/api/dashboard/projects/p/conversations/'+conversation.id+'/notes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content:privateText})});
 await h.db.prepare("INSERT INTO move_in_notes(id,project_id,conversation_id,author_json,content,created_at,source_time) VALUES('imported-private-note','p','imported','{\"name\":\"Prior teammate\"}','Imported private handoff',1,'2026-03-08T12:00:00Z')").run();
 // More than one message page in one conversation, with the actual public message door.
 for(let index=0;index<101;index++)await h.send(conversation.id,'Transcript page message '+index);
 const response=await h.raw(path+'&format=transcripts.json'),exported=await response.json();
 assert.equal(response.status,200);assert.match(response.headers.get('Content-Type'),/application\/json/);assert.equal(response.headers.get('Cache-Control'),'no-store');
 assert.equal(exported.projectId,'p');assert.equal(exported.conversations.length,12);
 const thread=exported.conversations.find(row=>row.id===conversation.id);
 assert.equal(thread.messages.length,102);assert.equal(thread.messages.find(message=>message.localId==='export-reply').content,content);
 assert.deepEqual(thread.messages.map(message=>message.revision),Array.from({length:102},(_,index)=>index+1),'export keeps transcript order across pages');
 assert.ok(thread.messages.some(message=>message.content==='Transcript page message 100'),'long threads export beyond their first page');
 assert.ok(thread.privateNotes.some(note=>note.content===privateText&&note.source==='native'));
 assert.ok(thread.attachments.some(file=>file.filename==='customer invoice.txt'&&file.messageId===reply.message.id));
 assert.deepEqual(exported.conversations.find(row=>row.id===empty.id).messages,[],'complete export retains empty drafts even though Reports excludes them');
 assert.ok(exported.conversations.some(row=>row.id==='legacy'),'legacy history is portable');
 assert.ok(exported.conversations.find(row=>row.id==='imported').privateNotes.some(note=>note.content==='Imported private handoff'&&note.source==='imported'));
 assert.ok(exported.conversations.some(row=>row.id==='before')&&exported.conversations.some(row=>row.id==='end'),'workspace export includes dates outside the analytics range');
 assert.ok(!exported.conversations.some(row=>row.id==='foreign'),'foreign workspace history never enters the export');
 assert.ok(Number(response.headers.get('X-Test-Max-Rows'))<=100,'every transcript collection is paged');
 assert.equal((await h.raw(path+'&format=transcripts.json',{actor:'foreign'})).status,403);
 await h.db.prepare('UPDATE session_factors SET verified_at=? WHERE token_hash=?').bind(Date.now()-20*60*1000,h.tokenHash('owner')).run();
 const denied=await h.raw(path+'&format=transcripts.json'),failure=await denied.json();assert.equal(denied.status,403);assert.equal(failure.code,'step_up_required');assert.equal(failure.purpose,'reports.export');assert.ok(!JSON.stringify(failure).includes(privateText));
 await h.db.prepare('UPDATE session_factors SET verified_at=? WHERE token_hash=?').bind(Date.now(),h.tokenHash('owner')).run();
 assert.equal((await h.raw(path+'&format=transcripts.json')).status,200,'a recent proof permits the export');
 assert.equal(h.external,0);
}
