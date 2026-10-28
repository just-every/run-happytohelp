import assert from 'node:assert/strict'
import {mailApp,message} from './app.mjs'
import {sha} from '../../journeys/kit/app.mjs'

// One lead reviews a batch for the same mailbox. Nothing in that batch may act as a customer
// until the lead chooses a safe recovery; deletion and expiry remove the retained custody.
export async function suspendedMailJourney(){
 const f=await mailApp(),{app,mail}=f,base='/api/management/projects/p'
 const owner='review-owner',call=(path,body,method,token=owner)=>app.ok(base+path,{token,body,...(method?{method}:{})})
 const list=()=>call('/suspended'),detail=id=>call('/suspended/'+id)
 const receive=async(id,from,headers='',text='Please inspect my order.')=>f.email(message({id,to:'inbound@example.com',from,headers,text,authenticated:!headers.includes('Authentication-Results:')}),{from,to:'inbound@example.com',direct:true})
 try{
  await app.db.batch([
   app.db.prepare("INSERT INTO users VALUES('review-owner','owner@example.test','Review lead',1)"),
   app.db.prepare("INSERT INTO memberships VALUES('p','review-owner','owner')"),
   app.db.prepare("INSERT INTO sessions(token_hash,actor_id,project_id,role,expires_at) VALUES(?,'review-owner','p','owner',?)").bind(sha(owner),Date.now()+3600000),
   app.db.prepare("INSERT INTO session_factors VALUES(?,'review-owner','password',?)").bind(sha(owner),Date.now()),
   app.db.prepare("INSERT INTO contacts(id,project_id,email,external_id,is_verified,created_at) VALUES('verified','p','verified@customer.example','verified@customer.example',1,1)"),
   app.db.prepare("INSERT INTO member_roles VALUES('p','op','collaborator',1)"),
  ])
  await f.gateway({messageId:'ordinary',to:'inbound@example.com',from:'verified@customer.example',subject:'My order',text:'Please check my order.'})
  const id=(await f.claim('ordinary')).conversation_id
  await f.idle();await app.takeJobs();const outgoing=mail.sent.length,attempts=mail.attempts
  const tickets=(await app.ok('/api/dashboard/projects/p/conversations?view=all',{token:owner})).data.length
  await call('/sender-rules',{address:'blocked@customer.example',action:'block'})
  const auth='Authentication-Results: mx.cloudflare.net; dkim=fail header.d=customer.example; spf=fail smtp.mailfrom=customer.example; dmarc=fail header.from=customer.example\r\n'
  await receive('spam','spam@customer.example','X-Spam-Score: 9\r\n')
  await receive('dmarc','unverified@customer.example',auth)
  await receive('blocked','blocked@customer.example')
  await receive('loop','support@example.com')
  const attachment='Review this payment instruction.'
  const spoof=message({id:'spoof',to:'inbound@example.com',from:'verified@customer.example',headers:auth,authenticated:false,type:'multipart/mixed; boundary=review',text:`--review\r\nContent-Type: text/plain\r\n\r\n<script>unsafe()</script>New bank details.\r\n--review\r\nContent-Type: text/plain\r\nContent-Disposition: attachment; filename=instruction.txt\r\n\r\n${attachment}\r\n--review--`})
  await f.email(spoof,{from:'verified@customer.example',to:'inbound@example.com',direct:true})
  const batch=await list();assert.equal(batch.count,5);assert.ok(batch.oldest_at);assert.ok(batch.reasons.some(r=>r.reason==='authentication_failed'));assert.ok(batch.reasons.some(r=>r.reason==='mail_loop'))
  for(const row of batch.data){const held=(await detail(row.id)).data;assert.ok(held.headers_json);assert.ok(held.auth_json);assert.ok(held.expires_at>held.created_at)}
  await f.idle();assert.equal(mail.sent.length,outgoing);assert.equal(mail.attempts,attempts)
  assert.equal((await app.ok('/api/dashboard/projects/p/conversations?view=all',{token:owner})).data.length,tickets)
  assert.deepEqual(await app.takeJobs(),[],'suspended mail starts no AI or notification work')
  const forged=batch.data.find(row=>row.from_address==='verified@customer.example'),held=(await detail(forged.id)).data
  assert.equal(held.attachments.length,1)
  assert.equal((await call(`/suspended/${forged.id}/attachments/0`)).text,attachment)
  for(const [path,body,method] of [[`/suspended`,undefined,'GET'],[`/suspended/${forged.id}`,undefined,'GET'],[`/suspended/${forged.id}/attachments/0`,undefined,'GET'],[`/suspended/${forged.id}/recover`,{conversationId:id,asNote:true},'POST'],[`/suspended/${forged.id}`,undefined,'DELETE'],['/sender-rules',{address:'blocked@customer.example',action:'allow'},'POST'],['/sender-rules',undefined,'GET']]){
   assert.equal((await app.call(base+path,{token:'operator-token',body,method})).status,403,path)
  }
  assert.equal((await app.call(base+`/suspended/${forged.id}/recover`,{token:owner,body:{conversationId:id}})).status,409,'forged sender never becomes the customer')
  await call(`/suspended/${forged.id}/recover`,{conversationId:id,asNote:true})
  const bucket=(await app.ok(`/api/dashboard/projects/p/conversations/${id}/buckets/${id}`,{token:owner})).data
  assert.ok(bucket.events.some(e=>e.type==='INTERNAL_NOTE'&&e.content?.includes('unverified sender')))
  // DMARC-failing mail remains private on recovery. Verified spam false positives can be
  // admitted as ordinary customer messages, both into an existing thread and a new ticket.
  const dmarc=batch.data.find(row=>row.from_address==='unverified@customer.example')
  const privateTicket=await call(`/suspended/${dmarc.id}/recover`,{conversationId:'',asNote:true});assert.notEqual(privateTicket.conversationId,id)
  await receive('false-positive-existing','verified@customer.example','X-Spam-Score: 9\r\n','An update for my order.')
  const existing=(await list()).data.find(row=>row.from_address==='verified@customer.example')
  assert.equal((await call(`/suspended/${existing.id}/recover`,{conversationId:id})).conversationId,id)
  const spam=batch.data.find(row=>row.from_address==='spam@customer.example')
  const recovered=await call(`/suspended/${spam.id}/recover`,{conversationId:''});assert.notEqual(recovered.conversationId,id)
  await f.idle();assert.equal(mail.sent.length,outgoing,'review never retroactively acknowledges or asks AI to answer')
  await call('/sender-rules',{address:'@customer.example',action:'block'})
  assert.equal((await f.gateway({messageId:'domain-blocked',to:'inbound@example.com',from:'new@customer.example',text:'Help with my order.'})).status,201)
  assert.equal((await f.claim('domain-blocked')).state,'suspended')
  await call('/sender-rules',{address:'@customer.example',action:'remove'})
  await call('/sender-rules',{address:'blocked@customer.example',action:'allow'})
  const rules=(await call('/sender-rules')).data;assert.ok(rules.some(r=>r.address==='blocked@customer.example'&&r.action==='allow'))
  await receive('true-spam','true-spam@customer.example','X-Spam-Score: 9\r\n')
  const trueSpam=(await list()).data.find(row=>row.from_address==='true-spam@customer.example');await call(`/suspended/${trueSpam.id}`,undefined,'DELETE')
  const blocked=batch.data.find(row=>row.from_address==='blocked@customer.example')
  await call(`/suspended/${blocked.id}`,undefined,'DELETE')
  assert.equal((await f.gateway({messageId:'allowed-redelivery',to:'inbound@example.com',from:'blocked@customer.example',headers:{'X-Spam-Score':'9'},text:'Please inspect this order.'})).status,201)
  assert.equal((await f.claim('allowed-redelivery')).state,'delivered')
  await receive('expiry','expire@customer.example','X-Spam-Score: 9\r\n')
  const expiring=(await list()).data[0]
  await app.scheduled(undefined,{after:15*86400000});assert.equal((await list()).count,0)
  const audit=(await call('/audit?limit=200')).data
  for(const action of ['email.suspended_recovered','email.suspended_recovered_note','email.suspended_deleted','email.suspended_expired','email.sender_allow'])assert.ok(audit.some(row=>row.action===action),action)
  assert.equal((await app.call(base+`/suspended/${expiring.id}`,{token:owner})).status,404)
  await f.email(spoof.replace('<spoof>','<erase-held>'),{from:'verified@customer.example',to:'inbound@example.com',direct:true})
  const erasedHeld=(await list()).data[0]
  await call('/contacts/verified/erase',{})
  assert.equal((await app.call(base+`/suspended/${erasedHeld.id}`,{token:owner})).status,404)
  assert.equal((await app.call(base+`/suspended/${erasedHeld.id}/attachments/0`,{token:owner})).status,404)
  const erased=(await app.ok(`/api/conversations/${id}/messages`,{token:owner})).messages
  assert.ok(erased.every(m=>!m.content||!m.content.includes('Please check my order')))
 }finally{await f.close()}
}
