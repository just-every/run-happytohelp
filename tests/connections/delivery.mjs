import {runSteps} from '../journeys/kit/steps.mjs';
import {phases} from '../journeys/kit/scenarios.mjs';const test=phases(import.meta.url);import assert from 'node:assert/strict';import {createHmac,randomBytes} from 'node:crypto';
import {harness,body} from './harness.mjs';
import {assertResendPreparationRaces} from './resend-races.mjs';
const root='/api/management/projects/p/connections';const events=['conversation.created','message.created','conversation.resolved','conversation.rated'];
const webhook=(h,path='/all',project='p')=>h.call(`/api/management/projects/${project}/connections/webhooks`,{actor:project==='p'?'owner':'foreign',...body({name:'Receiver',url:'https://receiver.example.com'+path,events})});

function verifyIndependent(receipt,key,{tenant,destination,event,id},now=Date.now()){
 const h=receipt.headers,timestamp=h['webhook-timestamp'];if(h['webhook-tenant']!==tenant||h['webhook-destination']!==destination||h['webhook-event']!==event||h['webhook-id']!==id||!/^\d+$/.test(timestamp)||Math.abs(now-Number(timestamp)*1000)>300000)return false;
 const digest=createHmac('sha256',Buffer.from(key,'hex')).update(JSON.stringify(['integrations.webhook.v1',tenant,destination,event,id,timestamp,receipt.body.toString('utf8')])).digest('hex');return h['webhook-signature']==='v1='+digest
}

