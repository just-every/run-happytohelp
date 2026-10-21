import assert from 'node:assert/strict'
export async function schedulesFlow(f){
 const {app,w,ok,call,create,get,patch,clock,send,initial}=f
 const id=await create('Please follow up about the replacement'),due=initial+3600000
 const snooze=await ok('/workflow-schedules',{conversation_id:id,kind:'snooze',due_at:due,timezone:'America/New_York',owner_id:w.users.owner})
 assert.ok(!(await ok('/conversations')).some(t=>t.id===id));assert.ok((await ok('/conversations?snoozed=only')).some(t=>t.id===id))
 assert.equal((await ok('/conversations/counts')).snoozed,(await ok('/conversations?snoozed=only&view=open')).length,'the Snoozed count is its list')
 await send(id);assert.equal((await ok(`/conversations/${id}/workflows`)).schedules.find(s=>s.id===snooze.id).state,'woken');assert.ok((await ok('/conversations')).some(t=>t.id===id))
 const schedule=async(ticketId,body='Your replacement is on its way.')=>{const t=await get(ticketId);return ok('/workflow-schedules',{conversation_id:ticketId,kind:'reply',due_at:due,timezone:'America/New_York',body,owner_id:w.users.owner,expected_revision:t.revision,expected_last_message_id:t.last_message_id,expected_ticket_version:t.ticket_version})}
 const cancel=await schedule(id);await ok(`/workflow-schedules/${cancel.id}`,{body:'A revised shipment update',due_at:due+60000},'PATCH');await ok(`/workflow-schedules/${cancel.id}`,{action:'cancel'},'PATCH')
 assert.equal((await ok(`/conversations/${id}/workflows`)).schedules.find(s=>s.id===cancel.id).state,'cancelled')
 const customerReply=await schedule(id);await send(id,'The new address is different.');assert.equal((await ok(`/conversations/${id}/workflows`)).schedules.find(s=>s.id===customerReply.id).state,'cancelled')
 const reassigned=await schedule(id);await patch(id,{assigned_to:w.users.admin});assert.equal((await ok(`/conversations/${id}/workflows`)).schedules.find(s=>s.id===reassigned.id).state,'cancelled')
 const sent=await schedule(id);await clock(due);await app.scheduled()
 assert.equal((await ok(`/conversations/${id}/workflows`)).schedules.find(s=>s.id===sent.id).state,'sent')
 const messages=await app.sql("SELECT * FROM messages WHERE conversation_id=? AND local_id=?",id,`schedule:${sent.id}`);assert.equal(messages.length,1)
 await app.configure({H2H_WORKFLOW_NOW:String(due+60000)});await app.scheduled();assert.equal((await app.sql('SELECT * FROM messages WHERE local_id=?',`schedule:${sent.id}`)).length,1)
 await clock(initial)
 const uncertainId=await create('Waiting for a committed reply'),uncertain=await schedule(uncertainId)
 // The provider receives the request body but the connection resets. Only the
 // real network boundary is faked; the persisted send is never replayed.
 // Isolate the scheduled reply's paid boundary from earlier SLA notices and outbox recovery.
 await ok(`/sla-policies/${f.policy.id}`,{active:false},'PATCH');await app.scheduled()
 for(const token of Object.values(w.tokens))await app.ok(`/api/management/projects/${w.projectId}/notification-preferences`,{token,method:'PUT',body:{preferences:['assignment','customer_updated','group','follower','mention'].map(kind=>({kind,inbox:true,email:false}))}})
 await app.db.prepare('UPDATE contacts SET is_verified=1 WHERE id=? AND project_id=?').bind(f.customer.contactId,w.projectId).run()
 await app.configure({EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'workflow-provider-edge-key',EMAIL_FROM:'support@example.test'})
 await clock(due)
 await app.scheduled()
 const outcome=(await ok(`/conversations/${uncertainId}/workflows`)).schedules.find(s=>s.id===uncertain.id);assert.equal(outcome.state,'uncertain')
 await app.configure({H2H_WORKFLOW_NOW:String(due+180000)});await app.scheduled()
 assert.equal((await app.sql('SELECT * FROM messages WHERE local_id=?',`schedule:${uncertain.id}`)).length,1)
 assert.equal((await call(`/workflow-schedules/${uncertain.id}`,{body:'Do not replay'},'PATCH')).status,409)
 assert.equal(app.requests.filter(r=>new URL(r.url).hostname==='api.resend.com').length,1,JSON.stringify(app.requests.filter(r=>new URL(r.url).hostname==='api.resend.com').map(r=>{const body=JSON.parse(r.body);return {to:body.to,subject:body.subject}})))
 await app.configure({EMAIL_PROVIDER:'development',EMAIL_API_KEY:undefined})
 // A dependency snooze wakes once the named ticket is solved.
 await clock(initial)
 const group=await ok('/ticket-groups',{name:'Aftercare',members:Object.values(w.users)});const groupReassigned=await schedule(id);await patch(id,{group_id:group.id});assert.equal((await ok(`/conversations/${id}/workflows`)).schedules.find(s=>s.id===groupReassigned.id).state,'cancelled','Moving the responsible team cancels the old queued reply')
 const dependency=await create('Warehouse confirmation'),dependent=await create('Waiting for warehouse')
 const sleep=await ok('/workflow-schedules',{conversation_id:dependent,kind:'snooze',dependency_id:dependency,timezone:'America/New_York',owner_id:w.users.owner})
 await patch(dependency,{status_id:'solved'});await app.scheduled();assert.equal((await ok(`/conversations/${dependent}/workflows`)).schedules.find(s=>s.id===sleep.id).state,'woken')
 // Closed follow-up carries private fields/CCs without exposing another contact's ticket.
 const closed=await get(f.closedId),reply=await send(closed.id,'The replacement arrived damaged too.')
 assert.ok(reply.followupConversationId);assert.equal((await get(closed.id)).status_category,'closed');assert.equal((await ok(`/conversations/${reply.followupConversationId}/workflows`)).followup_of,closed.id)
 assert.equal((await app.call(`/api/dashboard/projects/${f.other.projectId}/workflow-schedules`,{token:w.tokens.owner,body:{conversation_id:id,kind:'reply',due_at:due+999999,timezone:'UTC',body:'forbidden',owner_id:w.users.owner}})).status,403)
 assert.ok((await app.first("SELECT count(*) n FROM audit_events WHERE project_id=? AND action LIKE 'workflow.schedule.%'",w.projectId)).n>0)
 // A due set returns to the queue and sends without a per-tick singleton bottleneck.
 await clock(initial)
 const batch=[]
 for(let i=0;i<60;i++){
  const ticket=await create(`Scheduled replacement ${i}`)
  const sleep=await ok('/workflow-schedules',{conversation_id:ticket,kind:'snooze',due_at:due,timezone:'America/New_York',owner_id:w.users.owner})
  const reply=i<30?await schedule(ticket):null;batch.push({ticket,sleep,reply})
 }
 for(let minute=0;minute<3;minute++){await clock(due+minute*60000);await app.scheduled()}
 for(const row of batch){
  const schedules=(await ok(`/conversations/${row.ticket}/workflows`)).schedules
  assert.equal(schedules.find(s=>s.id===row.sleep.id).state,'woken')
  if(row.reply){assert.equal(schedules.find(s=>s.id===row.reply.id).state,'sent');assert.equal((await app.first('SELECT count(*) n FROM messages WHERE conversation_id=? AND local_id=?',row.ticket,`schedule:${row.reply.id}`)).n,1)}
 }
 await clock(initial)
 f.scheduleId=id
}


