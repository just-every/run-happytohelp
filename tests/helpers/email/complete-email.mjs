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

  await suspendedMailReview(m,id)

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

// MAIL-002: review the receiving edge's evidence through the same routes used by
// Suspended mail. Database reads additionally catch invisible ticket/AI work.
async function suspendedMailReview(m,id){
 const {app,mail,operator}=m,base='/api/management/projects/p',heldPath=base+'/suspended'
 const request=(path,body,method)=>app.ok(path,{headers:operator,body,method})
 const transcript=conversationId=>request(`/api/conversations/${conversationId}/messages`)
 const bucket=conversationId=>request(`/api/dashboard/projects/p/conversations/${conversationId}/buckets/${conversationId}`)
 const audit=async()=> (await request(base+'/audit?limit=200')).data
 const detail=async row=>(await request(heldPath+'/'+row.id)).data
 const list=()=>request(heldPath)
 const send=async({key,from,headers='',text='Please review my order',authenticated=true,type='text/plain'})=>{
  const result=await app.email(message({id:key+'@mail002.example',to:'inbound@example.com',from,subject:'MAIL-002 '+key,headers,text,authenticated,type}),{from,to:'inbound@example.com',direct:true})
  assert.equal(result.status,200);assert.equal(result.rejected,undefined)
  const row=(await list()).data.find(row=>row.subject==='MAIL-002 '+key)
  assert.ok(row,`${key} is visible in Suspended`);return detail(row)
 }
 await app.scheduled();await app.drainJobs()
 // This is a verified customer's active AI-enabled thread, not an inert inbox.
 const contact=(await app.first('SELECT contact_id FROM conversations WHERE id=?',id)).contact_id
 await app.db.batch([
  app.db.prepare('UPDATE contacts SET is_verified=1,external_id=email WHERE id=?').bind(contact),
  app.db.prepare("INSERT INTO ai_profiles(id,project_id,name,role,prompt,model,created_at) VALUES('mail-review-ai','p','Support','support','Help the customer','gpt-5.6-luna',1)"),
  app.db.prepare("INSERT INTO conversation_ai(conversation_id,ai_id) VALUES(?,'mail-review-ai') ON CONFLICT(conversation_id) DO UPDATE SET ai_id=excluded.ai_id").bind(id),
 ])
 await request(`/api/dashboard/projects/p/conversations/${id}`,{resolved:false},'PUT')
 await app.configure({OPENAI_API_KEY:'synthetic-mail-review'})
 assert.equal((await request(`/api/dashboard/projects/p/conversations/${id}`)).data.ai_id,'mail-review-ai')
 const counts=async()=>Object.fromEntries(await Promise.all(['contacts','conversations','messages','ai_generations','ai_attempts','conversation_outbox','email_deliveries','notification_inbox','notification_trigger_claims','operator_notifications'].map(async table=>[table,(await app.first(`SELECT count(*) n FROM ${table}`)).n])))
 const before=await counts(),frontier=await transcript(id),attempts=mail.attempts
 const spam=await send({key:'review-spam',from:'spam@review.example',headers:'X-Spam-Score: 8\r\n',type:'multipart/mixed; boundary=review',text:'--review\r\nContent-Type: text/plain\r\n\r\nUnwanted offer\r\n--review\r\nContent-Type: text/plain\r\nContent-Disposition: attachment; filename=evidence.txt\r\n\r\n<script>inert preview</script>\r\n--review--\r\n'})
 assert.equal(spam.reason,'spam');assert.equal(JSON.parse(spam.headers_json)['x-spam-score'],'8');assert.equal(JSON.parse(spam.auth_json).verified,true)
 assert.equal(spam.attachments[0].filename,'evidence.txt')
 assert.match((await request(heldPath+`/${spam.id}/attachments/0`)).text,/<script>inert preview<\/script>/)
 const failed=await send({key:'review-dmarc',from:'dmarc@review.example',authenticated:false,headers:'Authentication-Results: mx.cloudflare.net; dkim=fail header.d=review.example; dmarc=fail header.from=review.example\r\n',text:'My parcel is missing'})
 assert.equal(failed.reason,'authentication_failed');assert.equal(JSON.parse(failed.auth_json).failed,true)
 assert.match(JSON.parse(failed.headers_json)['authentication-results'],/dmarc=fail/)
 await request(base+'/sender-rules',{address:'@review-blocked.example',action:'block'})
 const blocked=await send({key:'review-blocked',from:'buyer@review-blocked.example'})
 assert.equal(blocked.reason,'blocked_sender')
 const forged=await send({key:'review-forged',from:'requester@example.com',authenticated:false,text:'Unproven customer claim'})
 assert.equal(forged.reason,'sender_unproven');assert.equal(JSON.parse(forged.auth_json).verified,false)
 const loop=await send({key:'review-loop',from:'support@example.com'})
 assert.equal(loop.reason,'mail_loop')
 // Both the raw receiving bound and the shared attachment bound retain the
 // original evidence. Neither rejection is allowed to create a partial ticket.
 const manyFiles=Array.from({length:21},(_,i)=>`--files\r\nContent-Type: text/plain\r\nContent-Disposition: attachment; filename=file-${i}.txt\r\n\r\nfile ${i}\r\n`).join('')+'--files--\r\n'
 const overFiles=await send({key:'review-file-limit',from:'files@review.example',type:'multipart/mixed; boundary=files',text:manyFiles})
 assert.equal(overFiles.reason,'message_too_large');assert.equal(overFiles.attachments.length,21)
 assert.equal((await request(heldPath+`/${overFiles.id}/attachments/20`)).text.trim(),'file 20')
 const largeFile=await send({key:'review-attachment-limit',from:'large-file@review.example',type:'multipart/mixed; boundary=largefile',text:'--largefile\r\nContent-Type: text/plain\r\nContent-Disposition: attachment; filename=large.txt\r\n\r\n'+'x'.repeat(20000001)+'\r\n--largefile--\r\n'})
 assert.equal(largeFile.reason,'message_too_large');assert.equal(largeFile.attachments[0].size,20000001)
 assert.equal((await request(heldPath+`/${largeFile.id}/attachments/0`)).text,null)
 const largeRaw=message({id:'review-size@mail002.example',to:'inbound@example.com',from:'large@review.example',text:'x'.repeat(25000001)})
 const largeResult=await app.email(largeRaw,{from:'large@review.example',to:'inbound@example.com',direct:true})
 assert.equal(largeResult.status,200);assert.equal(largeResult.rejected,undefined)
 const large=await detail((await list()).data.find(row=>row.subject===''&&row.reason==='message_too_large'))
 assert.equal(large.attachments[0].filename,'original.eml');assert.equal(large.attachments[0].size,Buffer.byteLength(largeRaw))
 assert.equal((await request(heldPath+`/${large.id}/attachments/0`)).text,null,'raw MIME is metadata-only')
 const held=await list()
 assert.equal(held.count,8);assert.equal(held.oldest_at,Math.min(...held.data.map(row=>row.created_at)))
 assert.deepEqual(held.reasons.map(row=>row.reason).sort(),['authentication_failed','blocked_sender','mail_loop','message_too_large','sender_unproven','spam'])
 for(const row of held.data)assert.equal(row.expires_at-row.created_at,14*86400000)
 await app.scheduled();await app.drainJobs()
 assert.deepEqual(await counts(),before,'held mail creates no contact, ticket, message, AI work, outbox or notification')
 assert.deepEqual(await transcript(id),frontier,'a forged verified-customer From cannot alter its thread')
 assert.equal(mail.attempts,attempts,'no AI provider request, acknowledgment or other outbound request while suspended')

 // A current collaborator can see ordinary tickets but cannot use any review or
 // sender-rule door. Every refusal leaves all held content and lists intact.
 const denied={Authorization:'Bearer watch-token'},snapshot=await list(),rules=await request(base+'/sender-rules')
 for(const [path,body,method] of [
  [heldPath,undefined,'GET'],[heldPath+'/'+spam.id,undefined,'GET'],[heldPath+`/${spam.id}/attachments/0`,undefined,'GET'],
  [heldPath+`/${failed.id}/recover`,{asNote:true},'POST'],[heldPath+'/'+spam.id,undefined,'DELETE'],
  [base+'/sender-rules',undefined,'GET'],...['allow','block','remove'].map(action=>[base+'/sender-rules',{address:'@review-blocked.example',action},'POST']),
 ])assert.equal((await app.call(path,{headers:denied,body,method})).status,403,`${method} ${path} requires permission`)
 assert.deepEqual(await list(),snapshot);assert.deepEqual(await request(base+'/sender-rules'),rules)
 assert.equal((await app.call(heldPath+`/${failed.id}/recover`,{headers:operator,body:{}})).status,409,'failed authentication never becomes a public customer message')
 const privateAttempts=mail.attempts,privateAi=(await counts()).ai_generations
 const recovered=await request(heldPath+`/${failed.id}/recover`,{asNote:true})
 assert.equal(recovered.asNote,true);assert.notEqual(recovered.conversationId,id)
 assert.match(JSON.stringify(await bucket(recovered.conversationId)),/My parcel is missing/)
 assert.ok(!JSON.stringify(await transcript(recovered.conversationId)).includes('My parcel is missing'),'unverified mail stays private')
 await request(heldPath+`/${forged.id}/recover`,{conversationId:id,asNote:true})
 assert.match(JSON.stringify(await bucket(id)),/Unproven customer claim/)
 assert.deepEqual(await transcript(id),frontier)
 const deleted=await request(heldPath+'/'+spam.id,undefined,'DELETE');assert.equal(deleted.deleted,true)
 for(const suffix of ['', '/attachments/0'])assert.equal((await app.call(heldPath+'/'+spam.id+suffix,{headers:operator})).status,404)
 assert.ok(!(await list()).data.some(row=>row.id===spam.id),'deleted spam disappears from the list')

 await app.scheduled();await app.drainJobs()
 assert.equal(mail.attempts,privateAttempts,'private recovery and deletion never send mail or request AI')
 assert.equal((await counts()).ai_generations,privateAi)

 // An allow rule bypasses only spam scoring. Redelivery with a new Message-ID
 // is ordinary intake; the original held receipt remains an explicit review.
 await request(base+'/sender-rules',{address:'buyer@review-blocked.example',action:'allow'})
 assert.equal((await send({key:'review-block-wins',from:'buyer@review-blocked.example'})).reason,'blocked_sender')
 await request(base+'/sender-rules',{address:'@review-blocked.example',action:'remove'})
 const allowed=await m.gateway({messageId:'review-allowed',to:'inbound@example.com',from:'buyer@review-blocked.example',text:'Allowed redelivery',headers:{'X-Spam-Score':'8'}})
 assert.equal(allowed.status,201);assert.equal((await allowed.json()).state,'delivered')
 assert.match(JSON.stringify(await transcript((await m.claim('review-allowed')).conversation_id)),/Allowed redelivery/)
 const stillFailed=await send({key:'review-allow-failed',from:'buyer@review-blocked.example',authenticated:false,headers:'Authentication-Results: mx.cloudflare.net; dmarc=fail header.from=review-blocked.example\r\n'})
 assert.equal(stillFailed.reason,'authentication_failed','allow-list never overrides failed sender authentication')
 const allowRules=(await request(base+'/sender-rules')).data
 assert.ok(allowRules.some(row=>row.address==='buyer@review-blocked.example'&&row.action==='allow'))

 // Authenticated false positives recover as normal mail, once into a new ticket
 // and once by References into this customer's existing thread, without replaying
 // the automatic effects that were suppressed during suspension.
 const newMail=await send({key:'review-new',from:'new@review.example',headers:'X-Spam-Score: 8\r\n',text:'Authenticated false positive'})
 await app.scheduled();await app.drainJobs();const newAttempts=mail.attempts,newAi=(await counts()).ai_generations
 const recoveredNew=await request(heldPath+`/${newMail.id}/recover`,{})
 assert.notEqual(recoveredNew.conversationId,id);assert.match(JSON.stringify(await transcript(recoveredNew.conversationId)),/Authenticated false positive/)
 await app.scheduled();await app.drainJobs()
 assert.equal(mail.attempts,newAttempts,'new-ticket recovery never retroactively sends or asks AI')
 assert.equal((await counts()).ai_generations,newAi)
 const inThread=await send({key:'review-thread',from:'requester@example.com',headers:'X-Spam-Score: 8\r\nReferences: <customer-file@example.com>\r\n',text:'Recovered into my original thread'})
 assert.equal(inThread.candidate_conversation_id,id)
 await app.scheduled();await app.drainJobs();const recoveryAttempts=mail.attempts,aiBefore=(await counts()).ai_generations
 const recoveredThread=await request(heldPath+`/${inThread.id}/recover`,{})
 assert.equal(recoveredThread.conversationId,id);assert.match(JSON.stringify(await transcript(id)),/Recovered into my original thread/)
 await app.scheduled();await app.drainJobs()
 assert.equal(mail.attempts,recoveryAttempts,'normal recovery never retroactively sends or asks AI')
 assert.equal((await counts()).ai_generations,aiBefore)
 assert.equal((await app.call(heldPath+`/${inThread.id}/recover`,{headers:operator,body:{}})).status,404,'a recovered receipt cannot be released twice')
 const events=await audit()
 for(const action of ['email.suspended_recovered_note','email.suspended_recovered','email.suspended_deleted','email.sender_allow','email.sender_block','email.sender_remove'])assert.ok(events.some(row=>row.action===action&&row.actor_id==='op'),action+' is audited')
 const beforeOversizeRecovery=await counts()
 assert.equal((await app.call(heldPath+`/${overFiles.id}/recover`,{headers:operator,body:{}})).status,409,'recovery cannot discard over-limit attachments')
 assert.deepEqual(await counts(),beforeOversizeRecovery,'refused recovery creates no empty ticket or other side effects')
 // Stop just before and after the stated retention boundary at the runtime edge.
 const remaining=await list();assert.ok(remaining.count>0)
 await app.scheduled(undefined,{after:13*86400000});assert.equal((await list()).count,remaining.count)
 await app.scheduled(undefined,{after:15*86400000});assert.equal((await list()).count,0)
 for(const row of remaining.data)assert.equal((await app.call(heldPath+'/'+row.id,{headers:operator})).status,404)
 assert.ok((await audit()).some(row=>row.action==='email.suspended_expired'&&JSON.parse(row.detail_json).count===remaining.count))
 await app.db.prepare("DELETE FROM conversation_ai WHERE ai_id='mail-review-ai'").run()
 await app.configure({OPENAI_API_KEY:undefined})
}
