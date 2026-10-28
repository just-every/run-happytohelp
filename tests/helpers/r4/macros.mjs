import assert from 'node:assert/strict'
import {ticketFixture} from '../inbox/ticket-fixture.mjs'

/** One end-state journey through the real router, D1, R2 and native admission.
 * Only the provider network is replaced for assignment delivery. */
export async function macrosJourney(){
 const notices=[]
 const f=await ticketFixture({outbound:async request=>{assert.equal(new URL(request.url).hostname,'api.resend.com');notices.push({key:request.headers.get('idempotency-key'),body:await request.json()});return Response.json({id:'macro-mail-'+notices.length})}}),{app,w,foreign,id,ok,call,get,patch,create,visitor}=f
 const run=async(macro,action,tickets,extra={},role='owner')=>ok(`/macros/${macro.id}/${action}`,{version:macro.version,tickets,...extra},role)
 try{
  const group=await ok('/ticket-groups',{name:'Returns',members:[w.users.owner,w.users.operator]})
  const field=await ok('/ticket-fields',{name:'Replacement order',type:'text'})
  const privateField=await ok('/ticket-fields',{name:'Manager reference',type:'text',read_roles:['owner'],write_roles:['owner']})
  const tag=await ok(`/conversations/${id}/tags`,{name:'Replacement pending'})
  const upload=await app.ok(`/api/conversations/${id}/media`,{token:w.tokens.owner,raw:true,headers:{'Content-Type':'text/plain','X-Filename':'return-instructions.txt'},body:'Pack the boots and attach the return label.'})
  const macro=await ok('/macros',{title:'Arrange replacement',content:'Hello {{requester.first_name | there}}, we will replace order {{ticket.id}}. {{ticket.custom.missing}}',actions:{reply_type:'public',status_id:'pending',priority:'high',tags_add:[tag.id],group_id:group.id,agent_id:w.users.operator,followers:[w.users.owner,w.users.operator],fields:{[field.id]:'RMA-123'},attachments:[upload.id]},scope:{visibility:'group',groups:[group.id],roles:['owner','operator'],brands:[w.projectId]}})
  const selected=[{id,expected_version:(await get(id)).ticket_version}]
  const before=await app.first('SELECT count(*) n FROM messages WHERE conversation_id=?',id)
  const preview=(await run(macro,'preview',selected)).results[0]
  assert.equal(preview.status,'ready');assert.deepEqual(preview.draft.unresolved,['ticket.custom.missing'])
  for(const key of ['reply','status_id','priority','tags_add','group_id','agent_id','followers','custom.'+field.id,'attachments'])assert.ok(preview.changes.some(c=>c.field===key),key)
  assert.equal((await get(id)).priority,'normal','preview does not change the ticket')
  await app.configure({EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'macro-provider-fixture',EMAIL_FROM:'support@example.test'})
  const result=(await run(macro,'apply',selected,{command_id:'apply-replacement'})).results[0]
  assert.equal((await app.first("SELECT count(*) n FROM operator_notifications WHERE conversation_id=? AND kind='assignment' AND state='complete'",id)).n,1,'macro assignment completes its committed intent in the apply request');
  assert.equal(result.status,'applied',JSON.stringify(result));assert.equal(result.draft.media.length,1);assert.notEqual(result.draft.media_ids[0],upload.id)
  assert.equal((await get(id)).status_id,'pending');assert.equal((await get(id)).assigned_to,w.users.operator);assert.equal((await get(id)).fields[field.id],'RMA-123')
  const assignment=await app.first("SELECT id FROM operator_notifications WHERE conversation_id=? AND kind='assignment' AND state='complete'",id)
  assert.deepEqual(notices.filter(notice=>notice.key===assignment.id).map(notice=>notice.body.to),[[`operator-tickets@example.test`]],'the apply request sends the macro assignment once to its proven member')
  assert.deepEqual(await app.first('SELECT user_id,inbox,state FROM notification_inbox WHERE id=?',assignment.id),{user_id:w.users.operator,inbox:1,state:'sent'},'the assignment is already in the recipient inbox when apply returns')
  await app.configure({EMAIL_PROVIDER:'development',EMAIL_API_KEY:undefined,EMAIL_FROM:undefined})
  assert.equal((await app.first("SELECT count(*) n FROM operator_notifications WHERE conversation_id=? AND kind='assignment' AND state='pending'",id)).n,0,'the apply request leaves no pending macro assignment');
  assert.equal((await app.first('SELECT count(*) n FROM conversation_followers WHERE conversation_id=?',id)).n,2)
  assert.equal((await app.first('SELECT count(*) n FROM messages WHERE conversation_id=?',id)).n,before.n,'apply only stores a draft')
  const restored=await ok(`/conversations/${id}/macro-draft`)
  assert.equal(restored.content,result.draft.content);assert.deepEqual(restored.media,result.draft.media);assert.deepEqual(restored.media_ids,result.draft.media_ids)
  const replay=(await run(macro,'apply',selected,{command_id:'apply-replacement'})).results[0]
  assert.equal(replay.status,'duplicate');assert.equal((await app.first('SELECT count(*) n FROM macro_usage WHERE macro_id=?',macro.id)).n,1)
  assert.equal(notices.filter(notice=>notice.key===assignment.id).length,1,'a repeated macro command never resends assignment mail')
  const blocked=await app.call(`/api/conversations/${id}/messages`,{token:w.tokens.owner,body:{localId:'unresolved',content:result.draft.content,expectedRevision:(await get(id)).revision}})
  assert.equal(blocked.status,422);assert.equal(blocked.data.code,'unresolved_placeholders')
  const audit=await app.ok(`/api/management/projects/${w.projectId}/audit?limit=200`,{token:w.tokens.owner})
  assert.ok(audit.data.some(event=>event.action==='macro.applied'&&event.target_id===id&&event.actor_id===w.users.owner),'macro and saved draft appear in the workspace audit log')
  const edited=result.draft.content.replace('{{ticket.custom.missing}}','Your return label is attached.')
  assert.equal((await app.ok(`/api/conversations/${id}/messages`,{token:w.tokens.owner,body:{localId:'reviewed-reply',content:edited,mediaIds:result.draft.media_ids,expectedRevision:(await get(id)).revision}})).accepted,true)
  const customer=await app.ok(`/api/conversations/${id}/messages`,{token:visitor.token})
  assert.equal(customer.messages.at(-1).content,edited);assert.equal(customer.messages.at(-1).media.length,1);assert.ok(!edited.includes('{{'))
  const v2=await ok(`/macros/${macro.id}`,{expected_version:macro.version,title:'Replacement reviewed',content:'Hello {{requester.first_name | there}} — ticket {{ticket.id}}.',actions:{priority:'urgent'},scope:macro.scope},'owner','PUT')
  assert.equal((await ok(`/macros/${macro.id}/versions`)).length,2)
  assert.equal((await ok(`/macros/${macro.id}/versions`)).find(v=>v.version===macro.version).content,macro.content)
  assert.equal((await call(`/macros/${macro.id}`,{expected_version:macro.version,title:'Stale edit'},'owner','PUT')).status,409)
  assert.equal((await run(macro,'apply',[{id,expected_version:(await get(id)).ticket_version}],{command_id:'stale-macro'})).results[0].status,'stale')
  const tickets=[]
  for(let i=1;i<=31;i++){const ticketId=await create(i);tickets.push({id:ticketId,expected_version:(await get(ticketId)).ticket_version})}
  const foreignVisitor=await app.ok('/api/identity/widget/session',{body:{widgetKey:foreign.widgetKey},headers:{Origin:foreign.allowedOrigin}})
  const foreignTicket=await app.ok('/api/conversations',{token:foreignVisitor.token,body:{projectId:foreign.projectId}})
  const bulkSelection=[...tickets,{id:foreignTicket.id,expected_version:0}]
  const bulkPreview=await run(v2,'preview',bulkSelection)
  assert.equal(bulkPreview.results.filter(r=>r.status==='ready').length,31);assert.equal(bulkPreview.results.at(-1).status,'forbidden')
  await patch(tickets[0].id,{subject:'Changed while reviewing'})
  const bulk=await run(v2,'apply',bulkSelection,{command_id:'reviewed-bulk'})
  assert.equal(bulk.results.filter(r=>r.status==='applied').length,30);assert.equal(bulk.results[0].status,'stale');assert.equal(bulk.results.at(-1).status,'forbidden')
  assert.equal((await get(tickets[1].id)).priority,'urgent')
  // Discarding names the draft's own macro use; another use's discard leaves it, and only its operator's draft goes.
  const draftPath=`/conversations/${tickets[1].id}/macro-draft`
  assert.ok((await call(draftPath)).data.data.content)
  assert.equal((await ok(`${draftPath}?usage_id=another-use`,undefined,'owner','DELETE')).discarded,false)
  assert.equal((await ok(`${draftPath}?usage_id=${bulk.results[1].usage_id}`,undefined,'operator','DELETE')).discarded,false)
  assert.equal((await ok(`${draftPath}?usage_id=${bulk.results[1].usage_id}`,undefined,'owner','DELETE')).discarded,true)
  assert.equal((await call(draftPath)).data.data,null)
  assert.equal((await app.first('SELECT count(*) n FROM messages WHERE conversation_id=?',tickets[1].id)).n,1,'bulk never publishes replies')
  assert.equal((await ok(`/macros/${macro.id}/usage`)).reduce((n,u)=>n+u.uses,0),31)
  const overflow=Array.from({length:100},(_,i)=>({id:`overflow-macro-${i}`,expected_version:0}))
  await app.db.batch(overflow.map(ticket=>app.db.prepare('INSERT INTO conversations(id,project_id,contact_id,subject,created_at,updated_at) SELECT ?,project_id,contact_id,?,created_at,updated_at FROM conversations WHERE id=?').bind(ticket.id,'Replacement macro '+ticket.id,id)))
  const overflowMacro=await ok('/macros',{title:'Assign batch replacements',content:'We will arrange your replacement.',actions:{agent_id:w.users.operator,priority:'high'}})
  const overflowing=await run(overflowMacro,'apply',overflow,{command_id:'overflowing-macro'})
  assert.ok(overflowing.results.every(r=>['applied','queued'].includes(r.status)),JSON.stringify(overflowing))
  for(const job of (await app.takeJobs()).filter(job=>job.type==='ticket.batch')){
   assert.deepEqual((await app.runJobs([job])).retried,[])
   assert.deepEqual((await app.runJobs([job])).retried,[])
  }
  for(const selected of overflow){
   assert.equal((await get(selected.id)).assigned_to,w.users.operator)
   assert.equal((await app.first("SELECT count(*) n FROM audit_events WHERE action='macro.applied' AND target_id=?",selected.id)).n,1)
  }
  for(const [index,{fault,recovery}] of [
   {fault:'db-once',recovery:'queue'},{fault:'db-once',recovery:'cron'},
   {fault:'db-interrupt',recovery:'queue'},{fault:'db-interrupt',recovery:'cron'},
  ].entries()){
   const selection=await app.sql('SELECT id,ticket_version expected_version FROM conversations WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id',JSON.stringify(overflow.map(ticket=>ticket.id)))
   const priority=index%2?'high':'urgent',commandId=`resumable-macro-${index}`
   const continuationMacro=await ok('/macros',{title:`Recover replacements ${index}`,content:'We will arrange your replacement.',actions:{priority}})
   const accepted=await run(continuationMacro,'apply',selection,{command_id:commandId})
   const queued=accepted.results.filter(result=>result.status==='queued')
   assert.ok(queued.length>3,'several macro tickets overflow into durable work before the fault')
   const batchId=queued[0].batch_id,wake=(await app.takeJobs()).find(job=>job.type==='ticket.batch'&&job.id===batchId)
   assert.ok(wake)
   const read=()=>app.first('SELECT * FROM ticket_batch_jobs WHERE id=?',batchId)
   const original=await read(),pending=JSON.parse(original.selection_json)
   assert.equal(original.state,'pending');assert.equal(original.cursor,0)
   const failedRun=await app.runJobs([wake],{'x-test-fault':fault,'x-test-statement':fault==='db-once'?'INSERT INTO macro_usage':'UPDATE ticket_batch_jobs SET cursor=cursor\\+1','x-test-statement-at':fault==='db-once'?'3':'2'})
   assert.deepEqual(failedRun.retried,fault==='db-interrupt'?[0]:[])
   const partial=await read(),outcomes=JSON.parse(partial.results_json),pendingIds=new Set(pending.map(ticket=>ticket.id))
   const progressed=outcomes.filter(result=>pendingIds.has(result.id)&&result.status==='applied')
   assert.equal(partial.state,'pending');assert.ok(partial.cursor>=2)
   assert.ok(progressed.length>=2&&progressed.length<pending.length,'macro continuation commits queued work before interruption')
   assert.equal((await app.first("SELECT count(*) n FROM audit_events WHERE action='macro.applied' AND target_id=? AND json_extract(detail_json,'$.macro_id')=?",pending[0].id,continuationMacro.id)).n,1)
   assert.equal((await app.first("SELECT count(*) n FROM audit_events WHERE action='ticket.batch' AND target_id=?",batchId)).n,0)
   if(fault==='db-once'){
    assert.equal(outcomes.find(result=>result.id===pending[2].id).status,'retry')
    assert.equal(outcomes.find(result=>result.id===pending[2].id).attempts,1)
    assert.equal((await app.first('SELECT count(*) n FROM macro_usage WHERE conversation_id=? AND macro_id=? AND command_id=?',pending[2].id,continuationMacro.id,commandId)).n,0,'the failed macro transaction has no admitted use')
    assert.ok(pending.slice(3).some(ticket=>outcomes.find(result=>result.id===ticket.id).status==='applied'),'later macro tickets continue after a single transient')
    assert.equal((await app.first("SELECT count(*) n FROM audit_events WHERE action='ticket.batch.failed' AND target_id=? AND outcome='failed' AND json_extract(detail_json,'$.batch_id')=? AND json_extract(detail_json,'$.retryable')=1",pending[2].id,batchId)).n,1)
   }
   if(recovery==='cron'){
    await app.configure({})
    assert.deepEqual(await app.takeJobs(),[],'restart discards wakeups and keeps the pending macro row')
   }
   for(let attempt=0;attempt<32&&(await read()).state==='pending';attempt++){
    if(recovery==='cron')assert.equal((await app.scheduled()).ran,true)
    else assert.deepEqual((await app.runJobs([wake])).retried,[],'queue retry reuses the original wakeup')
   }
   const completed=await read()
   assert.equal(completed.state,'complete',`${fault} macro resumes through ${recovery}`)
   assert.ok(JSON.parse(completed.results_json).every(result=>result.status==='applied'))
   assert.equal((await app.first("SELECT count(*) n FROM audit_events WHERE action='ticket.batch' AND target_id=? AND outcome='succeeded'",batchId)).n,1)
   assert.deepEqual((await app.runJobs([wake])).retried,[])
   for(const ticket of selection){
    assert.equal((await get(ticket.id)).priority,priority)
    assert.equal((await ok(`/conversations/${ticket.id}/macro-draft`)).content,'We will arrange your replacement.')
    assert.equal((await app.first('SELECT count(*) n FROM macro_usage WHERE conversation_id=? AND macro_id=? AND command_id=?',ticket.id,continuationMacro.id,commandId)).n,1)
    assert.equal((await app.first("SELECT count(*) n FROM audit_events WHERE action='macro.applied' AND target_id=? AND json_extract(detail_json,'$.macro_id')=?",ticket.id,continuationMacro.id)).n,1,'recovery writes the macro audit once')
   }
  }
  // Both cron-only rows change every selected assignee. Prepare the sixteen
  // tickets outside the first row before enabling real provider delivery.
  for(const ticket of overflow.slice(84))await patch(ticket.id,{assigned_to:w.users.admin})
  await app.configure({EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'macro-provider-fixture',EMAIL_FROM:'support@example.test'})
  const assignmentIntents=()=>app.sql("SELECT id,conversation_id,user_id,state FROM operator_notifications WHERE project_id=? AND kind='assignment'",w.projectId)
  const cronTick=async()=>{
   const tick=await app.scheduled()
   assert.equal(tick.ran,true);assert.equal(tick.refused,0);assert.equal(tick.pruned,true)
   assert.ok(Object.values(tick.consumers).every(consumer=>consumer.completed),'all consumers finish alongside macro continuation')
   await app.takeJobs() // Lose every wakeup; only scheduled invocations may progress this work.
  }
  for(let tick=0;tick<3;tick++)await cronTick()
  for(const [size,role] of [[84,'admin'],[100,'operator']]){
   const selection=await app.sql('SELECT id,ticket_version expected_version FROM conversations WHERE id IN (SELECT value FROM json_each(?)) ORDER BY id',JSON.stringify(overflow.slice(0,size).map(ticket=>ticket.id)))
   const previousIds=new Set((await assignmentIntents()).map(intent=>intent.id)),mailBefore=notices.length
   const cronMacro=await ok('/macros',{title:`Assign cron replacements ${size}`,content:'We will arrange your replacement.',actions:{agent_id:w.users[role]}})
   const commandId=`cron-assignment-macro-${size}`,accepted=await run(cronMacro,'apply',selection,{command_id:commandId})
   assert.ok(accepted.results.every(result=>['applied','queued'].includes(result.status)),JSON.stringify(accepted))
   const queued=accepted.results.filter(result=>result.status==='queued')
   assert.ok(queued.length>0,'the assignment request leaves durable macro continuation work')
   const batchId=queued[0].batch_id,read=()=>app.first('SELECT * FROM ticket_batch_jobs WHERE id=?',batchId)
   assert.equal((await read()).state,'pending')
   assert.ok((await app.takeJobs()).some(job=>job.type==='ticket.batch'&&job.id===batchId),'discard the accepted batch wakeup without delivering it')
   for(let attempt=0;attempt<32&&(await read()).state==='pending';attempt++)await cronTick()
   const completed=await read()
   assert.equal(completed.state,'complete',`${size} macro assignments finish through cron alone`)
   assert.ok(JSON.parse(completed.results_json).every(result=>result.status==='applied'))
   for(let tick=0;tick<3;tick++)await cronTick()
   assert.equal((await app.first("SELECT count(*) n FROM audit_events WHERE action='ticket.batch' AND target_id=? AND outcome='succeeded'",batchId)).n,1)
   for(const ticket of selection){
    assert.equal((await get(ticket.id)).assigned_to,w.users[role])
    assert.equal((await app.first('SELECT count(*) n FROM macro_usage WHERE conversation_id=? AND macro_id=? AND command_id=?',ticket.id,cronMacro.id,commandId)).n,1,'cron admits each macro use once')
    assert.equal((await app.first("SELECT count(*) n FROM audit_events WHERE action='macro.applied' AND target_id=? AND json_extract(detail_json,'$.macro_id')=?",ticket.id,cronMacro.id)).n,1,'cron writes each macro receipt once')
   }
   const intents=(await assignmentIntents()).filter(intent=>!previousIds.has(intent.id)),intentIds=intents.map(intent=>intent.id).sort()
   assert.equal(intents.length,selection.length,'every selected assignment commits exactly one new intent')
   assert.deepEqual(intents.map(intent=>intent.conversation_id).sort(),selection.map(ticket=>ticket.id).sort())
   const inbox=await app.sql('SELECT id,user_id,inbox,state FROM notification_inbox WHERE id IN (SELECT value FROM json_each(?))',JSON.stringify(intentIds))
   assert.equal(inbox.length,selection.length,'every committed assignment reaches the recipient inbox')
   for(const intent of intents){
    assert.equal(intent.state,'complete')
    assert.equal(intent.user_id,w.users[role])
    assert.deepEqual(inbox.find(row=>row.id===intent.id),{id:intent.id,user_id:w.users[role],inbox:1,state:'sent'})
    assert.deepEqual(notices.slice(mailBefore).filter(notice=>notice.key===intent.id).map(notice=>notice.body.to),[[`${role}-tickets@example.test`]],'each committed intent sends exactly one provider mail to its assignee')
   }
   // A later tick may legitimately send an unread digest after its quiet period.
   const assignmentMail=()=>notices.slice(mailBefore).filter(notice=>notice.key?.startsWith('assignment:'))
   const sent=assignmentMail()
   assert.equal(new Set(sent.map(notice=>notice.key)).size,sent.length,'provider captures contain no duplicate keys')
   assert.deepEqual(sent.map(notice=>notice.key).sort(),intentIds,'provider captures contain every assignment and no extra assignment mail')
   await cronTick()
   assert.deepEqual(assignmentMail(),sent,'a later cron tick never replays assignment mail')
   assert.deepEqual((await assignmentIntents()).filter(intent=>!previousIds.has(intent.id)),intents,'a later cron tick creates no extra assignment intent')
  }
  await app.configure({EMAIL_PROVIDER:'development',EMAIL_API_KEY:undefined,EMAIL_FROM:undefined})
  const absent=await app.ok('/api/identity/widget/session',{body:{widgetKey:w.widgetKey},headers:{Origin:w.allowedOrigin}})
  const emptyNameTicket=await app.ok('/api/conversations',{body:{projectId:w.projectId},token:absent.token})
  assert.match((await run(v2,'preview',[{id:emptyNameTicket.id,expected_version:0}])).results[0].draft.content,/Hello there/)
  await app.db.prepare('DELETE FROM ticket_group_members WHERE project_id=? AND group_id=? AND user_id=?').bind(w.projectId,group.id,w.users.operator).run()
  assert.equal((await run(v2,'apply',[tickets[2]],{command_id:'removed-group'},'operator')).results[0].status,'forbidden')
  const ownerOnly=await ok('/macros',{title:'Managers',content:'Internal',scope:{visibility:'shared',roles:['owner'],groups:[],brands:[]}})
  assert.equal((await call(`/macros/${ownerOnly.id}`,undefined,'operator')).status,403)
  const personal=await ok('/macros',{title:'Private reply',content:'Personal {{agent.name}}',scope:{visibility:'personal',roles:[],groups:[],brands:[]}},'operator')
  assert.equal((await call(`/macros/${personal.id}`)).status,404)
  const privateAction=await ok('/macros',{title:'Private field',content:'Hello',actions:{fields:{[privateField.id]:'manager-only'}}})
  assert.equal((await run(privateAction,'apply',[{id,expected_version:(await get(id)).ticket_version}],{command_id:'field-refused'},'operator')).results[0].status,'forbidden')
  const note=await ok('/macros',{title:'Return note',content:'Order {{ticket.id}} reviewed',actions:{reply_type:'note',attachments:[upload.id]}})
  const noteDraft=(await run(note,'apply',[{id,expected_version:(await get(id)).ticket_version}],{command_id:'note-draft'})).results[0].draft
  assert.equal(noteDraft.reply_type,'note');assert.equal(noteDraft.media_ids.length,1)
  const savedNote=await ok(`/conversations/${id}/notes`,{content:noteDraft.content,media_ids:noteDraft.media_ids})
  assert.equal(savedNote.media.length,1)
  assert.ok(!(await app.ok(`/api/conversations/${id}/messages`,{token:visitor.token})).messages.some(m=>m.content===noteDraft.content),'macro note stays private')
  await ok(`/contacts/${absent.contactId}`,{name:'Label Owner',email:'label-owner@example.test'},'owner','PUT')
  const literalReply=await ok('/macros',{title:'Personal return',content:'Hello Label Owner, your return is approved.'})
  const privateUpload=await app.ok(`/api/conversations/${emptyNameTicket.id}/media`,{token:w.tokens.owner,raw:true,headers:{'Content-Type':'text/plain','X-Filename':'private-return-label.txt'},body:'Customer return label that must be erased.'})
  const attached=await ok('/macros',{title:'Attach return label',content:'The return label is attached.',actions:{reply_type:'note',attachments:[privateUpload.id]}})
  const copied=(await run(attached,'apply',[{id,expected_version:(await get(id)).ticket_version}],{command_id:'source-linked-copy'})).results[0].draft
  const copyId=copied.media_ids[0],copyRow=await app.first('SELECT object_key FROM media WHERE id=?',copyId),bucket=await app.files
  assert.ok(await bucket.get(copyRow.object_key))
  await ok(`/conversations/${id}/notes`,{content:copied.content,media_ids:copied.media_ids})
  await app.ok(`/api/management/projects/${w.projectId}/contacts/${absent.contactId}/erase`,{token:w.tokens.owner,body:{}})
  assert.equal(await app.first('SELECT id FROM media WHERE id=?',copyId),null)
  assert.equal((await app.first('SELECT content FROM macros WHERE id=?',literalReply.id)).content,'')
  assert.equal((await call(`/macros/${literalReply.id}`)).status,404)
  assert.equal(await bucket.get(copyRow.object_key),null)
  assert.equal((await ok(`/macros/${attached.id}`)).actions.attachments.length,0)
  assert.equal((await app.first('SELECT count(*) n FROM macro_attachment_copies WHERE source_contact_id=?',absent.contactId)).n,0)
  const fieldMacro=await ok('/macros',{title:'Set replacement reference',content:'Reference {{ticket.custom.'+field.id+'}}',actions:{fields:{[field.id]:'RMA-456'}}})
  const fieldBefore=(await get(id)).fields[field.id]
  const fieldRace=await app.call(`${f.base}/macros/${fieldMacro.id}/apply`,{token:w.tokens.operator,body:{version:fieldMacro.version,tickets:[{id,expected_version:(await get(id)).ticket_version}],command_id:'field-role-changed-at-commit'},headers:{'x-test-before-statement':`UPDATE ticket_fields SET write_roles_json='["owner"]',updated_at=updated_at+1 WHERE id='${field.id}'`,'x-test-statement':'INSERT INTO macro_usage'}})
  assert.equal(fieldRace.data.data.results[0].status,'stale')
  assert.equal((await get(id)).fields[field.id],fieldBefore)
  const raceTicket=tickets[0].id,current=await get(raceTicket)
  const race=await app.call(`${f.base}/macros/${v2.id}/apply`,{token:w.tokens.owner,body:{version:v2.version,tickets:[{id:raceTicket,expected_version:current.ticket_version}],command_id:'revoked-at-commit'},headers:{'x-test-before-statement':`UPDATE sessions SET revoked_at=1 WHERE actor_id='${w.users.owner}'`,'x-test-statement':'INSERT INTO macro_usage'}})
  assert.equal(race.data.data.results[0].status,'stale');assert.equal((await app.first('SELECT priority FROM conversations WHERE id=?',raceTicket)).priority,'normal')
 }finally{await app.close()}
}
