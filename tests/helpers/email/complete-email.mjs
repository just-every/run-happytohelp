import assert from 'node:assert/strict'
import {startApp} from '../../journeys/kit/app.mjs'
import {vendorReplies} from './vendor-replies.mjs'
import {message} from './app.mjs'

/** R6's operator, mail gateway, review, imported-history and privacy doors. */
export async function completeEmailJourney(){
 await imapSmtpJourney()
 await outboundNoticesJourney()
 const sent=[]
 const app=await startApp({captureQueue:true,bindings:{APP_ORIGIN:'https://app.example',EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'provider-fixture',EMAIL_FROM:'support@example.test',INBOUND_EMAIL_TOKEN:'gateway-fixture'},outbound:async request=>{
  if(new URL(request.url).hostname==='cloudflare-dns.com')return Response.json({Status:0,Answer:[{type:15,data:'10 mx.example.test.'}]})
  assert.equal(new URL(request.url).hostname,'api.resend.com');const copy=await request.json();sent.push(copy);if(copy.text?.includes('synthetic-happytohelp-41'))return Response.json({error:'Recipient refused'},{status:422});return Response.json({id:'mail-'+sent.length})
 }})
 try{
  const workspace=await app.seedWorkspace('r6'),projectId=workspace.projectId,owner=workspace.tokens.owner,agent=workspace.tokens.operator,base=`/api/management/projects/${projectId}`,gate=body=>app.call('/api/integrations/email/inbound',{token:'gateway-fixture',body})
  await app.ok(base+'/email-settings',{token:owner,method:'PUT',body:{from_address:'support@example.test',from_name:'Parcel Support',inbound_address:'help@example.test',is_enabled:true}})
  const mailbox=(await app.ok(base+'/mailboxes',{token:owner,body:{provider:'forwarding',address:'helpdesk@example.test',displayName:'Parcel Support',aliases:['returns@example.test']}})).data
  const reconnected=await app.ok(base+`/mailboxes/${mailbox.id}/reconnect`,{token:owner,body:{}})
  assert.equal(reconnected.data.status,'connected');assert.ok(reconnected.data.addresses.some(alias=>alias.address==='returns@example.test'),'forwarding reconnect retains receiving aliases')
  await app.ok(base+`/mailboxes/${mailbox.id}/aliases`,{token:owner,body:{address:'helpdesk+returns@example.test'}})
  const plusMail=await gate({messageId:'plus-alias',from:'plus@customer.example',to:'helpdesk+returns@example.test',text:'Please help with this return.'})
  assert.equal(plusMail.data.state,'delivered','an exact configured plus alias takes precedence over thread suffix parsing')
  // Customer order references are ordinary mail in a workspace with no imports.
  for(const [index,subject] of ['Where is my parcel?','Order [#4521] never arrived','Return label [AB12-CD34] not working','Invoice [2026-1017] question'].entries()){
   const from=`customer-${index}@customer.example`,id=`customer-reference-${index}@customer.example`
   await app.email(message({id,to:'helpdesk@example.test',from,subject,text:'Please help with this order.'}),{from,to:'helpdesk@example.test',direct:true})
   const receipt=await app.first('SELECT state,conversation_id FROM inbound_emails WHERE id=?',`<${id}>`)
   assert.equal(receipt.state,'delivered',subject);assert.ok(receipt.conversation_id)
   assert.equal((await app.first('SELECT subject FROM conversations WHERE id=?',receipt.conversation_id)).subject,subject)
   assert.equal((await app.first('SELECT count(*) n FROM conversation_tags WHERE conversation_id=?',receipt.conversation_id)).n,0)
  }
  const command={kind:'email',localId:'operator-first-email',requesterEmail:'maya@customer.example',requesterName:'Maya Chen',mailboxId:mailbox.id,subject:'Your replacement shipment',content:'Your replacement leaves our warehouse today.',cc:['finance@customer.example'],bcc:['archive@example.test']}
  const ticket=await app.ok(`/api/dashboard/projects/${projectId}/tickets`,{token:agent,body:command})
  await app.until(()=>sent.length===1,{message:'first outbound email'})
  assert.equal(ticket.conversation.requester_id,ticket.conversation.contact_id);assert.equal(ticket.conversation.submitter_id,workspace.users.operator)
  assert.deepEqual(sent[0].cc,command.cc);assert.deepEqual(sent[0].bcc,command.bcc);assert.match(sent[0].from,/Parcel Support/)
  assert.ok(sent[0].headers['Message-ID']);assert.match(sent[0].subject,/\[H2H:/)
  assert.equal((await app.ok(`/api/dashboard/projects/${projectId}/tickets`,{token:agent,body:command})).conversation.id,ticket.conversation.id);assert.equal(sent.length,1)
  // Losing create/reply authority after route entry must also fence the durable
  // reservation, including its first email. The race is a real role write at D1.
  const deniedCommand={...command,localId:'synthetic-happytohelp-4',requesterEmail:'denied@customer.example'}
  const revoked=await app.call(`/api/dashboard/projects/${projectId}/tickets`,{token:agent,body:deniedCommand,headers:{'x-test-statement':'INSERT OR IGNORE INTO conversations','x-test-before-statement':`INSERT INTO member_roles(project_id,user_id,role_key,assigned_at) VALUES('${projectId}','${workspace.users.operator}','collaborator',1)`}})
  assert.equal(revoked.status,409,JSON.stringify(revoked.data))
  assert.equal((await app.first('SELECT count(*) n FROM operator_ticket_commands WHERE project_id=? AND local_id=?',projectId,deniedCommand.localId)).n,0)
  assert.equal((await app.first('SELECT count(*) n FROM conversations WHERE project_id=? AND subject=?',projectId,command.subject)).n,1,'revoked authority cannot create a second ticket')
  assert.equal(sent.length,1,'revoked authority cannot send a first comment')
  assert.equal((await app.call(`/api/dashboard/projects/${projectId}/tickets`,{token:agent,body:command})).status,403,'replaying an existing command still requires current authority')
  await app.db.prepare('DELETE FROM member_roles WHERE project_id=? AND user_id=?').bind(projectId,workspace.users.operator).run()
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
  await gate({messageId:'new-customer-false-positive',to:'helpdesk@example.test',from:'bea@customer.example',subject:'Return label [AB12-CD34] not working',text:'Please replace my return label.',headers:{'X-Spam-Score':'8'}})
  const newHeld=(await app.ok(base+'/suspended',{token:agent})).data.find(row=>row.from_address==='bea@customer.example')
  const newTicket=await app.ok(base+`/suspended/${newHeld.id}/recover`,{token:agent,body:{conversationId:'',asNote:false}})
  const customerMessage=await app.first('SELECT actor_role,content FROM messages WHERE conversation_id=?',newTicket.conversationId)
  assert.deepEqual(customerMessage,{actor_role:'contact',content:'Please replace my return label.'})
  assert.equal((await app.first('SELECT count(*) n FROM conversation_notes WHERE conversation_id=?',newTicket.conversationId)).n,0)
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
  for(const [index,subject] of ['Re: Shipment [Ticket #72]','Re: Shipment [Request #72]'].entries()){
   const numbered=await gate({messageId:'zendesk-number-'+index,to:'helpdesk@example.test',from:'imported@customer.example',subject,text:'Reply by the original ticket number.'})
   assert.equal(numbered.data.state,'delivered');assert.equal(numbered.data.conversationId,imported.conversation_id)
  }
  for(const [index,subject] of ['Return label [AB12-CD34] not working','Invoice [2026-1017] question'].entries()){
   const unknown=await gate({messageId:'unmatched-zendesk-'+index,to:'helpdesk@example.test',from:'imported@customer.example',subject,text:'An older reply after moving our support.'})
   assert.equal(unknown.data.state,'delivered');assert.notEqual(unknown.data.conversationId,imported.conversation_id)
   const ticketView=(await app.ok(`/api/dashboard/projects/${projectId}/conversations/${unknown.data.conversationId}/ticket`,{token:agent})).data
   assert.ok(ticketView.tags.some(tag=>tag.name==='Possible pre-migration reply'))
  }
  // Importing Zendesk does not turn Freshdesk-shaped order numbers into migration replies.
  const order=await gate({messageId:'order-number-after-zendesk',to:'helpdesk@example.test',from:'order@customer.example',subject:'Order [#4521] never arrived',text:'Where is my order?'})
  assert.equal(order.data.state,'delivered');assert.equal((await app.first('SELECT count(*) n FROM conversation_tags WHERE conversation_id=?',order.data.conversationId)).n,0)
  const mismatch=await gate({messageId:'zendesk-mismatch',to:'helpdesk@example.test',from:'stranger@customer.example',subject:'Re: Original shipment [ABCD-1234]',text:'Wrong identity'})
  assert.equal(mismatch.data.state,'suspended');assert.equal(mismatch.data.conversationId,null)
  // The same spoof may be retained as a new ordinary ticket with private provenance.
  const heldMismatch=(await app.ok(base+'/suspended',{token:owner})).data[0]
  const newRecovery=await app.ok(base+`/suspended/${heldMismatch.id}/recover`,{token:agent,body:{conversationId:'',asNote:true}})
  assert.notEqual(newRecovery.conversationId,imported.conversation_id)
  const inbox=(await app.ok(`/api/dashboard/projects/${projectId}/conversations?view=all`,{token:agent})).data
  assert.ok(inbox.some(row=>row.id===call.conversation.id),'a logged call appears in the inbox')
  assert.ok(inbox.some(row=>row.id===newRecovery.conversationId),'a recovered private-note ticket appears in the inbox')
  await vendorReplies(app,{projectId,owner,agent,gate,sent})
  // Selecting an existing requester never creates another contact. A refused
  // first send stays visible and retrying its exact command never sends again.
  const contactCount=(await app.first('SELECT count(*) n FROM contacts WHERE project_id=?',projectId)).n
  const existingCommand={kind:'email',localId:'synthetic-happytohelp-40',requesterId:ticket.conversation.contact_id,mailboxId:mailbox.id,subject:'Replacement status',content:'synthetic-happytohelp-41: Your replacement status is ready.'}
  const existing=await app.ok(`/api/dashboard/projects/${projectId}/tickets`,{token:agent,body:existingCommand})
  assert.equal(existing.conversation.contact_id,ticket.conversation.contact_id)
  assert.equal(existing.conversation.requester_id,ticket.conversation.contact_id);assert.equal(existing.conversation.submitter_id,workspace.users.operator)
  await app.until(async()=>(await app.ok(`/api/dashboard/projects/${projectId}/conversations/${existing.conversation.id}`,{token:agent})).data.last_message?.email_status?.state==='failed',{message:'refused outbound delivery recorded'})
  const repeated=await app.ok(`/api/dashboard/projects/${projectId}/tickets`,{token:agent,body:existingCommand})
  assert.equal(repeated.conversation.id,existing.conversation.id)
  assert.equal((await app.first('SELECT count(*) n FROM contacts WHERE project_id=?',projectId)).n,contactCount)
  assert.equal(sent.filter(copy=>copy.text?.includes('synthetic-happytohelp-41')).length,1)
  // Closed remains final: a real emailed reply creates a linked fresh ticket.
  const ticketState=(await app.ok(`/api/dashboard/projects/${projectId}/conversations/${ticket.conversation.id}/ticket`,{token:owner})).data
  await app.ok(`/api/dashboard/projects/${projectId}/conversations/${ticket.conversation.id}/ticket`,{token:owner,method:'PATCH',body:{status_id:'closed',expected_version:ticketState.ticket_version}})
  const followup=await gate({...reply,messageId:'closed-ticket-followup',text:'One more question after closure.'})
  assert.equal(followup.data.state,'delivered');assert.notEqual(followup.data.conversationId,ticket.conversation.id)
  assert.equal((await app.first('SELECT status_category FROM conversations WHERE id=?',ticket.conversation.id)).status_category,'closed')
  const links=await app.ok(base+`/conversations/${followup.data.conversationId}/email-followups`,{token:owner})
  assert.equal(links.data[0].parent_id,ticket.conversation.id)
  // The inbox rail counts held mail only for a member who may review it.
  const counts=`/api/dashboard/projects/${projectId}/conversations/counts`
  assert.equal((await app.ok(counts,{token:agent})).data.suspended,(await app.ok(base+'/suspended',{token:agent})).count)
  // A collaborator cannot review, recover, send, or change policy.
  await app.db.prepare("INSERT INTO member_roles VALUES(?,?,'collaborator',?)").bind(projectId,workspace.users.operator,Date.now()).run()
  assert.equal((await app.call(base+'/suspended',{token:agent})).status,403)
  assert.equal('suspended' in (await app.ok(counts,{token:agent})).data,false)
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

// Only cloudflare:sockets' TLS boundary is replaced. The real MailSocket,
// IMAP/SMTP parsers, encrypted connection store, sync, admission and send run in
// workerd. Every read is fragmented, including CRLF and a UTF-8 MIME literal.
function fakeTlsConnect(address,options){
 const id=crypto.randomUUID(),encoder=new TextEncoder()
 let controller,resolveClosed,ended=false
 const closed=new Promise(resolve=>{resolveClosed=resolve})
 const receive=async(body)=>{
  const response=await fetch('https://synthetic-mail-edge.example/socket',{method:'POST',body:JSON.stringify({id,address,options,...body})})
  if(!response.ok)throw new Error('TLS fixture refused connection')
  const bytes=new Uint8Array(await response.arrayBuffer())
  for(let offset=0;offset<bytes.length;offset+=7)controller.enqueue(bytes.slice(offset,offset+7))
 }
 const readable=new ReadableStream({start(value){controller=value}}),opened=receive({open:true})
 return {readable,writable:new WritableStream({async write(bytes){await opened;await receive({data:Array.from(bytes)})}}),opened,closed,
  async close(){if(!ended){ended=true;await opened;controller.close();resolveClosed()}}}
}
async function imapSmtpJourney(){
 const sessions=new Map(),commands=[],sent=[],messages=[]
 const raw=(id,automatic=false)=>`From: synthetic-happytohelp-1 <synthetic-happytohelp-1@customer.example>\r\nTo: synthetic-happytohelp-2@support.example\r\nMessage-ID: <${id}@customer.example>\r\nSubject: Damaged café parcel\r\nAuthentication-Results: mx.customer.example; dkim=pass header.d=customer.example; dmarc=pass header.from=customer.example\r\n${automatic?'Auto-Submitted: auto-replied\r\n':''}Content-Type: text/plain; charset=utf-8\r\n\r\nPlease replace the café parcel.\r\n`
 const app=await startApp({captureQueue:true,socketModule:`export const connect=${fakeTlsConnect.toString()}`,bindings:{APP_ORIGIN:'https://app.example',INTEGRATION_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),MAILBOX_SOCKET_HOSTS:'imap.synthetic.example,smtp.synthetic.example',MAILBOX_IMAP_AUTHSERV:'mx.customer.example',EMAIL_FROM:'synthetic-happytohelp-2@support.example'},outbound:async request=>{
  assert.equal(new URL(request.url).hostname,'synthetic-mail-edge.example','mail never leaves the TLS edge')
  const input=await request.json();assert.equal(input.options.secureTransport,'on');assert.equal(input.options.allowHalfOpen,false)
  const smtp=input.address.hostname==='smtp.synthetic.example';assert.equal(input.address.port,smtp?465:993)
  if(input.open){sessions.set(input.id,{smtp,data:false,raw:''});return new Response(smtp?'220 synthetic ESMTP ready\r\n':'* OK synthetic IMAP ready\r\n')}
  const session=sessions.get(input.id);assert.ok(session)
  const text=Buffer.from(input.data).toString();commands.push(text)
  if(smtp){
   if(session.data){session.raw+=text;if(!session.raw.endsWith('\r\n.\r\n'))return new Response('');sent.push(session.raw.slice(0,-3));session.data=false;return new Response('250 queued synthetic-happytohelp-1\r\n')}
   if(text.startsWith('EHLO '))return new Response('250-synthetic.example\r\n250 AUTH PLAIN\r\n')
   if(text.startsWith('AUTH PLAIN ')){assert.equal(Buffer.from(text.trim().split(' ')[2],'base64').toString(),'\0synthetic-happytohelp-1\0synthetic-happytohelp-2');return new Response('235 authenticated\r\n')}
   if(text.startsWith('MAIL FROM:')||text.startsWith('RCPT TO:'))return new Response('250 accepted\r\n')
   assert.equal(text,'DATA\r\n');session.data=true;return new Response('354 end with dot\r\n')
  }
  const [,tag,command]=text.match(/^(A\d+) (.*)\r\n$/)||[];assert.ok(tag)
  if(command.startsWith('LOGIN ')){assert.equal(command,'LOGIN "synthetic-happytohelp-1" "synthetic-happytohelp-2"');return new Response(`${tag} OK authenticated\r\n`)}
  if(command==='EXAMINE INBOX')return new Response(`* OK [UIDVALIDITY 73] stable\r\n* OK [UIDNEXT ${messages.length+1}] next\r\n${tag} OK examined\r\n`)
  const search=command.match(/^UID SEARCH UID (\d+):(\d+)$/)
  if(search)return new Response(`* SEARCH ${messages.map((_,i)=>i+1).filter(uid=>uid>=Number(search[1])&&uid<=Number(search[2])).join(' ')}\r\n${tag} OK searched\r\n`)
  const fetch=command.match(/^UID FETCH (\d+) \(UID BODY\.PEEK\[\]\)$/);assert.ok(fetch,command)
  const bytes=Buffer.from(messages[Number(fetch[1])-1]);return new Response(Buffer.concat([Buffer.from(`* 1 FETCH (UID ${fetch[1]} BODY[] {${bytes.length}}\r\n`),bytes,Buffer.from(`)\r\n${tag} OK fetched\r\n`)]))
 }})
 try{
  const workspace=await app.seedWorkspace('synthetic-happytohelp-tls'),token=workspace.tokens.owner,base=`/api/management/projects/${workspace.projectId}/mailboxes`
  const connected=await app.ok(base+'/imap',{token,body:{address:'synthetic-happytohelp-2@support.example',imapHost:'imap.synthetic.example',smtpHost:'smtp.synthetic.example',username:'synthetic-happytohelp-1',password:'synthetic-happytohelp-2'}}),box=connected.data
  assert.equal(box.status,'connected');assert.equal(box.provider,'imap')
  messages.push(raw('synthetic-happytohelp-3'))
  const poll=()=>app.ok(`${base}/${box.id}/poll`,{token,body:{}})
  assert.equal((await poll()).received,1)
  const receipt=await app.first('SELECT * FROM inbound_emails WHERE id=?','<synthetic-happytohelp-3@customer.example>');assert.equal(receipt.state,'delivered')
  const original=await app.first('SELECT count(*) n FROM messages WHERE conversation_id=?',receipt.conversation_id)
  assert.equal(original.n,1);assert.match((await app.first('SELECT content FROM messages WHERE id=?',receipt.message_id)).content,/café parcel/)
  await app.takeJobs()
  // Same MIME arrives at a fresh UID, then again during a backfill.
  const ticketsBefore=(await app.first('SELECT count(*) n FROM conversations WHERE project_id=?',workspace.projectId)).n
  messages.push(messages[0]);assert.equal((await poll()).failed,0)
  await app.ok(`${base}/${box.id}/backfill`,{token,body:{}})
  assert.equal((await app.first('SELECT count(*) n FROM messages WHERE conversation_id=?',receipt.conversation_id)).n,1)
  assert.equal((await app.first('SELECT count(*) n FROM conversations WHERE project_id=?',workspace.projectId)).n,ticketsBefore,'redelivery creates no duplicate ticket')
  assert.deepEqual(await app.takeJobs(),[],'redelivery cannot repeat reply/notification effects')
  const ticket=await app.ok(`/api/dashboard/projects/${workspace.projectId}/tickets`,{token,body:{kind:'email',localId:'synthetic-happytohelp-4',requesterEmail:'synthetic-happytohelp-1@customer.example',mailboxId:box.id,subject:'Replacement parcel',content:'Your replacement café parcel ships today.'}})
  await app.until(()=>sent.length===1,{message:'SMTP first comment'})
  assert.ok(ticket.accepted);assert.match(sent[0],/Message-ID: <h2h\./i)
  assert.ok(commands.some(line=>line==='RCPT TO:<synthetic-happytohelp-1@customer.example>\r\n'))
  messages.push(raw('synthetic-happytohelp-5',true));assert.equal((await poll()).received,1)
  const automatic=await app.first('SELECT automatic,conversation_id FROM inbound_emails WHERE id=?','<synthetic-happytohelp-5@customer.example>');assert.equal(automatic.automatic,1)
  const jobs=await app.takeJobs();await app.runJobs(jobs);await app.drainJobs()
  messages.push(messages.at(-1));assert.equal((await poll()).failed,0)
  assert.deepEqual(await app.takeJobs(),[],'automatic-mail redelivery remains inert')
  assert.equal(sent.length,1,'automatic incoming mail cannot start an SMTP auto-reply loop')
  assert.equal((await app.first('SELECT count(*) n FROM inbound_emails WHERE id=?','<synthetic-happytohelp-3@customer.example>')).n,1)
 }finally{await app.close()}
}

async function outboundNoticesJourney(){
 const sent=[]
 const app=await startApp({captureQueue:true,bindings:{APP_ORIGIN:'https://app.example',EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'synthetic-happytohelp-1',EMAIL_FROM:'synthetic-happytohelp-1@support.example',RATE_LIMITS:JSON.stringify({outboundNoticesPerProjectMinute:2})},outbound:async request=>{
  assert.equal(new URL(request.url).hostname,'api.resend.com')
  const copy=await request.json();sent.push(copy)
  return sent.length===2?Response.json({error:'Recipient refused'},{status:422}):Response.json({id:'synthetic-happytohelp-1'})
 }})
 try{
  const workspace=await app.seedWorkspace('synthetic-happytohelp-notices'),token=workspace.tokens.owner,projectId=workspace.projectId,base=`/api/management/projects/${projectId}`
  const mailbox=(await app.ok(base+'/mailboxes',{token,body:{provider:'forwarding',address:'synthetic-happytohelp-1@support.example',displayName:''}})).data
  const requesters=[1,2,3].map(n=>`synthetic-happytohelp-${n}@customer.example`),body={kind:'email',localId:'synthetic-happytohelp-notice-1',requesters:[...requesters,requesters[0]],mailboxId:mailbox.id,subject:'Delayed parcel',content:'Your parcel will arrive tomorrow.'},path=base+'/tickets/notices'
  assert.equal((await app.call(path,{token,body})).status,409,'API cannot send without preview confirmation')
  const preview=await app.ok(path+'/preview',{token,body})
  assert.deepEqual(preview.recipients,requesters);assert.equal(sent.length,0,'preview has no network effect')
  assert.equal((await app.call(path,{token,body:{...body,content:'Unreviewed message',confirmation:preview.confirmation}})).status,409)
  const command={...body,confirmation:preview.confirmation}
  const concurrent=await Promise.all([app.ok(path,{token,body:command}),app.ok(path,{token,body:command})])
  const batch=await app.ok(path,{token,body:command})
  assert.equal(batch.results.length,3);assert.ok(batch.results.every(row=>row.accepted))
  assert.equal(new Set(batch.results.map(row=>row.conversation.id)).size,3,'one ticket per unique requester')
  for(const attempt of concurrent)for(const row of attempt.results)if(row.conversation)assert.equal(row.conversation.id,batch.results.find(saved=>saved.recipient===row.recipient).conversation.id)
  const statuses=[]
  for(const row of batch.results){
   const view=async()=>(await app.ok(`/api/dashboard/projects/${projectId}/conversations/${row.conversation.id}`,{token})).data
   await app.until(async()=>['sent','failed','rate_limited'].includes((await view()).last_message?.email_status?.state),{message:'notice outcome visible on ticket'})
   const ticket=await view();statuses.push(ticket.last_message.email_status.state)
   assert.equal(ticket.submitter_id,workspace.users.owner)
  }
  assert.deepEqual(statuses.sort(),['failed','rate_limited','sent'])
  assert.equal(sent.length,2,'the third notice never reaches the provider')
  for(const address of requesters)assert.ok(sent.filter(copy=>[copy.to].flat().includes(address)).length<=1,'at most one network attempt per requester')
  await app.runJobs(await app.takeJobs());await app.drainJobs()
  await app.ok(path,{token,body:command});assert.equal(sent.length,2,'retries and outbox replay neither resend nor silently release refused notices')
  const changed={...body,requesters:[...requesters,'synthetic-happytohelp-4@customer.example']},reviewed=await app.ok(path+'/preview',{token,body:changed})
  assert.equal((await app.call(path,{token,body:{...changed,confirmation:reviewed.confirmation}})).status,409,'same batch identity cannot grow a new recipient set')
  assert.equal(sent.length,2)
 }finally{await app.close()}
}
