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