// Overload rows in the existing operator-mail journey. Stored backlog is fixture
// data; delivery, schedule admission, retention settings and cron use public doors.
export async function cronBacklogFlow(m){
 const {app,mail}=m,w=await app.seedWorkspace('cron-backlog'),P=w.projectId,now=Date.now(),day=86400000
 await app.configure({INBOUND_EMAIL_TOKEN:'synthetic-cron-backlog-signing-token'})
 await app.db.prepare("INSERT INTO email_settings VALUES(?,'Support','sender@example.com','backlog-inbound@example.com',1,1)").bind(P).run()
 const seed=async(id,count=1)=>{
  const statements=[app.db.prepare("INSERT INTO contacts(id,project_id,name,email,is_verified,metadata_json,created_at) VALUES(?,?,?, ?,1,'{}',?)").bind('ct-'+id,P,'Customer '+id,id+'@example.com',now-3600000),
   app.db.prepare("INSERT INTO conversations(id,project_id,contact_id,assigned_to,created_at,updated_at,ticket_source) VALUES(?,?,?,?,?,?,'widget')").bind(id,P,'ct-'+id,w.users.owner,now-3600000,now-3600000)]
  for(let n=1;n<=count;n++)statements.push(app.db.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at) VALUES(?,?,?,?,?,'contact',?,?,?)")
   .bind(`m-${id}-${n}`,P,id,`local-${n}`,'ct-'+id,`Order ${id}, customer message ${n}`,n,now-3600000+n))
  statements.push(app.db.prepare("UPDATE conversations SET revision=?,last_message_id=?,updated_at=? WHERE id=?").bind(count,`m-${id}-${count}`,now-3600000,id))
  await app.db.batch(statements)
 }
 const unreadIds=[],teamIds=[],replyIds=[]
 for(let i=0;i<100;i++)await seed(`backlog-${String(i).padStart(3,'0')}`,i===0?100:1)
 for(let i=0;i<60;i++)await seed('backlog-reply-'+i)
 await app.ok(`/api/outcomes/projects/${P}/settings`,{token:w.tokens.owner,method:'PUT',body:{enabled:true,scale:'five',delayMinutes:1,expiresDays:14,locale:'en'}})
 for(let i=0;i<60;i++){
  const incoming=await app.ok('/api/integrations/email/inbound',{headers:{Authorization:'Bearer synthetic-cron-backlog-signing-token'},body:{messageId:`backlog-survey-${i}@example.com`,to:'backlog-inbound@example.com',from:`survey-buyer-${i}@example.com`,subject:'Replacement order',text:'Where is my replacement?'}}),id=incoming.conversationId||incoming.conversation_id
  await app.ok(`/api/dashboard/projects/${P}/conversations/${id}`,{token:w.tokens.owner,method:'PUT',body:{resolved:true}})
 }
 // Settle ordinary creation events before freezing the scheduled reply frontiers.
 for(let i=0;i<8;i++)await app.scheduled()
 for(let i=0;i<60;i++){
  const id='backlog-reply-'+i,path=`/api/dashboard/projects/${P}`,ticket=(await app.ok(`${path}/conversations/${id}/ticket`,{token:w.tokens.owner})).data
  const row=(await app.ok(`${path}/workflow-schedules`,{token:w.tokens.owner,body:{conversation_id:id,kind:'reply',due_at:now+3600000,timezone:'UTC',body:'Your replacement ships today.',owner_id:w.users.owner,expected_revision:ticket.revision,expected_last_message_id:ticket.last_message_id,expected_ticket_version:ticket.ticket_version}})).data
  replyIds.push(row.id)
 }
 for(let i=0;i<100;i++){
  const id=`backlog-${String(i).padStart(3,'0')}`,batch='batch-'+id,unread='unread-'+id,team='team-'+id
  unreadIds.push(unread);teamIds.push(team)
  await app.db.batch([
   app.db.prepare('INSERT INTO operator_notification_activity(message_id,project_id,conversation_id,revision,batch_id) SELECT id,project_id,conversation_id,revision,? FROM messages WHERE conversation_id=?').bind(batch,id),
   app.db.prepare("INSERT INTO operator_notifications(id,project_id,conversation_id,user_id,kind,batch_id,through_revision,created_at) VALUES(?,?,?,?,'unread',?,?,?)").bind(unread,P,id,w.users.owner,batch,i===0?100:1,now+i),
   app.db.prepare("INSERT INTO notification_inbox(id,project_id,conversation_id,user_id,kind,inbox,email,email_address,created_at) VALUES(?,?,?,?,'mention',1,1,?,?)").bind(team,P,id,w.users.owner,'owner-cron-backlog@example.test',now+i),
  ])
 }
 for(let i=0;i<50;i++){
  const a=await app.seedWorkspace('retention-backlog-'+i)
  await app.ok(`/api/management/projects/${a.projectId}/audit/retention`,{token:a.tokens.owner,method:'PUT',body:{days:90}})
  await app.db.prepare("INSERT INTO audit_events(id,project_id,at,category,action,outcome,actor_type,source) VALUES(?,?,?,'auth','sign_in.succeeded','succeeded','system','system')").bind('expired-backlog-'+i,a.projectId,now-100*day).run()
 }
 const start=mail.sent.length,ticks=[],pending=async()=>(await app.first("SELECT (SELECT count(*) FROM operator_notifications WHERE project_id=?1 AND state='pending')+(SELECT count(*) FROM notification_inbox WHERE project_id=?1 AND state IN ('pending','awaiting_provider')) n",P)).n
 assert.equal(await pending(),200)
 for(let tick=0;tick<120;tick++){
  const result=await app.scheduled(undefined,{after:day});ticks.push(result)
  assert.equal(result.refused,0);assert.equal(result.pruned,true)
  assert.deepEqual(Object.keys(result.consumers).sort(),['audit','cron','notifications','reports'])
  assert.ok(Object.values(result.consumers).every(consumer=>consumer.completed))
  if(tick===0){assert.ok(await pending()>0,'a saturated tick leaves durable notice backlog');assert.ok((await app.first("SELECT count(*) n FROM workflow_schedules WHERE id IN (SELECT value FROM json_each(?)) AND state='sent'",JSON.stringify(replyIds))).n>0,'R5 replies progress in the same invocation')}
  if(tick===1)await app.configure({}) // restart the same persisted backlog
  if(!await pending()&&tick>=49)break
 }
 assert.equal(await pending(),0)
 const sent=mail.sent.slice(start),keys=sent.map(entry=>entry.headers['idempotency-key'])
 for(const ids of [unreadIds,teamIds])assert.deepEqual(keys.filter(key=>ids.includes(key)),ids,'FIFO notices drain once to their proven member')
 for(const entry of sent.filter(entry=>unreadIds.includes(entry.headers['idempotency-key'])||teamIds.includes(entry.headers['idempotency-key'])))assert.deepEqual(entry.body.to,['owner-cron-backlog@example.test'])
 const digest=sent.find(entry=>entry.headers['idempotency-key']===unreadIds[0]).body
 for(let n=1;n<=100;n++)assert.ok(digest.text.includes(`customer message ${n}`),'a full digest is not truncated to fit the budget')
 assert.ok(digest.html.includes('Customer backlog-000'))
 assert.equal((await app.first("SELECT count(*) n FROM audit_events WHERE id LIKE 'expired-backlog-%'")).n,0)
 assert.equal((await app.first("SELECT count(*) n FROM audit_events WHERE action='audit.purged' AND project_id LIKE 'p-retention-backlog-%'")).n,50)
 assert.equal((await app.first("SELECT count(*) n FROM workflow_schedules WHERE id IN (SELECT value FROM json_each(?)) AND state='sent'",JSON.stringify(replyIds))).n,60)
 assert.equal((await app.first("SELECT count(*) n FROM csat_surveys WHERE project_id=? AND state='sent'",P)).n,60)
 const idle=await app.scheduled(undefined,{after:day});assert.equal(idle.consumers.audit.statements,1,'retention settings alone do no per-workspace work')
 assert.deepEqual(mail.sent.slice(start).map(entry=>entry.headers['idempotency-key']),keys,'an empty follow-up tick never repeats a notice')
 // Once the cron backlog has cleared, each ready burst uses spare invocation
 // room in the very same tick, rather than inheriting a per-minute mail cap.
 for(const count of [4,12]){
  const ids=[]
  for(let i=0;i<count;i++){
   const id=`spare-${count}-${i}`;await seed(id);ids.push(id)
   await app.db.prepare('INSERT INTO operator_notification_activity(message_id,project_id,conversation_id,revision) SELECT id,project_id,conversation_id,revision FROM messages WHERE conversation_id=?').bind(id).run()
  }
  const before=mail.sent.length,result=await app.scheduled(undefined,{after:day})
  assert.equal(result.refused,0);assert.equal(result.pruned,true)
  assert.ok(Object.values(result.consumers).every(consumer=>consumer.completed))
  const sent=mail.sent.slice(before).filter(entry=>ids.some(id=>entry.body.text?.includes(`/conversations/${id}`)))
  assert.equal(sent.length,count,'every ready digest is delivered in this tick when room exists')
  console.log(JSON.stringify({proof:'spare-room-notices',ready:count,sent:sent.length,statements:result.statements}))
 }
 // A workspace with rows expiring every minute must yield to the other due
 // workspaces, including after a restart. This is ordinary advancing cron time.
 const anchor=Date.now(),fair=[]
 for(let i=0;i<5;i++)fair.push(app.db.prepare("INSERT INTO audit_events(id,project_id,at,category,action,outcome,actor_type,source) VALUES(?,'p-retention-backlog-0',?,'auth','sign_in.succeeded','succeeded','system','system')").bind('fair-active-'+i,anchor+day+i*60000-90*day-1))
 for(let i=1;i<5;i++)fair.push(app.db.prepare("INSERT INTO audit_events(id,project_id,at,category,action,outcome,actor_type,source) VALUES(?,?,?,'auth','sign_in.succeeded','succeeded','system','system')").bind('fair-waiting-'+i,'p-retention-backlog-'+i,anchor-100*day))
 await app.db.batch(fair)
 for(let minute=0;minute<5;minute++){
  const result=await app.scheduled(undefined,{after:day+minute*60000});assert.equal(result.refused,0);assert.equal(result.pruned,true)
  if(minute===1)await app.configure({})
 }
 assert.equal((await app.first("SELECT count(*) n FROM audit_events WHERE id LIKE 'fair-waiting-%'")).n,0,'continuous expiry in one workspace never starves another')
 await app.scheduled(undefined,{after:day+5*60000})
 assert.equal((await app.first("SELECT count(*) n FROM audit_events WHERE id LIKE 'fair-active-%'")).n,0,'the busy workspace also resumes its retained work')
 console.log(JSON.stringify({proof:'whole-cron-backlog',surveys:60,replies:60,unread:100,teammate:100,retentionWorkspaces:50,fullDigestMessages:100,ticks:ticks.length,peak:Math.max(...ticks.map(tick=>tick.statements)),first:ticks[0],idleAuditStatements:idle.consumers.audit.statements}))
}
