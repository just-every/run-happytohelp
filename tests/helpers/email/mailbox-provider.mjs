import assert from 'node:assert/strict'
import {startApp} from '../../journeys/kit/app.mjs'

// Provider HTTP response shapes from Gmail REST users/profile, settings/sendAs,
// messages/list+get and history/list, and Microsoft Graph /me, message/delta and
// MIME sendMail. Identifiers/addresses are synthetic; only the HTTP edge is fake.
// https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages
// https://learn.microsoft.com/en-us/graph/api/message-delta
// https://learn.microsoft.com/en-us/graph/api/user-sendmail
const b64=value=>Buffer.from(value).toString('base64url')
const mime=(provider,address,id)=>`From: Customer <customer@example.com>\r\nTo: ${address}\r\nSubject: Shipment arrives damaged\r\nMessage-ID: <${id}@example.com>\r\nAuthentication-Results: ${provider==='gmail'?'mx.google.com; dkim=pass header.d=example.com; dmarc=pass header.from=example.com':'spf=pass smtp.mailfrom=example.com; dkim=pass header.d=example.com; dmarc=pass action=none header.from=example.com; compauth=pass reason=100'}\r\nContent-Type: text/plain\r\n\r\nPlease replace the damaged shipment.`

export async function mailboxProviderJourney(){
 const sent=[],notices=[],authorization=[],failures={gmail:false,microsoft:false},accounts=new Map(),polls=[]
 let noticeFailure=false
 const addresses={gmail:'gmail.support@example.test',microsoft:'m365.support@example.test'}
 const app=await startApp({captureQueue:true,bindings:{APP_ORIGIN:'https://app.example',INBOUND_EMAIL_TOKEN:'gateway-fixture',EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'installation-fixture',EMAIL_FROM:'support@example.test',INTEGRATION_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),GOOGLE_MAIL_CLIENT_ID:'google-client-fixture',GOOGLE_MAIL_CLIENT_SECRET:'google-secret-fixture',MICROSOFT_MAIL_CLIENT_ID:'microsoft-client-fixture',MICROSOFT_MAIL_CLIENT_SECRET:'microsoft-secret-fixture'},outbound:async request=>{
  const url=new URL(request.url),provider=url.hostname.includes('google')?'gmail':'microsoft',base='https://gmail.googleapis.com/gmail/v1/users/me'
  if(url.hostname==='api.resend.com'){const body=await request.json();if(body.subject.startsWith('Not delivered:')){notices.push(body);if(noticeFailure)return new Response(null,{status:503})}return Response.json({id:crypto.randomUUID()})}
  if(url.pathname.endsWith('/token')){const body=new URLSearchParams(await request.text());authorization.push(body);assert.ok(body.get('code_verifier')||body.get('grant_type')==='refresh_token');const account=accounts.get(body.get('code'));return Response.json({access_token:account?.code||provider+'-access-fixture',refresh_token:provider+'-refresh-fixture',expires_in:3600,token_type:'Bearer',scope:provider==='gmail'?'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.settings.basic':'Mail.Read Mail.Send User.Read'})}
  const account=accounts.get(request.headers.get('authorization')?.replace(/^Bearer /,''))
  if(account){
   if(url.pathname.endsWith('/settings/sendAs'))return Response.json({sendAs:[{sendAsEmail:account.address,isPrimary:true,isDefault:true,verificationStatus:'accepted'}]})
   if(url.pathname.endsWith('/profile')&&!account.failure)return Response.json({emailAddress:account.address,historyId:String(account.history)})
   polls.push(account.address)
   if(account.failure)return new Response(null,{status:account.failure})
   if(url.href.startsWith(base+'/messages?'))return Response.json({messages:account.messages.map(message=>({id:message.id})),resultSizeEstimate:account.messages.length})
   if(url.pathname.endsWith('/history'))return Response.json({history:account.messages.filter(message=>message.history>Number(url.searchParams.get('startHistoryId'))).map(message=>({id:String(message.history),messagesAdded:[{message:{id:message.id,labelIds:['INBOX']}}]})),historyId:String(account.history)})
   const id=url.pathname.match(/\/messages\/([^/]+)$/)?.[1],message=account.messages.find(message=>message.id===id)
   if(message?.oversized)return new Response('',{headers:{'content-length':String(40*1024*1024)}})
   if(message)return Response.json({id:message.id,labelIds:['INBOX'],historyId:String(message.history),raw:b64(message.raw)})
   throw new Error('Unexpected Gmail account edge '+url.pathname)
  }
  if(url.href===base+'/profile')return Response.json({emailAddress:addresses.gmail,messagesTotal:41,threadsTotal:22,historyId:'451'})
  if(url.pathname.endsWith('/settings/sendAs'))return Response.json({sendAs:[{sendAsEmail:addresses.gmail,displayName:'Parcel Support',isPrimary:true,isDefault:true,verificationStatus:'accepted'},{sendAsEmail:'returns@example.test',displayName:'Returns',verificationStatus:'accepted'}]})
  if(url.pathname==='/v1.0/me')return Response.json({id:'directory-user',mail:addresses.microsoft,userPrincipalName:addresses.microsoft,proxyAddresses:['SMTP:'+addresses.microsoft,'smtp:billing@example.test']})
  if(url.pathname.endsWith('/messages/send')){sent.push({provider,raw:Buffer.from((await request.json()).raw,'base64url').toString()});return Response.json({id:'sent-message-gmail',threadId:'thread-gmail',labelIds:['SENT']})}
  if(url.pathname.endsWith('/sendMail')){sent.push({provider,raw:Buffer.from(await request.text(),'base64').toString()});return new Response(null,{status:202})}
  if(failures[provider])return new Response(null,{status:401})
  if(url.pathname.endsWith('/messages/delta'))return Response.json({'@odata.context':'https://graph.microsoft.com/v1.0/$metadata#Collection(message)','@odata.deltaLink':"https://graph.microsoft.com/v1.0/me/mailfolders('inbox')/messages/delta?$deltatoken=opaque",value:[{id:'AAMk-message-001'}]})
  if(url.pathname.endsWith('/$value'))return new Response(mime('microsoft',addresses.microsoft,'graph-first'),{headers:{'Content-Type':'message/rfc822'}})
  if(url.href.startsWith(base+'/messages?'))return Response.json({messages:[{id:'18f-message-001',threadId:'18f-thread-001'}],resultSizeEstimate:1})
  if(url.pathname.endsWith('/messages/18f-message-001'))return Response.json({id:'18f-message-001',threadId:'18f-thread-001',labelIds:['INBOX'],historyId:'452',raw:b64(mime('gmail',addresses.gmail,'gmail-first'))})
  if(url.pathname.endsWith('/history'))return Response.json({history:[],historyId:'452'})
  if(url.hostname==='cloudflare-dns.com')return Response.json({Status:0,Answer:[{type:15,data:'10 mx.example.test.'}]})
  throw new Error('Unexpected provider edge '+url)
 }})
 try{
  const workspace=await app.seedWorkspace('mailboxes'),base=`/api/management/projects/${workspace.projectId}/mailboxes`,token=workspace.tokens.owner
  const other=await app.seedWorkspace('mailboxes-other')
  for(const provider of ['gmail','microsoft']){
   const started=await app.ok(base+'/connect',{token,body:{provider,displayName:'Parcel Support'}}),url=new URL(started.url)
   assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.ok(url.searchParams.get('code_challenge'))
   const callback=`/api/management/mailboxes/oauth/${provider}/callback?state=${url.searchParams.get('state')}&code=provider-code-fixture`
   assert.equal((await app.call(callback,{token:other.tokens.owner})).status,403)
   assert.equal((await app.call(callback,{token})).status,302)
   assert.equal((await app.call(callback,{token})).status,403,'OAuth state is single use')
   const row=(await app.ok(base,{token})).data.find(row=>row.provider===provider)
   assert.equal(row.status,'connected');assert.equal(JSON.stringify(row).includes('access-fixture'),false)
   assert.equal((await app.first('SELECT credential_cipher FROM mailbox_connections WHERE id=?',row.id)).credential_cipher.includes('refresh-fixture'),false)
   await app.ok(`${base}/${row.id}/signatures/default`,{token,method:'PUT',body:{text:'Parcel Support team'}})
   await app.ok(`${base}/${row.id}/signatures/${workspace.users.owner}`,{token,method:'PUT',body:{text:'Alex | Parcel Support'}})
   const sync=await app.ok(`${base}/${row.id}/poll`,{token,body:{}});assert.equal(sync.received,1)
   const message=await app.first('SELECT m.*,c.mailbox_id FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.mailbox_id=?',row.id)
   assert.ok(message,provider+' provider-authenticated mail becomes a ticket: '+JSON.stringify(await app.sql('SELECT state,error,conversation_id FROM inbound_emails')));assert.match(message.content,/damaged shipment/)
   assert.equal((await app.ok(`${base}/${row.id}/poll`,{token,body:{}})).received,0,'cursor redelivery creates no second message')
   const ticket=await app.ok(`/api/dashboard/projects/${workspace.projectId}/tickets`,{token,body:{kind:'email',localId:provider+'-operator-ticket',requesterEmail:'new.customer@example.com',subject:'Replacement shipment',content:'Your replacement ships today.',mailboxId:row.id,cc:['finance@example.com'],bcc:['archive@example.com']}})
   await app.until(()=>sent.some(wire=>wire.provider===provider),{message:provider+' send'})
   const wire=sent.find(wire=>wire.provider===provider);assert.match(wire.raw,/Cc: <finance@example.com>/i);assert.match(wire.raw,/Bcc: <archive@example.com>/i)
   const parts=wire.raw.split(/Content-Transfer-Encoding: base64\r\n\r\n/).slice(1).map(part=>Buffer.from(part.split('\r\n--')[0].replace(/\s/g,''),'base64').toString()).join('\n')
   assert.match(parts,/Alex \| Parcel Support/);assert.match(wire.raw,/Message-ID: <h2h\./i)
   const repeated=await app.ok(`/api/dashboard/projects/${workspace.projectId}/tickets`,{token,body:{kind:'email',localId:provider+'-operator-ticket',requesterEmail:'new.customer@example.com',subject:'Replacement shipment',content:'Your replacement ships today.',mailboxId:row.id,cc:['finance@example.com'],bcc:['archive@example.com']}})
   assert.equal(repeated.conversation.id,ticket.conversation.id);assert.equal(sent.filter(wire=>wire.provider===provider).length,1)
   failures[provider]=true;assert.equal((await app.call(`${base}/${row.id}/poll`,{token,body:{}})).status,502)
   assert.equal((await app.ok(base,{token})).data.find(m=>m.id===row.id).status,'reconnect_required')
   failures[provider]=false
   const receivingAlias=`${provider}+returns@example.test`
   await app.ok(`${base}/${row.id}/aliases`,{token,body:{address:receivingAlias}})
   const restart=await app.ok(`${base}/${row.id}/reconnect`,{token,body:{}}),state=new URL(restart.url).searchParams.get('state')
   assert.equal((await app.call(`/api/management/mailboxes/oauth/${provider}/callback?state=${state}&code=new-code`,{token})).status,302)
   assert.ok((await app.ok(base,{token})).data.find(mailbox=>mailbox.id===row.id).addresses.some(alias=>alias.address===receivingAlias&&!alias.can_send),'OAuth reconnect retains manually configured receiving aliases without granting send-as')
   assert.equal((await app.ok(`${base}/${row.id}/backfill`,{token,body:{}})).received,0,'backfill retains deduplication')
   await app.ok(`${base}/${row.id}`,{token,method:'DELETE'})
   assert.equal((await app.call(`${base}/${row.id}/poll`,{token,body:{}})).status,409)
   assert.equal((await app.first('SELECT credential_cipher FROM mailbox_connections WHERE id=?',row.id)).credential_cipher,null)
  }
  assert.equal(authorization.length,4)
  const connect=async(address,messages=[])=>{
   const account={address,code:'mailbox-code-'+accounts.size,messages:messages.map((raw,index)=>({id:'message-'+index,history:index+1,raw})),history:Math.max(1,messages.length),failure:0}
   accounts.set(account.code,account)
   const started=await app.ok(base+'/connect',{token,body:{provider:'gmail',displayName:'Parcel Support'}}),state=new URL(started.url).searchParams.get('state')
   assert.equal((await app.call(`/api/management/mailboxes/oauth/gmail/callback?state=${state}&code=${account.code}`,{token})).status,302)
   const row=(await app.ok(base,{token})).data.find(row=>row.address===address);assert.ok(row)
   return {address,row,account}
  }
  const append=(box,raw)=>box.account.messages.push({id:'message-'+box.account.messages.length,history:++box.account.history,raw})
  const poll=box=>app.ok(`${base}/${box.row.id}/poll`,{token,body:{}})
  const supportAddress='support@parcel.example',billingAddress='billing@parcel.example'
  const shared=mime('gmail',supportAddress,'two-mailboxes').replace('Subject:',`Cc: ${billingAddress}\r\nSubject:`)
  const support=await connect(supportAddress,[shared]),billing=await connect(billingAddress,[shared])
  assert.equal((await poll(support)).received,1)
  const admitted=await app.first('SELECT * FROM inbound_emails WHERE id=?','<two-mailboxes@example.com>');assert.equal(admitted.state,'delivered')
  assert.equal(await app.first('SELECT 1 FROM conversation_participants cp JOIN contacts ct ON ct.id=cp.contact_id WHERE cp.conversation_id=? AND lower(ct.email)=?',admitted.conversation_id,billingAddress),null,'a connected CC mailbox is not a customer participant')
  const before=await app.first('SELECT count(*) AS n FROM messages WHERE conversation_id=?',admitted.conversation_id)
  await app.takeJobs()
  assert.equal((await poll(billing)).failed,0,'a CC copy is a duplicate, not a permanent rejection')
  assert.equal((await app.first('SELECT count(*) AS n FROM messages WHERE conversation_id=?',admitted.conversation_id)).n,before.n,'two connected mailboxes admit one customer message')
  assert.equal((await app.first('SELECT count(*) AS n FROM mailbox_sync_receipts WHERE mailbox_id IN (?,?)',support.row.id,billing.row.id)).n,2,'each mailbox records its provider copy')
  assert.deepEqual(await app.takeJobs(),[],'the second mailbox does not repeat message effects')
  append(billing,mime('gmail',billingAddress,'billing-later').replace('damaged shipment.','invoice copy.'))
  assert.equal((await poll(billing)).received,1,'new billing-only mail arrives through Gmail history after the duplicate')
  const later=await app.first('SELECT * FROM inbound_emails WHERE id=?','<billing-later@example.com>');assert.equal(later.state,'delivered')
  assert.equal((await app.first('SELECT mailbox_id FROM conversations WHERE id=?',later.conversation_id)).mailbox_id,billing.row.id)
  // Reusing the shared identity for a changed body is still refused. The next
  // provider message is admitted without replaying or changing the first mail.
  append(billing,shared.replace('damaged shipment.','different bank details.'))
  append(billing,mime('gmail',billingAddress,'after-conflict').replace('damaged shipment.','later valid request.'))
  const partial=await poll(billing);assert.equal(partial.failed,1);assert.equal(partial.received,1)
  assert.equal((await app.first('SELECT state FROM inbound_emails WHERE id=?','<after-conflict@example.com>')).state,'delivered')
  assert.equal((await app.first('SELECT * FROM inbound_emails WHERE id=?',admitted.id)).message_id,admitted.message_id)
  assert.equal((await app.first('SELECT count(*) AS n FROM messages WHERE content LIKE ?','%different bank details%')).n,0,'identity conflict never becomes customer mail')
  assert.equal((await app.ok(`/api/management/projects/${workspace.projectId}/suspended`,{token})).data.filter(mail=>mail.reason==='message_identity_conflict').length,1,'the conflicting copy is retained for review without changing its original receipt')
  const refusal=await app.first("SELECT outcome,detail_json FROM audit_events WHERE action='mailbox.message_failed' AND target_id=?",billing.row.id)
  assert.equal(refusal.outcome,'failed');assert.equal(JSON.parse(refusal.detail_json).status,409)
  assert.deepEqual(await poll(billing),{received:0,failed:0,cursor:partial.cursor,more:false},'permanent rejection is observed once and does not pin the cursor')
  const backfill=await app.ok(`${base}/${billing.row.id}/backfill`,{token,body:{}})
  assert.equal(backfill.failed,0);assert.equal(backfill.received,0,'backfill preserves the rejected message replay fence')
  const ticketPath=`/api/dashboard/projects/${workspace.projectId}/conversations/${admitted.conversation_id}/ticket`,ticketState=(await app.ok(ticketPath,{token})).data
  await app.ok(ticketPath,{token,method:'PATCH',body:{expected_version:ticketState.ticket_version,status_id:'closed'}})
  const closedReply=mime('gmail',supportAddress,'member-closed').replace('Customer <customer@example.com>','Owner <owner-mailboxes@example.test>').replaceAll('header.d=example.com','header.d=example.test').replaceAll('header.from=example.com','header.from=example.test').replace('Subject:','In-Reply-To: <two-mailboxes@example.com>\r\nSubject:')
  append(support,closedReply);append(support,mime('gmail',supportAddress,'after-closed-member'))
  const closedPoll=await poll(support);assert.equal(closedPoll.failed,1);assert.equal(closedPoll.received,1)
  assert.equal(notices.length,1);assert.ok(notices[0].to.includes('owner-mailboxes@example.test'))
  assert.equal((await app.first('SELECT state FROM inbound_emails WHERE id=?','<after-closed-member@example.com>')).state,'delivered')
  assert.equal((await app.first('SELECT count(*) n FROM messages WHERE actor_id=? AND conversation_id=?',workspace.users.owner,admitted.conversation_id)).n,0)
  append(support,closedReply);await poll(support);await app.ok(`${base}/${support.row.id}/backfill`,{token,body:{}})
  assert.equal(notices.length,1,'repeated polls and a second provider copy send one notice per receipt')
  noticeFailure=true
  append(support,closedReply.replaceAll('member-closed','member-closed-notice-failed'));append(support,mime('gmail',supportAddress,'after-notice-failure'))
  const noticePoll=await poll(support);assert.equal(noticePoll.failed,1);assert.equal(noticePoll.received,1)
  assert.ok((await app.ok(`/api/management/projects/${workspace.projectId}/suspended`,{token})).data.some(mail=>mail.reason==='closed_ticket_notice_failed'))
  await poll(support);assert.equal(notices.length,2,'a failed/unknown notice stays visible without an automatic resend or a stuck cursor')
  noticeFailure=false
  append(billing,mime('gmail',billingAddress,'quoted-only').replace('Please replace the damaged shipment.','> Earlier quoted message'))
  assert.equal((await poll(billing)).failed,1)
  const refusedMail=(await app.ok(`/api/management/projects/${workspace.projectId}/suspended`,{token})).data.find(mail=>mail.reason==='message_refused');assert.ok(refusedMail)
  assert.match((await app.ok(`/api/management/projects/${workspace.projectId}/suspended/${refusedMail.id}`,{token})).data.text,/Earlier quoted message/)
  append(billing,'');billing.account.messages.at(-1).oversized=true
  append(billing,mime('gmail',billingAddress,'after-oversized'))
  assert.equal((await poll(billing)).failed,1)
  assert.equal((await app.first('SELECT state FROM inbound_emails WHERE id=?','<after-oversized@example.com>')).state,'delivered')
  assert.ok((await app.ok(`/api/management/projects/${workspace.projectId}/suspended`,{token})).data.some(mail=>mail.reason==='message_too_large'))
  const stuck=[]
  for(let index=0;index<10;index++){
   const box=await connect(`stuck-${index}@parcel.example`);box.account.failure=503;stuck.push(box)
   assert.equal((await app.call(`${base}/${box.row.id}/poll`,{token,body:{}})).status,502)
  }
  const healthy=await connect('healthy@parcel.example',[mime('gmail','healthy@parcel.example','healthy-first')])
  // A reserved retry slot cannot displace the three healthy inboxes, including
  // a healthy inbox with a newer successful sync than every failure.
  await app.db.prepare("UPDATE mailbox_connections SET updated_at=? WHERE error_code='sync_failed'").bind(Date.now()-10*60000).run()
  append(billing,mime('gmail',billingAddress,'billing-scheduled'))
  polls.length=0;await app.scheduled()
  assert.equal((await app.first('SELECT state FROM inbound_emails WHERE id=?','<healthy-first@example.com>')).state,'delivered','ten stuck mailboxes cannot starve a healthy inbox')
  assert.equal((await app.first('SELECT state FROM inbound_emails WHERE id=?','<billing-scheduled@example.com>')).state,'delivered','recently synced healthy mailboxes stay ahead of failures')
  const firstFailure=polls.findIndex(address=>address.startsWith('stuck-'))
  assert.ok(firstFailure>polls.indexOf(healthy.address));assert.ok(firstFailure>polls.indexOf(billing.address))
  const retried=stuck.find(box=>polls.includes(box.address));assert.ok(retried)
  const retryAt=(await app.first('SELECT updated_at FROM mailbox_connections WHERE id=?',retried.row.id)).updated_at
  polls.length=0;await app.scheduled()
  assert.equal(polls.includes(retried.address),false,'fresh provider failures back off between scheduled runs')
  assert.equal((await app.first('SELECT updated_at FROM mailbox_connections WHERE id=?',retried.row.id)).updated_at,retryAt)
  for(const box of [support,billing,healthy,...stuck])await app.ok(`${base}/${box.row.id}`,{token,method:'DELETE'})
  for(const count of [3,4,6,20]){
   const boxes=[]
   for(let index=0;index<count;index++){const box=await connect(`fair-${count}-${index}@parcel.example`);await poll(box);boxes.push(box)}
   const recovered=await connect(`recovered-${count}@parcel.example`);recovered.account.failure=503
   assert.equal((await app.call(`${base}/${recovered.row.id}/poll`,{token,body:{}})).status,502)
   append(recovered,mime('gmail',recovered.address,'recovered-'+count));recovered.account.failure=0
   polls.length=0;await app.scheduled();assert.equal(polls.includes(recovered.address),false,'a failed inbox remains inside its backoff')
   await app.db.prepare('UPDATE mailbox_connections SET updated_at=? WHERE id=?').bind(Date.now()-10*60000,recovered.row.id).run()
   polls.length=0;await app.scheduled()
   assert.ok(polls.includes(recovered.address),`a recovered inbox gets a slot on the first due run beside ${count} healthy inboxes`)
   assert.equal((await app.first('SELECT state FROM inbound_emails WHERE id=?',`<recovered-${count}@example.com>`)).state,'delivered')
   for(const box of [...boxes,recovered])await app.ok(`${base}/${box.row.id}`,{token,method:'DELETE'})
  }
 }finally{await app.close()}
}