test("delivery lifecycle: prepare, sign, dispatch, recover bounded work and require fresh approval for uncertain resend",()=>runSteps([
  ['bounded scheduling bypasses historical workspaces and empty Slack conversations without starving ready work',async()=>{
 const h=await harness();try{
  // Durable completed history must not consume the global page forever.
  const statements=[];for(let i=0;i<101;i++){const p='history-'+String(i).padStart(3,'0'),d='dest-'+p,e='event-'+p;statements.push(h.db.prepare('INSERT INTO projects(id,name,widget_key,allowed_origin,created_at) VALUES(?,?,?,?,1)').bind(p,p,p,'https://app.example'),h.db.prepare("INSERT INTO native_integration_destinations(id,project_id,kind,name,mode,events_json,secret_ciphertext,enabled,created_at) VALUES(?,?,'webhook','Past',NULL,'[]','unused-completed-fixture',1,1)").bind(d,p),h.db.prepare("INSERT INTO native_integration_events VALUES(?,?,NULL,NULL,'integration.test','{}',1,NULL)").bind(e,p),h.db.prepare('INSERT INTO native_integration_intents VALUES(?,?,?,?,1,NULL)').bind('intent-'+p,p,e,d))}await h.db.batch(statements);
  await h.call(root+'/slack',body({name:'Ready Slack',mode:'incoming-webhook',url:'https://hooks.slack.com/services/T123/B123/synthetic'}));await h.contact();
  for(let i=0;i<100;i++)await h.call('/api/conversations',body({projectId:'p',contactId:'visitor'}));const ready=await h.conversation();await h.call('/api/conversations/'+ready.id+'/messages',{actor:'visitor',...body({localId:'ready-human',content:'Ready after one hundred empty conversations',expectedRevision:0})});
  h.responses.push({status:200,body:'ok'});await h.call('/_test/scheduled',body({}));assert.equal(h.received.length,1);assert.ok(h.received[0].body.toString().includes('Ready after one hundred empty conversations'));assert.equal((await h.db.prepare("SELECT count(*) n FROM native_integration_intents WHERE project_id='p' AND prepared_at IS NULL").first()).n,100);
  await h.restart();await h.call('/_test/scheduled',body({}));assert.equal(h.received.length,1,'completed and empty work is not reposted');
 }finally{await h.close()}
}],
  ['all four native events persist, sign exact bytes, stay tenant scoped and dispatch once after repeated scheduler runs',async()=>{
 const h=await harness();try{
  const a=await webhook(h),b=await webhook(h,'/foreign','q');await h.contact();await h.contact('other','q');const conversation=await h.conversation(),foreign=await h.conversation('other','q');const {token}=await h.issue();
  await h.call('/api/v1/conversations/'+conversation.id+'/messages',{token,...body({content:'API reply',localId:'reply',expectedRevision:0})});await h.call('/api/v1/conversations/'+conversation.id+'/resolve',{token,...body({})});
  const resolution=await h.db.prepare('SELECT id FROM conversation_resolutions WHERE conversation_id=?').bind(conversation.id).first();await h.call('/api/conversations/'+conversation.id+'/widget-events',{actor:'visitor',...body({action:'rateResolution',data:{resolutionId:resolution.id,value:1,comment:'Private feedback'}})});
  await h.dispatch();assert.equal(h.received.length,4);for(const receipt of h.received){const payload=JSON.parse(receipt.body),event=payload.event;assert.ok(events.includes(event));assert.ok(verifyIndependent(receipt,a.secret,{tenant:'p',destination:a.id,event,id:payload.id}));assert.equal(verifyIndependent(receipt,randomBytes(32).toString('hex'),{tenant:'p',destination:a.id,event,id:payload.id}),false);assert.equal(verifyIndependent({...receipt,body:Buffer.from(receipt.body+'!')},a.secret,{tenant:'p',destination:a.id,event,id:payload.id}),false);assert.equal(verifyIndependent(receipt,a.secret,{tenant:'p',destination:a.id,event,id:payload.id},Date.now()+600000),false);assert.ok(!receipt.body.toString().includes('Private feedback'));assert.equal(payload.data.conversation_id,conversation.id)}
  assert.deepEqual(h.received.map(x=>JSON.parse(x.body).event).sort(),events.slice().sort());await h.dispatch();assert.equal(h.received.length,4);await h.dispatch('q');assert.equal(h.received.length,5);assert.equal(h.received[4].headers['webhook-tenant'],'q');assert.equal(h.received[4].headers['webhook-destination'],b.id);assert.equal(JSON.parse(h.received[4].body).data.conversation_id,foreign.id);
  const logs=await h.call(root+'/deliveries');assert.equal(logs.data.length,4);assert.ok(logs.data.every(x=>x.state==='accepted'&&x.status===204&&x.duration_ms>=0));assert.ok(!JSON.stringify(logs).includes(a.secret));assert.ok(!JSON.stringify(await h.call(root+'/webhooks')).includes(a.secret));
 }finally{await h.close()}
}],
  ['response timeout remains uncertain across dispatch and Worker restart',async()=>{
 const h=await harness();try{
  const a=await webhook(h);h.responses.push({status:204,delay:11000});
  const job=await h.call(root+'/webhooks/'+a.id+'/test',body({})),sent=h.received.length;
  await h.dispatch();await h.restart();await h.dispatch();assert.equal(h.received.length,sent);
  const row=(await h.call(root+'/deliveries')).data.find(x=>x.id===job.id);assert.equal(row.state,'uncertain');assert.equal(row.status,null);assert.equal(row.error_class,'response_unknown');
 }finally{await h.close()}
}],
  ['all server errors and after-send timeout remain uncertain without replay while rate limits retry exact signed delivery within the bounded policy',async()=>{
 const h=await harness();try{
  const a=await webhook(h),uncertain=[];
  // Exercise the management action and actual receiver for the entire 5xx
  // range, including status codes with no standard name.
  for(let status=500;status<600;status++){
   h.responses.push({status,body:'PRIVATE_PROVIDER_CANARY',headers:{'Retry-After':'0'}});
   const job=await h.call(root+'/webhooks/'+a.id+'/test',body({}));uncertain.push({id:job.id,status,error:'webhook_response_uncertain'});
   const row=(await h.call(root+'/deliveries')).data.find(row=>row.id===job.id);
   assert.equal(row.state,'uncertain',`HTTP ${status} must not schedule a replay`);assert.equal(row.status,status);
  }
  h.responses.push({status:204,delay:11000});const timedOut=await h.call(root+'/webhooks/'+a.id+'/test',body({}));
  uncertain.push({id:timedOut.id,status:null,error:'response_unknown'});
  assert.equal(h.received.length,uncertain.length,'each uncertain result follows one received request');
  for(const receipt of h.received)assert.ok(verifyIndependent(receipt,a.secret,{tenant:'p',destination:a.id,event:'integration.test',id:JSON.parse(receipt.body).id}));
  async function assertUncertain(){
   const logs=await h.call(root+'/deliveries');assert.ok(!JSON.stringify(logs).includes('PRIVATE_PROVIDER_CANARY'));
   for(const expected of uncertain){
    const rows=logs.data.filter(row=>row.id===expected.id);assert.equal(rows.length,1);
    assert.equal(rows[0].state,'uncertain');assert.equal(rows[0].status,expected.status);assert.equal(rows[0].error_class,expected.error);
   }
   assert.equal(h.received.length,uncertain.length,'uncertain delivery never resumes sending');
  }
  await assertUncertain();await h.dispatch();await h.call('/_test/scheduled',body({}));await assertUncertain();
  await h.restart();await h.dispatch();await h.call('/_test/scheduled',body({}));await assertUncertain();

  const sentBeforeRetry=h.received.length;
  h.responses.push({status:429,body:'PRIVATE_PROVIDER_CANARY',headers:{'Retry-After':'0'}},{status:204});
  const job=await h.call(root+'/webhooks/'+a.id+'/test',body({}));assert.equal(h.received.length,sentBeforeRetry+1);
  const scheduled=await h.db.prepare("SELECT next_at FROM integration_deliveries WHERE id=? AND state='queued'").bind(job.id).first();assert.ok(scheduled.next_at>Date.now()-1000);
  assert.ok(!JSON.stringify(await h.call(root+'/deliveries')).includes('PRIVATE_PROVIDER_CANARY'));
  await h.restart();await new Promise(resolve=>setTimeout(resolve,Math.max(0,scheduled.next_at-Date.now())+25));await h.call('/_test/scheduled',body({}));assert.equal(h.received.length,sentBeforeRetry+2);
  const retries=h.received.slice(sentBeforeRetry);assert.ok(retries[0].body.equals(retries[1].body));assert.equal(retries[0].headers['webhook-id'],retries[1].headers['webhook-id']);
  for(const receipt of retries)assert.ok(verifyIndependent(receipt,a.secret,{tenant:'p',destination:a.id,event:'integration.test',id:job.id}));
  assert.equal((await h.call(root+'/deliveries')).data.find(row=>row.id===job.id).state,'accepted');
  const sentBeforeFailure=h.received.length;
  h.responses.push(...Array.from({length:40},()=>({status:429})));const failed=await h.call(root+'/webhooks/'+a.id+'/test',body({}));
  let row;
  for(let i=0;i<40;i++){
   row=await h.db.prepare('SELECT state,attempts,max_attempts FROM integration_deliveries WHERE id=?').bind(failed.id).first();
   if(row.state==='rejected')break;
   await h.db.prepare("UPDATE integration_deliveries SET next_at=0 WHERE id=? AND state='queued'").bind(failed.id).run();await h.dispatch();
  }
  assert.equal(row.state,'rejected');assert.equal(row.attempts,row.max_attempts);assert.equal(row.attempts,h.received.length-sentBeforeFailure);
  const terminalReceipts=h.received.length;await h.restart();await h.dispatch();await h.call('/_test/scheduled',body({}));assert.equal(h.received.length,terminalReceipts,'terminal failure never resumes sending');assert.equal(h.external,0);
  console.log(JSON.stringify({proof:'webhook-uncertain-and-bounded-retry',serverStatuses:uncertain.length-1,afterSendTimeouts:1,uncertainReceipts:uncertain.length,rateLimitSuccessReceipts:retries.length,rateLimitExhaustedReceipts:row.attempts,externalRequests:h.external}));
 }finally{await h.close()}
}],
  ['destination policy, disabled configuration and contact erasure refuse pending work without leaking secrets',async()=>{
 const h=await harness();try{
  for(const url of ['https://receiver.example.test','http://receiver.example.com','https://127.0.0.1','https://169.254.169.254/latest','https://user:secret@example.com','https://example.com:444/path','https://[::1]/'])assert.equal((await h.raw(root+'/webhooks',body({name:'Unsafe',url,events}))).status,400);
  const a=await webhook(h);await h.contact();await h.conversation();await h.call(root+'/webhooks/'+a.id,{method:'DELETE'});await h.dispatch();assert.equal(h.received.length,0);assert.equal((await h.call(root+'/deliveries')).data[0].error_class,'configuration_unavailable');
  const next=await webhook(h,'/erasure');const conv=await h.conversation();const before=(await h.db.prepare('SELECT count(*) n FROM native_integration_intents').first()).n;assert.ok(before>=2);
  // Native erasure fence is the first privacy linearization point, including
  // queued integrations even if object deletion is subsequently interrupted.
  await h.db.prepare("UPDATE contacts SET metadata_json=json_set(metadata_json,'$.is_erasing',1) WHERE id='visitor'").run();await h.dispatch();assert.equal(h.received.length,0);const rows=(await h.db.prepare("SELECT body,conversation_id,contact_id,erased_at FROM native_integration_events WHERE project_id='p'").all()).results;assert.ok(rows.every(x=>x.body==='{}'&&x.conversation_id===null&&x.contact_id===null&&x.erased_at!==null));assert.equal((await h.db.prepare('SELECT count(*) n FROM integration_deliveries').first()).n,0);const api=await h.issue(['contacts:write']);assert.equal((await h.raw('/api/v1/contacts/visitor',{token:api.token,method:'PUT',headers:{'Content-Type':'application/json'},body:'{"name":"Cannot restore"}'})).status,409);
  const ciphertext=await h.db.prepare('SELECT secret_ciphertext FROM native_integration_destinations WHERE id=?').bind(next.id).first();assert.ok(!ciphertext.secret_ciphertext.includes(next.secret));
 }finally{await h.close()}
}],
  ['erasure during protocol preparation cannot recreate a retained delivery payload',async()=>{
 const h=await harness();try{
  await webhook(h);await h.contact();await h.conversation();
  await h.call('/_test/dispatch-race',body({match:'INSERT INTO integration_deliveries',race:[{sql:"UPDATE contacts SET metadata_json=json_set(metadata_json,'$.is_erasing',1) WHERE id='visitor'"}]}));
  assert.equal(h.received.length,0);assert.equal((await h.db.prepare('SELECT count(*) n FROM integration_deliveries').first()).n,0);
  assert.ok((await h.db.prepare('SELECT body,erased_at FROM native_integration_events').all()).results.every(row=>row.body==='{}'&&row.erased_at!==null));
  await h.dispatch();assert.equal(h.received.length,0);
 }finally{await h.close()}
}],
  ['native automatic inbound mail is inert while human inbound mail emits created and message once',async()=>{
 const h=await harness();try{
  await webhook(h);await h.call(root+'/slack',body({name:'Inbound Slack',mode:'incoming-webhook',url:'https://hooks.slack.com/services/T123/B123/inbound-fixture'}));
  await h.db.prepare("INSERT INTO email_settings VALUES('p','Support','help@example.test','support@reply.example.test',1,1)").run();
  const automatic={messageId:'automatic@example.test',to:'support@reply.example.test',from:'robot@example.test',text:'Out of office',headers:{'Auto-Submitted':'auto-replied'}};
  await h.inbound(automatic);await h.inbound(automatic);await h.call('/_test/scheduled',body({}));assert.equal(h.received.length,0);assert.equal((await h.db.prepare('SELECT count(*) n FROM native_integration_events').first()).n,0);
  const human={messageId:'human@example.test',to:'support@reply.example.test',from:'person@example.test',text:'Please help <!channel> & me'};const result=await h.inbound(human);await h.inbound(human);
  h.responses.push({status:200,body:'ok'},{status:200,body:'ok'},{status:200,body:'ok'});await h.call('/_test/scheduled',body({}));assert.equal(h.received.length,3);
  const webhooks=h.received.filter(r=>r.headers['webhook-event']);assert.deepEqual(webhooks.map(r=>r.headers['webhook-event']).sort(),['conversation.created','message.created']);assert.ok(webhooks.every(r=>JSON.parse(r.body).data.conversation_id===result.conversationId));
  const slack=h.received.find(r=>!r.headers['webhook-event']);assert.equal(JSON.parse(slack.body).blocks[0].text.text,'Please help &lt;!channel&gt; &amp; me');await h.restart();await h.call('/_test/scheduled',body({}));assert.equal(h.received.length,3);assert.equal(h.external,0);
 }finally{await h.close()}
}],
  ['storage failure before durable enqueue stays retryable as preparation work and is never labelled configuration failure',async()=>{
 const h=await harness();try{
  await webhook(h);await h.contact();await h.conversation();
  await h.db.prepare("CREATE TRIGGER test_storage_failure BEFORE INSERT ON integration_deliveries BEGIN SELECT RAISE(ABORT,'test_storage_failure'); END").run();
  const response=await h.raw('/_test/dispatch',body({projectId:'p'}));assert.equal(response.status,500);assert.equal(h.received.length,0);const pending=(await h.db.prepare('SELECT prepared_at,error_code FROM native_integration_intents').all()).results;assert.ok(pending.every(r=>r.prepared_at===null&&r.error_code===null));
  await h.db.prepare('DROP TRIGGER test_storage_failure').run();await h.dispatch();assert.equal(h.received.length,1);assert.equal((await h.db.prepare('SELECT state FROM integration_deliveries').first()).state,'accepted');
 }finally{await h.close()}
}],
  ['real receiver accepts the correct signature and rejects a changed expected secret with visible401',async()=>{
 const h=await harness();try{
  const a=await webhook(h);let expected=a.secret;h.setReceiverVerifier(receipt=>{const event=JSON.parse(receipt.body);return verifyIndependent(receipt,expected,{tenant:'p',destination:a.id,event:event.event,id:event.id})});
  await h.call(root+'/webhooks/'+a.id+'/test',body({}));assert.equal((await h.call(root+'/deliveries')).data[0].status,204);
  expected=randomBytes(32).toString('hex');const refused=await h.call(root+'/webhooks/'+a.id+'/test',body({}));const entry=(await h.call(root+'/deliveries')).data.find(row=>row.id===refused.id);assert.equal(entry.status,401);assert.equal(entry.state,'rejected');assert.equal(h.received.length,2);await h.dispatch();assert.equal(h.received.length,2);
 }finally{await h.close()}
}],
  ['queued delivery refuses configuration version drift before sending to a changed URL',async()=>{
 const h=await harness();try{
  const a=await webhook(h,'/original');h.responses.push({status:429});const job=await h.call(root+'/webhooks/'+a.id+'/test',body({}));assert.equal(h.received.length,1);
  const b=await webhook(h,'/changed');await h.db.prepare('UPDATE native_integration_destinations SET secret_ciphertext=(SELECT secret_ciphertext FROM native_integration_destinations WHERE id=?) WHERE id=?').bind(b.id,a.id).run();await h.db.prepare('UPDATE integration_deliveries SET next_at=0 WHERE id=?').bind(job.id).run();await h.dispatch();assert.equal(h.received.length,1);const row=(await h.call(root+'/deliveries')).data.find(row=>row.id===job.id&&row.number===2);assert.equal(row.state,'rejected');assert.equal(row.error_class,'preflight_failed');
 }finally{await h.close()}
}],
  ['one cron invocation bounds all ready workspaces together and resumes every native delivery',async()=>{
 const h=await harness();try{
  for(const [project,actor,contact] of [['p','owner','visitor'],['q','foreign','other']]){
   await h.call(`/api/management/projects/${project}/connections/webhooks`,{actor,...body({name:'Budget receiver',url:'https://receiver.example.com/'+project,events:['conversation.created']})});await h.contact(contact,project);
   for(let i=0;i<24;i++)await h.call('/api/conversations',{actor,...body({projectId:project,contactId:contact})});
  }
  const metrics=[];for(let turn=0;turn<24&&h.received.length<48;turn++){
   const before=h.received.length,result=await h.call('/_test/scheduled-metered',body({}));metrics.push(result);
   assert.ok(h.received.length>before,'ready work progresses');assert.ok(h.received.length-before<=8,'one entire cron sends at most eight deliveries');assert.ok(result.statements<=400,'integrations leave most of the one-thousand-statement invocation budget for existing jobs');
   if(turn===0){assert.ok(h.received.length<48,'backlog survives the first bounded invocation');await h.restart()}
  }
  assert.equal(h.received.length,48);assert.equal(new Set(h.received.map(r=>r.headers['webhook-id'])).size,48);for(const project of ['p','q'])assert.equal(h.received.filter(r=>r.headers['webhook-tenant']===project).length,24);
  await h.call('/_test/scheduled-metered',body({}));assert.equal(h.received.length,48);assert.equal((await h.db.prepare("SELECT count(*) n FROM integration_deliveries WHERE state='accepted'").first()).n,48);assert.equal(h.external,0);console.log(JSON.stringify({proof:'global-integration-cron-budget',invocations:metrics.length,maxD1Statements:Math.max(...metrics.map(x=>x.statements)),recipients:h.received.length}));
 }finally{await h.close()}
}],
  ['HTTPS delivery refuses every redirect status without requesting its Location',async()=>{
 const h=await harness();try{
  const a=await webhook(h);for(const status of [300,301,302,303,304,305,306,307,308,399]){
   h.responses.push({status,headers:{Location:'https://receiver.example.com/redirect-target'}});const count=h.received.length,job=await h.call(root+'/webhooks/'+a.id+'/test',body({}));assert.equal(h.received.length,count+1);assert.ok(h.received.every(r=>!r.path.endsWith('/redirect-target')));const row=(await h.call(root+'/deliveries')).data.find(r=>r.id===job.id);assert.equal(row.state,'uncertain');assert.equal(row.error_class,'response_unknown');
  }await h.restart();await h.dispatch();assert.equal(h.received.length,10);assert.equal(h.external,0);
 }finally{await h.close()}
}],
  ['HTTPS delivery bounds outgoing bytes and both declared and streamed response bytes',async()=>{
 const h=await harness();try{
  const a=await webhook(h);h.responses.push({status:429});const job=await h.call(root+'/webhooks/'+a.id+'/test',body({}));
  await h.db.prepare("UPDATE integration_deliveries SET envelope=json_set(envelope,'$.body',?),next_at=0 WHERE id=?").bind('x'.repeat(1048577),job.id).run();await h.dispatch();assert.equal(h.received.length,1);let row=(await h.call(root+'/deliveries')).data.find(r=>r.id===job.id&&r.number===2);assert.equal(row.state,'rejected');assert.equal(row.error_class,'preflight_failed');
  for(const response of [{status:200,headers:{'Content-Length':'65537'},body:'x'.repeat(65537)},{status:200,chunks:['x'.repeat(32768),'x'.repeat(32769)]}]){
   h.responses.push(response);const next=await h.call(root+'/webhooks/'+a.id+'/test',body({}));row=(await h.call(root+'/deliveries')).data.find(r=>r.id===next.id);assert.equal(row.state,'uncertain');assert.equal(row.error_class,'response_unknown');
  }await h.restart();await h.dispatch();assert.equal(h.received.length,3);assert.equal(h.external,0);
 }finally{await h.close()}
}],
  ['deliberate uncertain resend preserves exact delivery and history, serializes approvals, and never renews the automatic retry budget',async()=>{
 const h=await harness();try{
  const a=await webhook(h);h.responses.push({status:429});const job=await h.call(root+'/webhooks/'+a.id+'/test',body({}));
  for(const status of [429,429,500]){h.responses.push({status});await h.db.prepare('UPDATE integration_deliveries SET next_at=0 WHERE id=?').bind(job.id).run();await h.dispatch()}
  const original=await h.db.prepare('SELECT * FROM integration_deliveries WHERE id=?').bind(job.id).first(),history=(await h.db.prepare('SELECT * FROM integration_attempts WHERE delivery_id=? ORDER BY number').bind(job.id).all()).results;
  assert.equal(original.state,'uncertain');assert.equal(original.attempts,original.max_attempts);const path=root+'/deliveries/'+job.id+'/resend';
  const concurrent=await Promise.all([h.raw(path,body({attempt:original.attempts})),h.raw(path,body({attempt:original.attempts}))]);assert.deepEqual(concurrent.map(r=>r.status).sort(),[202,409]);assert.equal(h.received.length,4,'approval queues without sending');
  h.responses.push({status:500});await h.restart();await h.call('/_test/scheduled',body({}));assert.equal(h.received.length,5);
  assert.equal((await h.raw(path,body({attempt:4}))).status,409,'stale approval cannot authorize a later uncertain attempt');
  await h.db.prepare("INSERT INTO users VALUES('admin','admin@example.test','Admin',1)").run();await h.db.prepare("INSERT INTO memberships VALUES('p','admin','admin')").run();await h.session('admin','p','admin','admin');
  await h.call(path,{actor:'admin',...body({attempt:5})});h.responses.push({status:429});await h.call('/_test/scheduled',body({}));await h.restart();await h.dispatch();assert.equal(h.received.length,6);
  const current=await h.db.prepare('SELECT * FROM integration_deliveries WHERE id=?').bind(job.id).first();assert.equal(current.state,'rejected');assert.equal(current.attempts,6);
  for(const field of ['id','namespace','envelope','fingerprint','destination_hash','max_attempts','retry_delays'])assert.equal(current[field],original[field],field+' retained');
  assert.deepEqual((await h.db.prepare('SELECT * FROM integration_attempts WHERE delivery_id=? AND number<=4 ORDER BY number').bind(job.id).all()).results,history);
  for(const receipt of h.received){assert.ok(receipt.body.equals(h.received[0].body));assert.ok(verifyIndependent(receipt,a.secret,{tenant:'p',destination:a.id,event:'integration.test',id:job.id}))}
  const audits=(await h.db.prepare("SELECT * FROM native_integration_audit WHERE action LIKE 'delivery.resend.%' ORDER BY created_at").all()).results;assert.deepEqual(audits.map(r=>[r.actor_id,r.resource_id,r.action]),[['owner',job.id,'delivery.resend.5'],['admin',job.id,'delivery.resend.6']]);assert.ok(audits.every(r=>r.created_at>=original.created_at));
  assert.equal((await h.raw(path,body({attempt:6}))).status,409);assert.equal(h.external,0);
  // An earlier deliberate resend consumes the remaining original budget.
  h.responses.push({status:408});const early=await h.call(root+'/webhooks/'+a.id+'/test',body({}));const beforeApproval=h.received.length;await h.restart();await h.dispatch();assert.equal(h.received.length,beforeApproval,'HTTP 408 stays uncertain without automatic replay');await h.call(root+'/deliveries/'+early.id+'/resend',body({attempt:1}));
  for(const status of [429,429,429]){h.responses.push({status});await h.db.prepare('UPDATE integration_deliveries SET next_at=0 WHERE id=?').bind(early.id).run();await h.dispatch()}
  const exhausted=await h.db.prepare('SELECT * FROM integration_deliveries WHERE id=?').bind(early.id).first();assert.equal(exhausted.state,'rejected');assert.equal(exhausted.attempts,exhausted.max_attempts);assert.equal((await h.db.prepare("SELECT count(*) n FROM native_integration_audit WHERE resource_id=? AND action LIKE 'delivery.resend.%'").bind(early.id).first()).n,1);
 }finally{await h.close()}
}],
  ['resend refuses anonymous, operator, foreign, stale state, destination and erasure authority including commit races',async()=>{
 const h=await harness();try{
  const a=await webhook(h);await h.contact();await h.conversation();h.responses.push({status:500});await h.dispatch();
  const job=await h.db.prepare('SELECT id FROM integration_deliveries').first(),path=root+'/deliveries/'+job.id+'/resend';
  await h.db.prepare("INSERT INTO users VALUES('operator','op@example.test','Operator',1)").run();await h.db.prepare("INSERT INTO memberships VALUES('p','operator','operator')").run();await h.session('operator','p','operator','operator');
  assert.equal((await h.raw(path,{token:null,...body({attempt:1})})).status,401);assert.equal((await h.raw(path,{actor:'operator',...body({attempt:1})})).status,403);assert.equal((await h.raw(path,{actor:'foreign',...body({attempt:1})})).status,403);
  assert.equal((await h.raw('/api/management/projects/q/connections/deliveries/'+job.id+'/resend',{actor:'foreign',...body({attempt:1})})).status,404);
  for(const state of ['queued','sending','accepted','rejected']){await h.db.prepare('UPDATE integration_deliveries SET state=? WHERE id=?').bind(state,job.id).run();assert.equal((await h.raw(path,body({attempt:1}))).status,409)}await h.db.prepare("UPDATE integration_deliveries SET state='uncertain' WHERE id=?").bind(job.id).run();
  const before=await h.db.prepare('SELECT * FROM integration_deliveries WHERE id=?').bind(job.id).first();
  const changed=await webhook(h,'/changed'),cipher=(await h.db.prepare('SELECT secret_ciphertext FROM native_integration_destinations WHERE id=?').bind(a.id).first()).secret_ciphertext;
  for(const [race,restore] of [
   [[{sql:"UPDATE sessions SET revoked_at=1 WHERE actor_id='owner'"}],[{sql:"UPDATE sessions SET revoked_at=NULL WHERE actor_id='owner'"}]],
   [[{sql:"UPDATE memberships SET role='operator' WHERE project_id='p' AND user_id='owner'"},{sql:"UPDATE memberships SET role='owner' WHERE project_id='p' AND user_id='owner'"}],[]],
   [[{sql:"INSERT INTO project_settings VALUES('p','{\"deleted_at\":1}',1)"}],[{sql:"DELETE FROM project_settings WHERE project_id='p'"}]],
   [[{sql:'UPDATE native_integration_destinations SET enabled=0 WHERE id=?',params:[a.id]}],[{sql:'UPDATE native_integration_destinations SET enabled=1 WHERE id=?',params:[a.id]}]],
   [[{sql:'UPDATE native_integration_destinations SET secret_ciphertext=(SELECT secret_ciphertext FROM native_integration_destinations WHERE id=?) WHERE id=?',params:[changed.id,a.id]}],[{sql:'UPDATE native_integration_destinations SET secret_ciphertext=? WHERE id=?',params:[cipher,a.id]}]]
  ]){
   const response=await h.raw('/_test/race',body({path,body:{attempt:1},match:'INSERT INTO native_integration_audit(id,project_id,actor_id,action',race}));assert.equal(response.status,409);assert.deepEqual(await h.db.prepare('SELECT * FROM integration_deliveries WHERE id=?').bind(job.id).first(),before);assert.equal((await h.db.prepare("SELECT count(*) n FROM native_integration_audit WHERE action LIKE 'delivery.resend.%'").first()).n,0);for(const command of restore)await h.db.prepare(command.sql).bind(...(command.params||[])).run();
  }
  // A changed URL before validation is refused, as is a disabled destination.
  await h.db.prepare('UPDATE native_integration_destinations SET secret_ciphertext=(SELECT secret_ciphertext FROM native_integration_destinations WHERE id=?) WHERE id=?').bind(changed.id,a.id).run();assert.equal((await h.raw(path,body({attempt:1}))).status,409);await h.db.prepare('UPDATE native_integration_destinations SET secret_ciphertext=?,enabled=0 WHERE id=?').bind(cipher,a.id).run();assert.equal((await h.raw(path,body({attempt:1}))).status,409);await h.db.prepare('UPDATE native_integration_destinations SET enabled=1 WHERE id=?').bind(a.id).run();
  h.responses.push({status:500});const missing=await h.call(root+'/webhooks/'+changed.id+'/test',body({}));await h.db.prepare('DELETE FROM native_integration_intents WHERE id=?').bind(missing.id).run();await h.db.prepare('DELETE FROM native_integration_destinations WHERE id=?').bind(changed.id).run();assert.equal((await h.raw(root+'/deliveries/'+missing.id+'/resend',body({attempt:1}))).status,409);
  const erased=await h.raw('/_test/race',body({path,body:{attempt:1},match:'INSERT INTO native_integration_audit(id,project_id,actor_id,action',race:[{sql:"UPDATE contacts SET metadata_json=json_set(metadata_json,'$.is_erasing',1) WHERE id='visitor'"}]}));assert.equal(erased.status,409);assert.equal((await h.raw(path,body({attempt:1}))).status,404);await h.db.prepare("UPDATE contacts SET metadata_json=json_set(metadata_json,'$.is_erased',1) WHERE id='visitor'").run();assert.equal((await h.raw(path,body({attempt:1}))).status,404);await h.dispatch();assert.equal(h.received.length,2);assert.equal((await h.db.prepare("SELECT count(*) n FROM native_integration_audit WHERE action LIKE 'delivery.resend.%'").first()).n,0);assert.equal(h.external,0);
 }finally{await h.close()}
 await assertResendPreparationRaces();
}]
]));
