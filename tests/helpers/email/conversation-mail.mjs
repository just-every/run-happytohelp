import assert from 'node:assert/strict'
import {mailApp,message,recipients,replyTo} from './app.mjs'
import {threadNotifications} from '../r4/notifications.mjs'
import {replyAuthority} from './reply-authority.mjs'
import {tlsEdge} from './tls-edge.mjs'
import {continueViaMailbox} from './imap-thread.mjs'
import {configureSender} from './sender.mjs'
import {sha} from '../../journeys/kit/app.mjs'

// One customer's conversation crosses the Worker, JSON and multipart gateways,
// recovers an interrupted admission and receives the operator's attachment reply.
// Provider rejection and uncertainty remain explicit in the same delivery ledger.
export async function conversationMailJourney(){
 const tls=tlsEdge(),f=await mailApp({tls}),{app,mail}=f
 const gateway=body=>f.gateway(body).then(async response=>({status:response.status,data:await response.json()}))
 const raw=(id,to,text='Please replace my damaged order.')=>message({id,to,from:'Customer <customer@example.com>',text})
 try{
  await app.db.batch([
   app.db.prepare("INSERT INTO users VALUES('mail-owner','owner@example.test','Owner',1)"),
   app.db.prepare("INSERT INTO memberships VALUES('p','mail-owner','owner')"),
   app.db.prepare("INSERT INTO sessions(token_hash,actor_id,project_id,role,expires_at) VALUES(?,'mail-owner','p','owner',?)").bind(sha('mail-owner-token'),Date.now()+3600000),
   app.db.prepare("INSERT INTO session_factors VALUES(?,'mail-owner','password',?)").bind(sha('mail-owner-token'),Date.now()),
   app.db.prepare("INSERT INTO user_project_preferences(project_id,user_id,is_notified_on_unassigned_activity) VALUES('p','op',1)"),
  ])
  const owner='mail-owner-token',notices=await threadNotifications(f,owner)
  await configureSender(f,owner)
  assert.equal((await app.call('/api/integrations/email/inbound',{body:{messageId:'forged'}})).status,403)
  assert.equal(await f.email(raw('first-mail','inbound@example.com'),{from:'customer@example.com',to:'inbound@example.com',direct:true}),undefined)
  const first=await f.claim('first-mail'),id=first.conversation_id,path=`/api/conversations/${id}/messages`
  const transcript=()=>app.ok(path,{token:'operator-token'})
  const initial=await transcript();assert.equal(initial.messages.length,1)
  await notices.admitted(id)
  assert.equal(await f.email(raw('first-mail','inbound@example.com'),{from:'customer@example.com',to:'inbound@example.com',direct:true}),undefined)
  assert.equal((await transcript()).messages.length,1)
  const address=await f.replyAddress(id,'customer@example.com');assert.ok(address.includes('+r.'))
  const reply={messageId:'gateway-reply',to:address,from:'customer@example.com',text:'The seam is torn on the left boot.'}
  assert.equal((await gateway(reply)).status,201);assert.equal((await gateway(reply)).status,200)
  assert.equal((await gateway({...reply,text:'A changed redelivery'})).status,409)
  // Multipart delivery keeps bytes attached to the same existing thread.
  const form=new FormData()
  form.set('envelope',JSON.stringify({to:[address],from:'bounce@relay.example'}));form.set('from','Customer <customer@example.com>');form.set('to',address)
  form.set('headers','From: Customer <customer@example.com>\r\nMessage-ID: <multipart-proof>');form.set('text','Here is my order receipt.');form.set('dkim','{@example.com : pass}')
  // Inbound Parse declares each uploaded part in attachment-info; the part name
  // alone is not the provider's attachment contract.
  form.set('attachment-info',JSON.stringify({attachment1:{filename:'receipt.txt',type:'text/plain'}}))
  form.set('attachment1',new File(['Order TO-4827 receipt bytes'],'receipt.txt',{type:'text/plain'}))
  const encoded=new Request('https://fixture.test',{method:'POST',body:form}),bytes=await encoded.arrayBuffer()
  const multipart=()=>app.request('/api/integrations/email/sendgrid/inbound',{headers:{Authorization:'Bearer fixture-gateway','Content-Type':encoded.headers.get('Content-Type')},body:bytes,raw:true})
  const beforeMultipart=(await transcript()).messages.length,received=await multipart()
  assert.equal(received.status,201);assert.equal((await received.json()).conversationId,id)
  const duplicate=await multipart();assert.equal(duplicate.status,200);assert.equal((await duplicate.json()).conversationId,id)
  const withFile=await transcript(),receipt=withFile.messages.find(m=>m.media?.some(file=>file.filename==='receipt.txt'))
  assert.equal(withFile.messages.length,beforeMultipart+1,'multipart redelivery keeps one customer turn in the intended thread')
  assert.ok(receipt);assert.equal(receipt.media.length,1)
  const download=await app.request(`/api/conversations/${id}/media/${receipt.media[0].id}`,{token:'operator-token'})
  assert.equal(await download.text(),'Order TO-4827 receipt bytes')
  // An admission that failed before commit retries with the same durable claim.
  await app.db.prepare("CREATE TRIGGER mail_admission_fault BEFORE INSERT ON messages BEGIN SELECT RAISE(ABORT,'synthetic mail admission failure'); END").run()
  const failed={messageId:'interrupted-reply',to:address,from:'customer@example.com',text:'An update that must survive.'}
  assert.equal((await gateway(failed)).status,500)
  await app.db.prepare('DROP TRIGGER mail_admission_fault').run()
  await app.db.prepare("UPDATE inbound_emails SET created_at=created_at-180000 WHERE id IN ('interrupted-reply','<interrupted-reply>')").run()
  assert.ok([200,201].includes((await gateway(failed)).status))
  assert.equal((await gateway(failed)).status,200)
  assert.equal((await transcript()).messages.filter(m=>m.content===failed.text).length,1)

  // Human sending uses the authenticated thread, captures recipients and keeps
  // one final reply even if the outbox replays it after a lost acknowledgement.
  const attachment=await app.ok(`/api/conversations/${id}/media`,{token:owner,raw:true,headers:{'Content-Type':'text/plain','X-Filename':'replacement.txt'},body:'Replacement tracking proof'})
  const image=await app.ok(`/api/conversations/${id}/media`,{token:owner,raw:true,headers:{'Content-Type':'image/png','X-Filename':'replacement.png'},body:new Uint8Array([137,80,78,71,13,10,26,10])})
  const head=await transcript(),sentStart=mail.sent.length
  const sent=(await app.call(path,{token:owner,body:{localId:'replacement-reply',content:'Your replacement is booked. <script>unsafe()</script>',mediaIds:[attachment.id,image.id],expectedRevision:head.revision,expectedLastMessageId:head.lastMessageId},status:200})).data
  await app.scheduled()
  const deliveries=mail.sent.slice(sentStart).filter(row=>recipients(row.body).includes('customer@example.com'))
  assert.equal(deliveries.length,1);assert.ok(deliveries[0].body.attachments?.length);assert.equal(deliveries[0].body.attachments.find(f=>f.filename==='replacement.txt').content,btoa('Replacement tracking proof'))
  assert.doesNotMatch(deliveries[0].body.html||'',/<script>/)
  const inline=deliveries[0].body.attachments.find(file=>file.filename==='replacement.png');assert.ok(inline);assert.ok(deliveries[0].body.html.includes('cid:'+inline.content_id))
  assert.ok(replyTo(deliveries[0].body)?.includes('+r.'))
  await f.replay(sent.message);assert.equal(mail.sent.slice(sentStart).filter(row=>recipients(row.body).includes('customer@example.com')).length,1)
  const large=await app.ok(`/api/conversations/${id}/media`,{token:owner,raw:true,headers:{'Content-Type':'application/pdf','X-Filename':'statement.pdf'},body:new Uint8Array(9*1024*1024).fill(65)})
  const richHead=await transcript(),largeStart=mail.sent.length
  await app.ok(path,{token:owner,body:{localId:'large-reply',content:'Your statement is available.',mediaIds:[large.id],expectedRevision:richHead.revision,expectedLastMessageId:richHead.lastMessageId}});await app.scheduled()
  const linked=mail.sent.slice(largeStart).find(e=>e.body.text?.includes('statement.pdf'));assert.ok(linked);assert.ok(!linked.body.attachments?.length)
  const link=new URL(linked.body.text.match(/https:\/\/[^\s]+\/api\/integrations\/email\/files\/[^\s]+/)[0])
  const file=await app.request(link.pathname+link.search);assert.equal(file.status,200);assert.equal((await file.arrayBuffer()).byteLength,9*1024*1024)
  assert.equal((await app.request(link.pathname.replace(/[^/]+$/,'invalid')+link.search)).status,404)
  const beforeUnknown=mail.attempts,latest=await transcript();mail.mode='lost'
  const unknown=(await app.call(path,{token:owner,body:{localId:'unknown-reply',content:'An uncertain follow-up.',expectedRevision:latest.revision,expectedLastMessageId:latest.lastMessageId},status:200})).data
  await app.scheduled()
  assert.ok(mail.attempts>beforeUnknown)
  const state=await app.first("SELECT state FROM email_deliveries WHERE id LIKE ? AND recipient='customer@example.com'",`message:${unknown.message.id}:%`)
  assert.equal(state.state,'uncertain')
  const attempts=mail.attempts;mail.mode='deliver';await f.replay(unknown.message);assert.equal(mail.attempts,attempts)
  await replyAuthority({app,p:'p',owner,inbound:address,gateway:'fixture-gateway',conversationId:id,fixture:mail})
  const afterAuthority=mail.attempts;await f.replay(unknown.message);assert.equal(mail.attempts,afterAuthority,'a changed reply preference never reopens the uncertain recipient command')
  await notices.resolved(id)
  // Check human ticket notices before machine mail makes this ticket ineligible
  // for automatic customer triggers. Machine mail itself remains inert, with
  // provenance retained across restart and scheduled replay.
  await f.idle();const beforeAutomatic=mail.sent.length
  const automatic=message({id:'machine-reply',to:address,headers:'Auto-Submitted: auto-replied\r\n',text:'I am away from the office.'})
  await f.email(automatic,{from:'customer@example.com',to:address,direct:true})
  await app.configure({});await f.idle()
  const machine=(await transcript()).messages.find(m=>m.content==='I am away from the office.')
  assert.ok(machine);assert.equal(machine.origin.automatic,true)
  assert.ok(machine.origin.reasons.includes('auto-submitted'))
  assert.equal(mail.sent.length,beforeAutomatic)
  await f.email(automatic,{from:'customer@example.com',to:address,direct:true});await f.idle();assert.equal(mail.sent.length,beforeAutomatic)
  await continueViaMailbox({f,tls,owner,id})
  // The public message command cannot impersonate the inbound claim namespace.
  const current=await transcript()
  assert.equal((await app.call(path,{token:owner,body:{localId:'email:forged',content:'Forged mail',expectedRevision:current.revision}})).status,400)
 }finally{await f.close()}
}
