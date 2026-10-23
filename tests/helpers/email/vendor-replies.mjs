import assert from 'node:assert/strict'
import {vendorNotifications} from './vendor-notifications.mjs'
import {notificationCustody} from './notification-custody.mjs'

/** Explicit export fields, imported through upload/review/apply, then real mail intake. */
export async function vendorReplies(app,{projectId,owner,agent,gate,sent}){
 const fixtures=vendorNotifications()
 const imports=`/api/move-in/projects/${projectId}/imports`
 for(const fixture of fixtures){
  const payload=fixture.vendor==='zendesk'||fixture.vendor==='freshdesk'?fixture.rows.find(row=>row.ticket).ticket:fixture.vendor==='helpscout'?fixture.rows[1]:fixture.rows[1].source
  const notificationId=`<old-${fixture.vendor}-notification@notify.example.test>`
  payload.headers={'Message-ID':notificationId}
  if(fixture.vendor==='freshdesk')fixture.rows.push({ticket:{...structuredClone(payload),id:821,status:5,reply_to:'helpdesk+freshdesk-821@example.test',headers:{'Message-ID':'<old-freshdesk-final@notify.example.test>'}}})
  const upload=await app.ok(imports+'?vendor='+fixture.vendor,{token:owner,raw:true,headers:{'X-Import-Filename':fixture.vendor+'.jsonl','Content-Type':'application/octet-stream',...(fixture.schema?{'X-Import-Schema':fixture.schema}:{})},body:fixture.rows.map(JSON.stringify).join('\n')})
  await app.drainJobs();const ready=(await app.ok(imports+'/'+upload.data.id,{token:owner})).data
  assert.equal(ready.state,'ready',fixture.vendor);assert.equal(ready.plan.counts.rejected,0,JSON.stringify(ready.plan))
  await app.ok(imports+'/'+ready.id+'/apply',{token:owner,body:{fingerprint:ready.plan.fingerprint}});await app.drainJobs()
  const ownership=imports+'/'+ready.id+'/ownership',identity=await app.ok('/api/identity/session',{token:owner}),nativeOwner=identity.id
  const group=(await app.ok(`/api/dashboard/projects/${projectId}/ticket-groups`,{token:owner,body:{name:fixture.vendor+' migrated team',members:[nativeOwner]}})).data
  const bindings={owners:{'77':nativeOwner},groups:fixture.vendor==='helpscout'?{}:{'88':group.id}},beforeSends=sent.length
  const preview=await app.ok(ownership+'/preview',{token:owner,body:bindings});assert.ok(preview.tickets.length>0);assert.equal(sent.length,beforeSends)
  assert.equal((await app.call(ownership+'/apply',{token:agent,body:{bindings,fingerprint:preview.fingerprint}})).status,403,'an operator cannot activate historical ownership')
  if(fixture.vendor==='zendesk'){
   await app.ok(`/api/dashboard/projects/${projectId}/ticket-groups/${group.id}`,{token:owner,method:'PATCH',body:{name:group.name,members:[]}})
   assert.ok([400,409].includes((await app.call(ownership+'/apply',{token:owner,body:{bindings,fingerprint:preview.fingerprint}})).status))
   assert.equal((await app.first('SELECT count(*) n FROM conversations c JOIN move_in_origins o ON o.target_id=c.id WHERE o.vendor=? AND c.assigned_to IS NOT NULL',fixture.vendor)).n,0)
   await app.ok(`/api/dashboard/projects/${projectId}/ticket-groups/${group.id}`,{token:owner,method:'PATCH',body:{name:group.name,members:[nativeOwner]}})
  }
  const currentPreview=await app.ok(ownership+'/preview',{token:owner,body:bindings})
  const activated=await app.ok(ownership+'/apply',{token:owner,body:{bindings,fingerprint:currentPreview.fingerprint}})
  assert.equal(activated.applied,currentPreview.tickets.length);assert.equal(activated.remaining,0);assert.equal(sent.length,beforeSends,'ownership activation sends no mail')
  const imported=await app.first('SELECT conversation_id FROM email_threading_keys WHERE project_id=? AND source=? AND key_value=?',projectId,fixture.vendor,fixture.vendor==='freshdesk'?'freshdesk:820':fixture.to)
  assert.ok(imported,fixture.vendor+' imported its explicit threading key')
  if(fixture.vendor==='freshdesk'){
   const final=await app.first("SELECT conversation_id FROM email_threading_keys WHERE project_id=? AND source='freshdesk' AND key_value='helpdesk+freshdesk-821@example.test'",projectId)
   assert.equal((await app.ok(`/api/dashboard/projects/${projectId}/conversations/${final.conversation_id}/ticket`,{token:owner})).data.status_category,'closed')
   const linked=await gate({messageId:'freshdesk-source-final',from:fixture.email,to:'helpdesk@example.test',headers:{'In-Reply-To':'<old-freshdesk-final@notify.example.test>'},text:'A new question after source final closure.'})
   assert.equal(linked.data.state,'delivered');assert.notEqual(linked.data.conversationId,final.conversation_id)
   assert.ok(JSON.stringify(await app.ok(`/api/management/projects/${projectId}/conversations/${linked.data.conversationId}/email-followups`,{token:owner})).includes(final.conversation_id))
  }
  const ticketPath=`/api/dashboard/projects/${projectId}/conversations/${imported.conversation_id}/ticket`
  const beforeReply=(await app.ok(ticketPath,{token:owner})).data
  assert.equal(beforeReply.assigned_to,nativeOwner,fixture.vendor+' owner is explicitly migrated');assert.equal(beforeReply.group_id,fixture.vendor==='helpscout'?null:group.id,fixture.vendor+' group is explicitly migrated');assert.equal(beforeReply.status_category,'solved',fixture.vendor+' reopenable source resolution is retained')
  assert.equal(beforeReply.channel,'email',fixture.vendor+' source channel is retained')
  const byHeaders=await gate({messageId:fixture.vendor+'-headers-only',from:fixture.email,to:'helpdesk@example.test',subject:'An entirely changed subject',headers:{'In-Reply-To':notificationId,References:notificationId},text:'Reply using only the old notification headers.'})
  assert.equal(byHeaders.data.state,'delivered');assert.equal(byHeaders.data.conversationId,imported.conversation_id,fixture.vendor+' Message-ID threading')
  const reopened=(await app.ok(ticketPath,{token:owner})).data
  assert.equal(reopened.status_category,'open');assert.equal(reopened.assigned_to,beforeReply.assigned_to);assert.equal(reopened.group_id,beforeReply.group_id);assert.equal(reopened.contact_id,beforeReply.contact_id)
  if(fixture.vendor!=='intercom'){
   const bySubject=await gate({messageId:fixture.vendor+'-subject-only',from:fixture.email,to:'helpdesk@example.test',subject:fixture.vendor==='helpscout'?'Shipment [#1901]':fixture.subject,text:'Reply using only the source subject token.'})
   assert.equal(bySubject.data.state,'delivered');assert.equal(bySubject.data.conversationId,imported.conversation_id,fixture.vendor+' subject-only threading')
  }
  const byAddress=await gate({messageId:fixture.vendor+'-address-only',from:fixture.email,to:fixture.to,subject:'No source subject token',text:'Reply using only the old reply address.'})
  assert.equal(byAddress.data.state,'delivered');assert.equal(byAddress.data.conversationId,imported.conversation_id,fixture.vendor+' reply-address-only threading')
  const reply={messageId:fixture.vendor+'-cutover',from:fixture.email,to:fixture.to,subject:fixture.subject,text:'Reply to the old notification after cutover.'}
  const received=await gate(reply);assert.equal(received.data.state,'delivered',fixture.vendor);assert.equal(received.data.conversationId,imported.conversation_id)
  if(fixture.vendor==='helpscout'){
   const numbered=await gate({...reply,messageId:'helpscout-conversation-number',to:'helpdesk@example.test',subject:'Re: Shipment [#1901]'})
   assert.equal(numbered.data.state,'delivered');assert.equal(numbered.data.conversationId,imported.conversation_id,'the exported conversation number is distinct from its API id')
   const wrongNumber=await gate({...reply,messageId:'helpscout-api-id-is-not-number',to:'helpdesk@example.test',subject:'Re: Shipment [#901]'})
   assert.notEqual(wrongNumber.data.conversationId,imported.conversation_id,'an API id is never guessed to be a notification number')
  }
  const mismatch=await gate({...reply,messageId:fixture.vendor+'-wrong-customer',from:'stranger@customer.example'})
  assert.equal(mismatch.data.state,'suspended',fixture.vendor+' identity mismatch');assert.equal(mismatch.data.conversationId,null)
  const header=fixture.vendor==='zendesk'?'X-Zendesk-Ticket-Id':fixture.vendor==='freshdesk'?'X-Freshdesk-Ticket-Id':fixture.vendor==='helpscout'?'X-HS-Conversation-Id':'X-Intercom-Conversation-Id'
  const unmatched=await gate({...reply,messageId:fixture.vendor+'-unmatched',subject:fixture.vendor==='freshdesk'?'Order [#4521] never arrived':'Reply after the move',to:'helpdesk@example.test',headers:{[header]:'unmatched-old-ticket'}})
  assert.equal(unmatched.data.state,'delivered',fixture.vendor+' unmatched reply becomes a ticket');assert.notEqual(unmatched.data.conversationId,imported.conversation_id)
  assert.ok((await app.ok(`/api/dashboard/projects/${projectId}/conversations/${unmatched.data.conversationId}/ticket`,{token:owner})).data.tags.some(tag=>tag.name==='Possible pre-migration reply'))
  // Native finality after cutover uses the imported keys too. It never appends
  // to a Closed ticket; the customer gets its linked native follow-up.
  const current=(await app.ok(ticketPath,{token:owner})).data
  await app.ok(ticketPath,{token:owner,method:'PATCH',body:{status_id:'closed',expected_version:current.ticket_version}})
  const followup=await gate({messageId:fixture.vendor+'-closed-followup',from:fixture.email,to:'helpdesk@example.test',headers:{'In-Reply-To':notificationId},text:'A new question after final closure.'})
  assert.equal(followup.data.state,'delivered');assert.notEqual(followup.data.conversationId,imported.conversation_id)
  assert.equal((await app.ok(ticketPath,{token:owner})).data.status_category,'closed')
  const links=await app.ok(`/api/management/projects/${projectId}/conversations/${followup.data.conversationId}/email-followups`,{token:owner})
  assert.ok(JSON.stringify(links).includes(imported.conversation_id),fixture.vendor+' follow-up keeps its original link')

 }
 await notificationCustody(app)
}
