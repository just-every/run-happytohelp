import {senderDomainJourney} from './domain.mjs'
import {sendgridInboundJourney} from './sendgrid-inbound.mjs'
import {unreadableMailJourney} from './unreadable-mail.mjs'
import {rerMailHoldJourney} from './rer-mail-hold.mjs'
import assert from 'node:assert/strict'
import {mailApp,message,recipients,replyTo} from './app.mjs'
import {transportsJourney} from './transports.mjs'
import {mailboxProviderJourney} from './mailbox-provider.mjs'
import {imapSmtpJourney} from './imap-smtp.mjs'
import {rerMailJourney} from './rer-mail.mjs'
import {notificationTriggersJourney} from '../r4/notifications.mjs'
import {workflowNotices,workflowGroupNotices} from './workflow-notices.mjs'

// One real mail conversation: verified ingress, safe rich reply, reviewed held
// mail, private partner work and terminal provider outcomes in the same store.
export async function completeEmailJourney(){
 const m=await mailApp(),{app,mail,operator}=m
 try{
  const id=await notificationTriggersJourney(m),base='/api/management/projects/p',ticket=`/api/dashboard/projects/p/conversations/${id}`
  const request=async(path,body,method)=>app.ok(path,{headers:operator,body,method})
  const head=async()=>app.first('SELECT revision,last_message_id FROM conversations WHERE id=?',id)
  const reply=async(localId,content,mediaIds=[])=>{const current=await head();return request(`/api/conversations/${id}/messages`,{localId,content,mediaIds,expectedRevision:current.revision,expectedLastMessageId:current.last_message_id})}
  const address=await m.replyAddress(id,'requester@example.com')
  const attachment=Buffer.from('Customer return receipt').toString('base64')
  const raw=`From: Customer <requester@example.com>\r\nTo: ${address}\r\nMessage-ID: <customer-file@example.com>\r\nAuthentication-Results: mx.cloudflare.net; dkim=pass header.d=example.com; dmarc=pass header.from=example.com\r\nContent-Type: multipart/mixed; boundary=receipt\r\n\r\n--receipt\r\nContent-Type: text/html\r\n\r\n<p>My receipt</p><script>secret()</script>\r\n--receipt\r\nContent-Type: text/plain\r\nContent-Disposition: attachment; filename=receipt.txt\r\nContent-Transfer-Encoding: base64\r\n\r\n${attachment}\r\n--receipt--\r\n`
  await m.email(raw,{from:'requester@example.com',to:address});await m.email(raw,{from:'requester@example.com',to:address})
  const admitted=await m.admitted('customer-file@example.com')
  assert.equal(admitted.conversation_id,id);assert.match(admitted.content,/My receipt/);assert.ok(!admitted.content.includes('secret()'))
  assert.equal((await app.first('SELECT count(*) n FROM messages WHERE local_id=?',admitted.local_id)).n,1)
  const file=await app.first('SELECT * FROM media WHERE message_id=?',admitted.id)
  assert.equal(await (await app.request(`/api/conversations/${id}/media/${file.id}`,{headers:operator})).text(),'Customer return receipt')
  // The operator reviews the recipient list before this human reply. Header-only
  // addresses remain unproven for automatic notices, and are explicitly removed here.
  const participants=(await request(ticket)).data.participants
  for(const participant of participants.filter(row=>row.email?.startsWith('never-seen'))){
   await request(ticket+'/participants/'+participant.pivot.id,undefined,'DELETE')
  }
  const sentBefore=mail.sent.length
  const upload=await app.ok(`/api/conversations/${id}/media`,{raw:true,headers:{...operator,'Content-Type':'text/plain','X-Filename':'return-label.txt'},body:'Return label bytes'})
  const sent=await reply('return-label','**Replacement approved**\n\n<script>unsafe()</script>',[upload.id]);await app.scheduled()
  const customerCopies=mail.sent.slice(sentBefore).filter(entry=>entry.body.text?.includes('Replacement approved'))
  assert.deepEqual(customerCopies.flatMap(entry=>recipients(entry.body)).sort(),['cc@example.com','requester@example.com'])
  for(const entry of customerCopies){assert.ok(!entry.body.html.includes('<script>'));assert.equal(entry.body.attachments[0].content,Buffer.from('Return label bytes').toString('base64'));assert.ok(replyTo(entry.body))}
  const attempts=mail.attempts;await m.replay(sent.message);assert.equal(mail.attempts,attempts)

  // A spoof cannot join this known customer. The original bytes and file stay
  // reviewable; safe recovery is a private note and cannot notify the requester.
  const spoof=message({id:'spoof@example.test',to:'inbound@example.com',from:'requester@example.com',text:'Change the bank details',authenticated:false,headers:'Authentication-Results: mx.cloudflare.net; dkim=fail header.d=example.com; dmarc=fail header.from=example.com\r\n'})
  const frontier=await head();await app.email(spoof,{from:'requester@example.com',to:'inbound@example.com',direct:true})
  const held=(await request(base+'/suspended')).data.find(row=>row.receipt_id==='<spoof@example.test>'||row.from_address==='requester@example.com')
  assert.ok(held);assert.deepEqual(await head(),frontier)
  assert.equal((await app.call(base+`/suspended/${held.id}/recover`,{headers:operator,body:{conversationId:id}})).status,409)
  const beforeRecovery=mail.attempts
  await request(base+`/suspended/${held.id}/recover`,{conversationId:id,asNote:true})
  assert.ok(await app.first('SELECT id FROM conversation_notes WHERE conversation_id=? AND content LIKE ?',id,'%Change the bank details%'));assert.equal(mail.attempts,beforeRecovery)
  await request(base+'/sender-rules',{address:'@blocked.example',action:'block'})
  await m.gateway({messageId:'blocked-mail',to:'inbound@example.com',from:'buyer@blocked.example',subject:'Held for review',text:'Please help'})
  const blocked=(await request(base+'/suspended')).data.find(row=>row.from_address==='buyer@blocked.example');assert.ok(blocked)
  await request(base+`/suspended/${blocked.id}`,undefined,'DELETE')
  await request(base+'/sender-rules',{address:'@blocked.example',action:'remove'})
  await m.gateway({messageId:'expired-mail',to:'inbound@example.com',from:'buyer@unproven.example',text:'Held spam',headers:{'X-Spam-Score':'8'}})
  await app.scheduled(undefined,{after:15*86400000})
  assert.equal((await request(base+'/suspended')).count,0)
  assert.ok(await app.first("SELECT id FROM audit_events WHERE action='email.suspended_expired'"))

  // Selected public evidence goes to a partner once. The authenticated reply is
  // private; neither the customer's transcript nor their mail receives it.
  assert.equal((await app.call(ticket+'/partner-forwards/preview',{headers:operator,body:{recipient:'partner@example.net',message_ids:[(await app.first('SELECT id FROM conversation_notes WHERE conversation_id=?',id)).id]}})).status,400)
  const version=(await request(ticket+'/ticket')).data.ticket_version
  const forward={recipient:'partner@example.net',subject:'Investigate replacement',note:'Please inspect the return.',message_ids:[admitted.id],idempotencyKey:'partner-once',expected_version:version}
  assert.equal((await request(ticket+'/partner-forwards/preview',forward)).data.private_notes_included,false)
  await request(ticket+'/partner-forwards',forward);await request(ticket+'/partner-forwards',forward)
  const partner=mail.sent.filter(entry=>recipients(entry.body).includes('partner@example.net'));assert.equal(partner.length,1)
  const incoming={messageId:'partner-reply',to:replyTo(partner[0].body),from:'partner@example.net',text:'Private partner analysis'}
  assert.equal((await m.gateway({...incoming,from:'attacker@example.net'})).status,403)
  const beforePartner=mail.attempts;assert.equal((await m.gateway(incoming)).status,201);assert.equal((await m.gateway(incoming)).status,200)
  assert.equal((await request(ticket+'/partner-forwards')).data.replies.length,1);assert.equal(mail.attempts,beforePartner)
  assert.ok(!JSON.stringify(await request(`/api/conversations/${id}/messages`)).includes('Private partner analysis'))

  await workflowNotices(m);await workflowGroupNotices(m)
  // A lost paid answer is visible, freezes its recipients and is never resent.
  mail.mode='lost';const lost=await reply('lost-answer','A later update');await app.scheduled()
  const outcomes=await app.sql('SELECT recipient,state FROM email_deliveries WHERE id LIKE ?',`message:${lost.message.id}:%`)
  assert.ok(outcomes.length>0);assert.ok(outcomes.every(row=>row.state==='uncertain'))
  const paid=mail.attempts;mail.mode='deliver';await app.configure({});await m.replay(lost.message);await app.scheduled();assert.equal(mail.attempts,paid)
  await transportsJourney(m,id)
  const contact=(await app.first('SELECT contact_id FROM conversations WHERE id=?',id)).contact_id
  assert.equal((await app.call(base+`/contacts/${contact}/erase`,{headers:operator,body:{}})).data.code,'step_up_required')
  const beforeProof=mail.sent.length
  await app.ok('/api/identity/magic-link',{headers:{Origin:'https://app.example'},body:{email:'op@example.com'}})
  const delivered=await app.until(()=>mail.sent.slice(beforeProof).find(entry=>recipients(entry.body).includes('op@example.com')&&entry.body.text?.includes('/login/magic')))
  const link=new URL(delivered.body.text.match(/https?:\/\/\S+/)[0]),proof=await app.call('/api/identity/magic-link/consume',{headers:{Origin:'https://app.example'},body:{token:new URLSearchParams(link.hash.slice(1)).get('token')}})
  await app.ok(base+`/contacts/${contact}/erase`,{headers:{Cookie:proof.headers.get('set-cookie').split(';')[0],Origin:'https://app.example'},body:{}})
  assert.equal(await app.first('SELECT id FROM media WHERE id=?',file.id),null)
  assert.equal((await app.first('SELECT count(*) n FROM email_reply_grants WHERE conversation_id=?',id)).n,0)
 }finally{await m.close()}
 // OAuth and TLS mailbox transports admit and send the same support-mail flow.
 for(const transport of [mailboxProviderJourney,imapSmtpJourney,rerMailJourney,sendgridInboundJourney,unreadableMailJourney,rerMailHoldJourney])await transport()
 await senderDomainJourney()
}
