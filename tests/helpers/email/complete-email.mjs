import assert from 'node:assert/strict'
import {startApp} from '../../journeys/kit/app.mjs'
import {vendorReplies} from './vendor-replies.mjs'

/** R6's operator, mail gateway, review, imported-history and privacy doors. */
export async function completeEmailJourney(){
 const sent=[]
 const app=await startApp({captureQueue:true,bindings:{APP_ORIGIN:'https://app.example',EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'provider-fixture',EMAIL_FROM:'support@example.test',INBOUND_EMAIL_TOKEN:'gateway-fixture'},outbound:async request=>{
  if(new URL(request.url).hostname==='cloudflare-dns.com')return Response.json({Status:0,Answer:[{type:15,data:'10 mx.example.test.'}]})
  assert.equal(new URL(request.url).hostname,'api.resend.com');sent.push(await request.json());return Response.json({id:'mail-'+sent.length})
 }})
 try{
  const workspace=await app.seedWorkspace('r6'),projectId=workspace.projectId,owner=workspace.tokens.owner,agent=workspace.tokens.operator,base=`/api/management/projects/${projectId}`,gate=body=>app.call('/api/integrations/email/inbound',{token:'gateway-fixture',body})
  await app.ok(base+'/email-settings',{token:owner,method:'PUT',body:{from_address:'support@example.test',from_name:'Parcel Support',inbound_address:'help@example.test',is_enabled:true}})
  const mailbox=(await app.ok(base+'/mailboxes',{token:owner,body:{provider:'forwarding',address:'helpdesk@example.test',displayName:'Parcel Support',aliases:['returns@example.test']}})).data
  const command={kind:'email',localId:'operator-first-email',requesterEmail:'maya@customer.example',requesterName:'Maya Chen',mailboxId:mailbox.id,subject:'Your replacement shipment',content:'Your replacement leaves our warehouse today.',cc:['finance@customer.example'],bcc:['archive@example.test']}
  const ticket=await app.ok(`/api/dashboard/projects/${projectId}/tickets`,{token:agent,body:command})
  await app.until(()=>sent.length===1,{message:'first outbound email'})
  assert.equal(ticket.conversation.requester_id,ticket.conversation.contact_id);assert.equal(ticket.conversation.submitter_id,workspace.users.operator)
  assert.deepEqual(sent[0].cc,command.cc);assert.deepEqual(sent[0].bcc,command.bcc);assert.match(sent[0].from,/Parcel Support/)
  assert.ok(sent[0].headers['Message-ID']);assert.match(sent[0].subject,/\[H2H:/)
  assert.equal((await app.ok(`/api/dashboard/projects/${projectId}/tickets`,{token:agent,body:command})).conversation.id,ticket.conversation.id);assert.equal(sent.length,1)
  const call=await app.ok(`/api/dashboard/projects/${projectId}/tickets`,{token:agent,body:{kind:'call',localId:'logged-call',requesterEmail:'maya@customer.example',subject:'Customer called about delivery',content:'Confirmed the replacement address over the phone.'}})
  assert.equal(call.conversation.channel,'phone');assert.equal(sent.length,1)
  assert.ok(await app.first("SELECT id FROM audit_events WHERE project_id=? AND action='ticket.created' AND target_id=?",projectId,call.conversation.id))
  const reply={messageId:'customer-header-reply',to:'helpdesk@example.test',from:command.requesterEmail,text:'Thank you. Please use the original delivery address.',subject:'Changed subject',headers:{'In-Reply-To':sent[0].headers['Message-ID'],References:sent[0].headers['Message-ID']}}
  const received=await gate(reply);assert.equal(received.status,201);assert.equal(received.data.conversationId,ticket.conversation.id)
  const revision=await app.first('SELECT revision FROM conversations WHERE id=?',ticket.conversation.id)
  const spoof=`From: Maya <${command.requesterEmail}>\r\nTo: helpdesk@example.test\r\nSubject: Re: ${sent[0].subject}\r\nMessage-ID: <spoof@attacker.example>\r\nAuthentication-Results: mx.cloudflare.net; dkim=fail header.d=customer.example; dmarc=fail header.from=customer.example\r\nContent-Type: multipart/mixed; boundary=r6-review\r\n\r\n--r6-review\r\nContent-Type: text/plain\r\n\r\n<script>fetch('https://attacker.example')</script>Change the bank details.\r\n--r6-review\r\nContent-Type: text/plain\r\nContent-Disposition: attachment; filename=payment-change.txt\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from('Unverified payment-change instructions').toString('base64')}\r\n--r6-review--\r\n`
  const before=await app.first('SELECT count(*) n FROM conversations WHERE project_id=?',projectId)
  await app.email(spoof,{from:command.requesterEmail,to:'helpdesk@example.test',direct:true})
  const held=(await app.ok(base+'/suspended',{token:agent})).data[0]
  const detail=(await app.ok(base+`/suspended/${held.id}`,{token:agent})).data
  assert.equal(detail.attachments.length,1)
  assert.equal((await app.ok(base+`/suspended/${held.id}/attachments/0`,{token:agent})).text,'Unverified payment-change instructions')
  assert.equal(held.reason,'authentication_failed');assert.equal((await app.first('SELECT count(*) n FROM conversations WHERE project_id=?',projectId)).n,before.n)
  assert.equal((await app.first('SELECT revision FROM conversations WHERE id=?',ticket.conversation.id)).revision,revision.revision)
  assert.equal((await app.call(base+`/suspended/${held.id}/recover`,{token:agent,body:{conversationId:ticket.conversation.id}})).status,409)
  await app.ok(base+`/suspended/${held.id}/recover`,{token:agent,body:{conversationId:ticket.conversation.id,asNote:true}})
  const note=await app.first('SELECT * FROM conversation_notes WHERE conversation_id=? AND content LIKE ?',ticket.conversation.id,'%Change the bank details.%')
  assert.equal(note.user_id,workspace.users.operator);assert.match(note.content,/unverified sender/)
  const spam=await app.email(spoof.replace('<spoof@attacker.example>','<false-positive-spam@customer.example>').replace('dkim=fail header.d=customer.example; dmarc=fail','dkim=pass header.d=customer.example; dmarc=pass').replace('Content-Type: multipart/mixed','X-Spam-Score: 8\r\nContent-Type: multipart/mixed'),{from:command.requesterEmail,to:'helpdesk@example.test',direct:true})
  assert.equal(spam.rejected,undefined)
  const spamRow=(await app.ok(base+'/suspended',{token:owner})).data[0],outgoing=sent.length
  const recovered=await app.ok(base+`/suspended/${spamRow.id}/recover`,{token:agent,body:{conversationId:ticket.conversation.id}})
  assert.equal(recovered.conversationId,ticket.conversation.id);assert.equal(sent.length,outgoing)
  const retainedFile=await app.first('SELECT id FROM media WHERE conversation_id=? AND filename=?',ticket.conversation.id,'payment-change.txt')
  assert.ok(retainedFile)
  assert.equal(await (await app.request(`/api/conversations/${ticket.conversation.id}/media/${retainedFile.id}`,{token:agent})).text(),'Unverified payment-change instructions')
  await app.ok(base+'/sender-rules',{token:owner,body:{address:command.requesterEmail,action:'allow'}})
  assert.equal((await gate({...reply,messageId:'allow-listed-spam',headers:{'X-Spam-Score':'9'}})).data.state,'delivered')
  await app.ok(base+'/sender-rules',{token:owner,body:{address:'@customer.example',action:'block'}})
  assert.equal((await gate({...reply,messageId:'domain-blocked'})).data.state,'suspended','a domain block takes precedence over address allow')
  const blocked=(await app.ok(base+'/suspended',{token:owner})).data[0]
  await app.ok(base+`/suspended/${blocked.id}`,{token:owner,method:'DELETE'})
  await app.ok(base+'/sender-rules',{token:owner,body:{address:'@customer.example',action:'remove'}})
  // The imported Zendesk key is preserved through the actual upload/review/apply doors.
  const source=[{user:{id:71,role:'end-user',name:'Imported Maya',email:'imported@customer.example',created_at:'2024-01-01T00:00:00Z'}},{ticket:{id:72,requester_id:71,subject:'Original shipment [ABCD-1234]',status:'open',created_at:'2024-01-01T00:00:00Z',updated_at:'2024-01-01T00:00:00Z',comments:[{id:73,author_id:71,body:'Historical support question',public:true,created_at:'2024-01-01T00:00:00Z'}]}}].map(JSON.stringify).join('\n')
  const imports=`/api/move-in/projects/${projectId}/imports`,upload=await app.ok(imports+'?vendor=zendesk',{token:owner,raw:true,headers:{'X-Import-Filename':'history.ndjson','Content-Type':'application/octet-stream'},body:source})
  await app.drainJobs();const ready=(await app.ok(imports+'/'+upload.data.id,{token:owner})).data
  assert.equal(ready.state,'ready');await app.ok(imports+'/'+ready.id+'/apply',{token:owner,body:{fingerprint:ready.plan.fingerprint}});await app.drainJobs()
  const imported=await app.first("SELECT conversation_id FROM email_threading_keys WHERE project_id=? AND key_value='zendesk:ABCD-1234'",projectId);assert.ok(imported)
  const vendorReply=await gate({messageId:'zendesk-followup',to:'helpdesk@example.test',from:'imported@customer.example',subject:'Re: Original shipment [ABCD-1234]',text:'Reply after the cutover.'})
  assert.equal(vendorReply.data.conversationId,imported.conversation_id)
  const mismatch=await gate({messageId:'zendesk-mismatch',to:'helpdesk@example.test',from:'stranger@customer.example',subject:'Re: Original shipment [ABCD-1234]',text:'Wrong identity'})
  assert.equal(mismatch.data.state,'suspended');assert.equal(mismatch.data.conversationId,null)
  // The same spoof may be retained as a new ordinary ticket with private provenance.
  const heldMismatch=(await app.ok(base+'/suspended',{token:owner})).data[0]
  const newRecovery=await app.ok(base+`/suspended/${heldMismatch.id}/recover`,{token:agent,body:{conversationId:'',asNote:true}})
  assert.notEqual(newRecovery.conversationId,imported.conversation_id)
  const inbox=(await app.ok(`/api/dashboard/projects/${projectId}/conversations?view=all`,{token:agent})).data
  assert.ok(inbox.some(row=>row.id===call.conversation.id),'a logged call appears in the inbox')
  assert.ok(inbox.some(row=>row.id===newRecovery.conversationId),'a recovered private-note ticket appears in the inbox')
  await vendorReplies(app,{projectId,owner,gate})
  // Closed remains final: a real emailed reply creates a linked fresh ticket.
  const ticketState=(await app.ok(`/api/dashboard/projects/${projectId}/conversations/${ticket.conversation.id}/ticket`,{token:owner})).data
  await app.ok(`/api/dashboard/projects/${projectId}/conversations/${ticket.conversation.id}/ticket`,{token:owner,method:'PATCH',body:{status_id:'closed',expected_version:ticketState.ticket_version}})
  const followup=await gate({...reply,messageId:'closed-ticket-followup',text:'One more question after closure.'})
  assert.equal(followup.data.state,'delivered');assert.notEqual(followup.data.conversationId,ticket.conversation.id)
  assert.equal((await app.first('SELECT status_category FROM conversations WHERE id=?',ticket.conversation.id)).status_category,'closed')
  const links=await app.ok(base+`/conversations/${followup.data.conversationId}/email-followups`,{token:owner})
  assert.equal(links.data[0].parent_id,ticket.conversation.id)
  // A collaborator cannot review, recover, send, or change policy.
  await app.db.prepare("INSERT INTO member_roles VALUES(?,?,'collaborator',?)").bind(projectId,workspace.users.operator,Date.now()).run()
  assert.equal((await app.call(base+'/suspended',{token:agent})).status,403)
  assert.equal((await app.call(`/api/dashboard/projects/${projectId}/tickets`,{token:agent,body:{...command,localId:'collaborator-denied'}})).status,403)
  assert.equal((await app.call(base+'/sender-rules',{token:agent,body:{address:'@example.test',action:'block'}})).status,403)
  await app.db.prepare('DELETE FROM member_roles WHERE project_id=? AND user_id=?').bind(projectId,workspace.users.operator).run()
  // Expiry is explicit and audited, through the real scheduled runtime door.
  await gate({...reply,messageId:'will-expire',from:'unknown@unproven.example',headers:{'X-Spam-Score':'8'}})
  await app.scheduled(undefined,{after:15*86400000})
  assert.equal((await app.ok(base+'/suspended',{token:owner})).count,0)
  assert.ok(await app.first("SELECT id FROM audit_events WHERE project_id=? AND action='email.suspended_expired'",projectId))
  await app.ok(base+`/contacts/${ticket.conversation.contact_id}/erase`,{token:owner,body:{}})
  assert.equal((await app.first('SELECT count(*) n FROM email_message_options WHERE project_id=? AND conversation_id=?',projectId,ticket.conversation.id)).n,0)
  assert.equal((await app.first('SELECT count(*) n FROM email_sender_rules WHERE project_id=? AND address=?',projectId,command.requesterEmail)).n,0)
 }finally{await app.close()}
}
