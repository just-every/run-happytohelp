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
 assert.equal((await h.raw(path+'&format=transcripts.json',{actor:'foreign'})).status,403);
 await h.db.prepare('UPDATE session_factors SET verified_at=? WHERE token_hash=?').bind(Date.now()-20*60*1000,h.tokenHash('owner')).run();
 const denied=await h.raw(path+'&format=transcripts.json'),failure=await denied.json();assert.equal(denied.status,403);assert.equal(failure.code,'step_up_required');assert.equal(failure.purpose,'reports.export');assert.ok(!JSON.stringify(failure).includes(privateText));
 await h.db.prepare('UPDATE session_factors SET verified_at=? WHERE token_hash=?').bind(Date.now(),h.tokenHash('owner')).run();
 assert.equal((await h.raw(path+'&format=transcripts.json')).status,200,'a recent proof permits the export');
 assert.equal(h.external,0);
}

export async function calendarReportsJourney(){
 const h=await harness();try{await seed(h);const response=await h.raw(path),report=await response.json();assert.equal(response.status,200);assert.equal(report.volume,6);assert.deepEqual(report.firstResponse,{count:4,median:4000,p90:7000});assert.deepEqual(report.firstResolution,{count:4,median:30000,p90:80000});assert.deepEqual(report.aiResolution,{count:1,total:4,rate:.25});assert.deepEqual(report.satisfaction,{positive:1,total:2,rate:.5});assert.deepEqual(report.daily.map(x=>[x.date,x.conversations]),[['2026-03-07',2],['2026-03-08',3],['2026-03-09',1]]);assert.deepEqual(report.comments.map(x=>x.conversationId),['b','a']);assert.equal(report.range.startAt,time('2026-03-07T05:00:00Z'));assert.equal(report.range.endAt,time('2026-03-10T04:00:00Z'));
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
 await h.call('/api/management/projects/p/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({timezone:'Asia/Kathmandu'})});
 for(const [id,at] of [['zone-before','2025-12-31T18:14:59Z'],['zone-first','2025-12-31T18:15:00Z'],['zone-last','2026-01-01T18:14:59Z'],['zone-after','2026-01-01T18:15:00Z']])await h.db.prepare('INSERT INTO conversations(id,project_id,contact_id,created_at,updated_at) VALUES(?,?,?,?,?)').bind(id,'p','visitor',time(at),time(at)).run();
 await seedQuestions(h);
 const calendar='/api/dashboard/projects/p/reports?period=custom&start=2026-01-01&end=2026-01-02';
 assert.equal((await h.call(calendar)).volume,2);
 const dayCSV=await(await h.raw(calendar+'&format=conversations.csv')).text();
 assert.match(dayCSV,/"zone-first"/);assert.match(dayCSV,/"zone-last"/);assert.doesNotMatch(dayCSV,/"zone-before"|"zone-after"/);
 for(const query of ['period=2','period=custom&start=2026-02-30&end=2026-03-02','period=custom&start=2026-03-02&end=2026-03-01'])assert.equal((await h.raw('/api/dashboard/projects/p/reports?'+query)).status,400);
 // Delete the other workspace, then reconstruct a prior-data membership. Neither
 // its retained link nor this live workspace session can recover private exports.
 await h.call('/api/management/projects/q',{actor:'foreign',method:'DELETE'});
 await h.db.prepare("INSERT INTO memberships VALUES('q','owner','owner')").run();
 for(const format of ['', '&format=summary.csv','&format=conversations.csv','&format=transcripts.json']){
  const denied=await h.raw('/api/dashboard/projects/q/reports?period=7'+format);
  assert.equal(denied.status,403);assert.doesNotMatch(await denied.text(),/foreign-visitor|"volume"/);
 }
 assert.equal((await h.raw('/api/dashboard/projects/p/reports?period=7')).status,200);

 }finally{await h.close()}
}
