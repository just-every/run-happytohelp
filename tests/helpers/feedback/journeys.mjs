import assert from 'node:assert/strict'
import {createHmac,randomBytes} from 'node:crypto'
import {startApp} from '../../journeys/kit/app.mjs'

// One two-requester journey from customer quotes to approved handoff, release and erasure.
// Only Penny's network boundary is a fixture; every command uses the native public API.
export async function feedbackJourney(){
 const pennyCalls=[],failures=[],sockets=[]
 const app=await startApp({outbound:async(request,entry)=>{
  assert.equal(new URL(request.url).origin,'https://penny.example.com')
  pennyCalls.push(entry)
  if(failures.shift())throw Error('Provider receipt lost')
  return Response.json({requesterId:String(pennyCalls.length).padStart(26,'0'),created:true})
 },bindings:{INTEGRATION_ENCRYPTION_KEY:randomBytes(32).toString('base64')}})
 try{
  const ws=await app.seedWorkspace('feedback'),foreign=await app.seedWorkspace('feedback-foreign'),token=ws.tokens.owner
  await app.presenceAwayOff(ws.projectId)
  const base=`/api/feedback/projects/${ws.projectId}`,records=[]
  const call=(path,body,options={})=>app.ok(base+path,{token,body,...options})
  const root=r=>`/conversations/${r.conversation.id}`,snapshot=r=>call(root(r))
  const penny='https://penny.example.com/portal/feedback/export-progress',issue='https://vector.example.test/issues/export-progress'
  const capture=(r,extra={})=>call(root(r),{message_id:r.message.id,penny_url:penny,issue_url:issue,...extra})
  for(let i=0;i<2;i++){
   const headers={Origin:ws.allowedOrigin,'CF-Connecting-IP':`198.51.100.${40+i}`}
   const visitor=await app.ok('/api/identity/widget/session',{headers,body:{widgetKey:ws.widgetKey,name:`Requester ${i}`,email:`feedback-${i}@example.test`}})
   const conversation=await app.ok('/api/conversations',{token:visitor.token,headers,body:{projectId:ws.projectId}})
   const send=async(content,localId)=>{const current=await app.ok('/api/conversations/'+conversation.id,{token});return app.ok(`/api/conversations/${conversation.id}/messages`,{token:visitor.token,headers,body:{content,localId,expectedRevision:current.revision,expectedLastMessageId:current.last_message_id}})}
   const opening=await send(`Export ${i} hangs. Please keep me informed about this fix.`,'opening')
   const consent=await send('Yes, share my quote and name with Penny and send me a service update here when the export fix ships.','consent')
   records.push({visitor,conversation,message:opening.message,consent:consent.message,send})
  }
  const [first,second]=records
  const company=await app.ok(`/api/management/projects/${ws.projectId}/companies`,{token,body:{name:'Export customer account'}})
  await app.db.prepare('INSERT INTO contact_companies(project_id,contact_id,company_id) VALUES(?,?,?)').bind(ws.projectId,first.visitor.contactId,company.company.id).run()
  for(const r of records){r.source=(await capture(r)).data;assert.equal(r.source.quote,r.message.content);assert.equal(r.source.contact_id,r.visitor.contactId);assert.equal(r.source.subscribed,0)}
  assert.equal((await snapshot(first)).data[0].account_id,company.company.id)
  assert.ok((await Promise.all([capture(first),capture(first)])).every(r=>r.duplicate))
  assert.equal((await snapshot(first)).data.length,1)
  assert.equal((await app.call(base+root(first),{token,body:{message_id:second.message.id,penny_url:penny,issue_url:issue}})).status,400)
  const frontier=await app.ok('/api/conversations/'+first.conversation.id,{token})
  const operator=await app.ok(`/api/conversations/${first.conversation.id}/messages`,{token,body:{content:'Private operator comment is not a customer quote',localId:'operator',expectedRevision:frontier.revision}})
  assert.equal((await app.call(base+root(first),{token,body:{message_id:operator.message.id,penny_url:penny,issue_url:issue}})).status,400)
  assert.equal((await app.call(base+root(first),{token:foreign.tokens.owner})).status,403)
  await app.db.prepare("INSERT INTO member_roles VALUES(?,?,'collaborator',?)").bind(ws.projectId,ws.users.operator,Date.now()).run()
  assert.equal((await app.call(base+root(first),{token:ws.tokens.operator,body:{message_id:first.message.id,penny_url:penny,issue_url:issue}})).status,403)

  const key='synthetic-happytohelp-2-penny-api-key'
  await call('/penny-connection',{origin:'https://penny.example.com',token:key},{method:'PUT'})
  assert.ok(!JSON.stringify(await call('/penny-connection')).includes(key))
  assert.equal(pennyCalls.length,0,'linking shares nothing before approval')
  for(const r of records){
   const path=root(r)+`/sources/${r.source.id}`
   let preview=await call(path+'/handoff-preview')
   assert.ok(preview.data.source.includes(r.message.content))
   assert.ok(!JSON.stringify(preview.data).includes('@example.test'))
   assert.equal((await app.call(base+path+'/handoff',{token,body:{approve:false,sharing_message_id:r.consent.id}})).status,400)
   assert.equal((await app.call(base+path+'/handoff',{token,body:{approve:true,sharing_message_id:records.find(x=>x!==r).consent.id,preview_hash:preview.preview_hash}})).status,400)
   if(r===first){
    await app.db.prepare('UPDATE contacts SET name=? WHERE id=?').bind('Updated requester name',r.visitor.contactId).run()
    assert.equal((await app.call(base+path+'/handoff',{token,body:{approve:true,sharing_message_id:r.consent.id,preview_hash:preview.preview_hash}})).status,409)
    assert.equal(pennyCalls.length,0)
    preview=await call(path+'/handoff-preview')
   }
   const approved={approve:true,sharing_message_id:r.consent.id,preview_hash:preview.preview_hash}
   assert.equal((await call(path+'/handoff',approved)).accepted,true)
   assert.equal((await call(path+'/handoff',approved)).duplicate,true)
  }
  assert.equal(pennyCalls.length,2)
  for(const entry of pennyCalls){const payload=JSON.parse(entry.body);assert.ok(payload.sourceUrl.includes('/conversations/'));assert.ok(payload.contact.displayName);assert.equal(payload.contact.email,undefined)}

  const secret='synthetic-happytohelp-1-release-signing-secret'
  await call('/settings',{secret},{method:'PUT'})
  assert.ok(!JSON.stringify(await call('/settings')).includes(secret))
  const event=id=>({id,issue_url:issue,release_url:'https://releases.example.test/export-fixed',released_at:new Date().toISOString()})
  const release=body=>{const raw=JSON.stringify(body),signature=createHmac('sha256',secret).update(raw).digest('hex');return app.call('/api/feedback/releases/'+ws.projectId,{raw:true,body:raw,headers:{'Content-Type':'application/json','X-HappyToHelp-Signature':signature}})}
  assert.equal((await release(event('before-consent'))).data.updates,0)
  for(const r of records)await call(root(r)+`/sources/${r.source.id}/preference`,{subscribed:true,preference_message_id:r.consent.id},{method:'PUT'})
  assert.equal((await app.call('/api/feedback/releases/'+ws.projectId,{body:event('unsigned')})).status,401)
  const payload=event('release'),accepted=await release(payload)
  assert.equal(accepted.data.updates,2)
  assert.equal((await release(payload)).data.duplicate,true)
  assert.equal((await release({...payload,release_url:'https://releases.example.test/different'})).status,409)
  assert.equal((await snapshot(first)).updates[0].state,'draft')
  assert.equal((await app.first('SELECT count(*) n FROM messages WHERE conversation_id=?',first.conversation.id)).n,3,'release sends no customer message')
  const upgrade=await app.request(`/api/conversations/${first.conversation.id}/socket?token=${first.visitor.token}`,{headers:{Upgrade:'websocket',Origin:ws.allowedOrigin}})
  assert.equal(upgrade.status,101)
  const socket=upgrade.webSocket,frames=[];sockets.push(socket);socket.accept();socket.addEventListener('message',e=>frames.push(JSON.parse(e.data)))
  const draft=(await snapshot(first)).updates[0],current=await app.ok('/api/conversations/'+first.conversation.id,{token})
  const body={content:'The export fix shipped. Please try it and tell us if you still need help.',expectedRevision:current.revision,expectedLastMessageId:current.last_message_id,resolve:true}
  const sent=await call(root(first)+`/updates/${draft.id}/send`,body)
  assert.equal(sent.accepted,true)
  await app.until(()=>frames.some(f=>f.type==='message'&&f.message.id===sent.message.id),{message:'approved feedback update on visitor channel'})
  assert.equal((await call(root(first)+`/updates/${draft.id}/send`,body)).duplicate,true)
  assert.equal((await app.sql('SELECT id FROM messages WHERE conversation_id=? AND local_id=?',first.conversation.id,'feedback:'+draft.id)).length,1)
  await first.send('It still fails for my account. Please keep this open.','still-failing')
  const conversation=await app.ok('/api/conversations/'+first.conversation.id,{token});assert.notEqual(conversation.status_category,'closed');assert.equal(conversation.resolved_at,null)
  const secondDraft=(await snapshot(second)).updates[0]
  await app.ok(`/api/feedback/conversations/${second.conversation.id}/opt-out`,{token:second.visitor.token,body:{}})
  assert.equal((await snapshot(second)).updates[0].state,'cancelled')
  assert.equal((await app.call(base+root(second)+`/updates/${secondDraft.id}/send`,{token,body:{content:'Must not send',expectedRevision:0}})).status,409)
  assert.equal((await release(event('next-release'))).data.updates,1)

  // A lost provider receipt remains uncertain, including a repeat after restart.
  const extra=(await capture(first,{message_id:first.consent.id})).data,path=root(first)+`/sources/${extra.id}`
  const preview=await call(path+'/handoff-preview'),handoff={approve:true,sharing_message_id:first.consent.id,preview_hash:preview.preview_hash}
  failures.push(true)
  assert.equal((await app.call(base+path+'/handoff',{token,body:handoff})).status,409)
  await app.configure({})
  assert.equal((await app.call(base+path+'/handoff',{token,body:handoff})).status,409)
  assert.equal(pennyCalls.length,3)
  assert.ok(JSON.parse(pennyCalls[2].body).requesterId)
  await app.ok(`/api/management/projects/${ws.projectId}/contacts/${first.visitor.contactId}/erase`,{token,body:{}})
  assert.equal((await app.sql('SELECT id FROM feedback_sources WHERE contact_id=?',first.visitor.contactId)).length,0)
  assert.equal((await app.sql('SELECT * FROM feedback_penny_requesters WHERE contact_id=?',first.visitor.contactId)).length,0)
  assert.equal((await app.sql('SELECT * FROM feedback_handoffs WHERE source_id IN (?,?)',first.source.id,extra.id)).length,0)
  assert.equal((await snapshot(second)).data[0].handoff_state,'accepted')
  assert.equal((await app.call(base+root(first),{token,body:{message_id:first.message.id,penny_url:penny,issue_url:issue}})).status,404)
  const report=await app.ok(`/api/management/projects/${ws.projectId}/contacts/${first.visitor.contactId}/erasure`,{token})
  assert.ok(report.data.providers.requests.some(r=>r.store==='feedback:linked_records'&&r.state==='unsupported'))
  assert.equal((await release(event('after-erasure'))).data.updates,0)
  await call('/penny-connection',{revoke:true},{method:'PUT'})
  assert.equal((await app.call(base+root(second)+`/sources/${second.source.id}/handoff-preview`,{token})).status,409)
  await call('/settings',{revoke:true},{method:'PUT'})
  assert.equal((await release(event('revoked'))).status,401)
  const audit=await app.sql("SELECT action,detail_json FROM audit_events WHERE action LIKE 'feedback.%'")
  assert.ok(audit.some(row=>row.action==='feedback.update_approved'))
  assert.ok(!JSON.stringify(audit).includes(first.message.content))
 }finally{for(const socket of sockets)socket.close();await app.close()}
}
