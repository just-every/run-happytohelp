import assert from 'node:assert/strict'
import {mailApp,recipients,replyTo} from '../email/app.mjs'
import {sha} from '../../journeys/kit/app.mjs'

// One public-door journey. Only mail provider/DNS are network fixtures; persistence,
// sessions, admission, ticket mutation, note mentions and settings use the real app.
export async function notificationTriggersJourney(){
 const m=await mailApp(),{app,DB,mail,operator}=m
 const base='/api/management/projects/p',ticket=id=>`/api/dashboard/projects/p/conversations/${id}`
 const call=async(path,body,method='PUT',headers=operator)=>{const r=await app.call(path,{headers,method,body});assert.ok(r.status>=200&&r.status<300,`${path}: ${r.status} ${JSON.stringify(r.data)}`);return r.data}
 const notices=(kind,address)=>mail.sent.filter(entry=>entry.body.subject?.includes(kind)&&recipients(entry.body).includes(address))
 const settle=()=>app.scheduled()
 try{
  await DB.batch([
   DB.prepare("UPDATE memberships SET role='owner' WHERE project_id='p' AND user_id='op'"),DB.prepare("UPDATE sessions SET role='owner' WHERE actor_id='op'"),
   DB.prepare("INSERT INTO users VALUES('watch','watch@example.com','Watch',1),('quiet','quiet@example.com','Quiet',1)"),
   DB.prepare("INSERT INTO memberships VALUES('p','watch','operator'),('p','quiet','operator')"),
   DB.prepare("INSERT INTO member_roles(project_id,user_id,role_key,assigned_at) VALUES('p','watch','collaborator',1)"),
   DB.prepare("INSERT INTO sessions(token_hash,actor_id,project_id,role,expires_at) VALUES(?,'watch','p','operator',?)").bind(sha('watch-token'),Date.now()+3600000),
   // cc@ is independently proven (a widget-signed identity); a Cc header alone proves nothing.
   DB.prepare("INSERT INTO contacts(id,project_id,email,external_id,is_verified,metadata_json,created_at) VALUES('signed-cc','p','cc@example.com','cc@example.com',1,'{}',1)"),
  ])
  const watch={Authorization:'Bearer watch-token'}
  const settings=await call(`${base}/notification-triggers`,undefined,'GET')
  await call(`${base}/notification-triggers`,{triggers:settings.data.map(row=>({...row,expected_reply_time:'within two business hours'}))})
  assert.equal((await app.call(`${base}/notification-triggers`,{headers:watch,method:'PUT',body:{triggers:settings.data}})).status,403,'collaborator cannot change workspace triggers')
  const request={messageId:'r4-request',to:'inbound@example.com',from:'requester@example.com',cc:['cc@example.com','CC@example.com','never-seen1@example.net','never-seen2@example.org'],text:'Please help with my order'}
  assert.equal((await m.gateway(request)).status,201);await settle()
  const id=(await m.claim(request.messageId)).conversation_id,first=await m.admitted(request.messageId)
  for(const address of ['requester@example.com','cc@example.com']){
   assert.equal(notices('received',address).length,1)
   assert.match(notices('received',address)[0].body.text,new RegExp(id))
   assert.match(notices('received',address)[0].body.text,/two business hours/)
   assert.equal(notices('received',address)[0].body.headers['X-Auto-Response-Suppress'],'All')
  }
  // K3: Cc addresses that never wrote to the desk get no notice.
  for(const address of ['never-seen1@example.net','never-seen2@example.org'])assert.equal(notices('received',address).length,0,`${address} is an unproven CC`)
  await m.gateway(request);await m.replay(first);await settle()
  assert.equal(notices('received','requester@example.com').length,1)
  await call(ticket(id),{resolved:true});await settle();await call(ticket(id),{resolved:false});await call(ticket(id),{resolved:true});await settle()
  assert.equal(notices('solved','requester@example.com').length,1);assert.equal(notices('solved','cc@example.com').length,1)
  assert.equal(notices('solved','never-seen1@example.net').length+notices('solved','never-seen2@example.org').length,0)
  const audit=await call(`${base}/audit?limit=200`,undefined,'GET')
  assert.ok(audit.data.some(event=>event.action==='notifications.delivery_outcome'&&event.target_id===id),'notification outcome appears in the workspace audit log')
  // Widget's own typed address is a destination, never a proven CC identity.
  await DB.batch([
   DB.prepare("INSERT INTO contacts(id,project_id,name,email,metadata_json,created_at) VALUES('widget-contact','p','Widget','widget@example.com','{\"email_unproven\":1}',1)"),
   DB.prepare("INSERT INTO sessions(token_hash,actor_id,project_id,role,contact_id,expires_at) VALUES(?,'widget-contact','p','contact','widget-contact',?)").bind(sha('widget-token'),Date.now()+3600000),
  ])
  const widget=await app.call('/api/conversations',{token:'widget-token',body:{projectId:'p'},status:201}),widgetId=widget.data.id
  await app.call(`/api/conversations/${widgetId}/messages`,{token:'widget-token',body:{localId:'widget-request',content:'A widget question',expectedRevision:0},status:200});await settle()
  assert.equal(notices('received','widget@example.com').length,1)
  // Automatic mail is inert; imported history remains inert on native updates.
  await m.gateway({...request,messageId:'r4-machine',from:'machine@example.com',cc:[],headers:{'Auto-Submitted':'auto-replied'}});await settle()
  assert.equal(mail.sent.some(entry=>recipients(entry.body).includes('machine@example.com')),false)
  await DB.batch([
   DB.prepare("INSERT INTO contacts(id,project_id,email,created_at) VALUES('imported','p','imported@example.com',1)"),
   DB.prepare("INSERT INTO conversations(id,project_id,contact_id,created_at,updated_at) VALUES('imported-ticket','p','imported',1,1)"),
   DB.prepare("INSERT INTO move_in_conversations VALUES('imported-ticket','p','zendesk','source-1','Old question','open','email')"),
  ])
  await call(ticket('imported-ticket'),{resolved:true});await settle()
  assert.equal(mail.sent.some(entry=>recipients(entry.body).includes('imported@example.com')),false)
  // Per-person inbox/email choices, collaborators, self suppression and current membership.
  await call(`${base}/notification-preferences`,{preferences:[{kind:'mention',inbox:true,email:false},{kind:'follower',inbox:true,email:false}]},'PUT',watch)
  await call(ticket(id)+'/notes',{content:'Please check @[Watch](user:watch) and @[Operator](user:op)'},'POST');await settle()
  let inbox=await call(`${base}/notification-inbox`,undefined,'GET',watch)
  assert.equal(inbox.data.filter(row=>row.kind==='mention').length,1)
  assert.equal(mail.sent.some(entry=>recipients(entry.body).includes('watch@example.com')),false)
  const own=await call(`${base}/notification-inbox`,undefined,'GET');assert.equal(own.data.filter(row=>row.kind==='mention').length,0)
  await call(`${base}/notification-inbox/${encodeURIComponent(inbox.data[0].id)}/read`,undefined,'PUT',watch)
  assert.ok((await call(`${base}/notification-inbox`,undefined,'GET',watch)).data[0].read_at)
  await call(ticket(id)+'/followers',{user_ids:['watch']});await settle()
  inbox=await call(`${base}/notification-inbox`,undefined,'GET',watch);assert.equal(inbox.data.filter(row=>row.kind==='follower').length,1)
  await call(`${base}/notification-preferences`,{preferences:[{kind:'assignment',inbox:true,email:true}]},'PUT',watch)
  await call(ticket(id),{agent_id:'watch'});await settle()
  assert.equal(mail.sent.filter(entry=>recipients(entry.body).includes('watch@example.com')).length,1)
  assert.equal((await call(`${base}/notification-inbox`,undefined,'GET',watch)).data.filter(row=>row.kind==='assignment').length,1)
  // Unknown paid outcome is terminal even when the scheduler and message replay run again.
  mail.mode='lost';const attempts=mail.attempts
  await call(ticket(id)+'/notes',{content:'Please inspect @[Quiet](user:quiet)'},'POST');await settle();await settle()
  assert.equal(mail.attempts-attempts,1)
  assert.equal((await DB.prepare("SELECT state FROM email_deliveries WHERE recipient='quiet@example.com'").first()).state,'uncertain')
  mail.mode='deliver'
  // Process loss immediately after the inbox claim leaves a visible unknown
  // outcome, even before a provider call exists. Recovery never replays it.
  const beforeCrash=mail.attempts
  await app.call(ticket(id)+'/notes',{headers:{...operator,'x-test-fault':'db-interrupt','x-test-statement':"UPDATE notification_inbox SET state='uncertain'"},method:'POST',body:{content:'Check this separately @[Quiet](user:quiet)'}})
  const interrupted=await DB.prepare("SELECT id,state FROM notification_inbox WHERE user_id='quiet' AND kind='mention' AND NOT EXISTS(SELECT 1 FROM email_deliveries e WHERE e.id=notification_inbox.id) ORDER BY created_at DESC LIMIT 1").first()
  assert.ok(interrupted);assert.equal(interrupted.state,'uncertain');assert.equal(mail.attempts,beforeCrash)
  await settle();await settle()
  assert.equal((await DB.prepare('SELECT state FROM notification_inbox WHERE id=?').bind(interrupted.id).first()).state,'uncertain')
  assert.equal(mail.attempts,beforeCrash,'a crashed claim is not permission to replay mail')
  // Old-version sending claims also settle without a new provider attempt.
  await DB.prepare("UPDATE notification_inbox SET state='sending' WHERE id=?").bind(interrupted.id).run()
  await settle()
  const quiet={Authorization:'Bearer quiet-token'}
  await DB.prepare("INSERT INTO sessions(token_hash,actor_id,project_id,role,expires_at) VALUES(?,'quiet','p','operator',?)").bind(sha('quiet-token'),Date.now()+3600000).run()
  assert.equal((await call(`${base}/notification-inbox`,undefined,'GET',quiet)).data.find(row=>row.id===interrupted.id).state,'uncertain')
  assert.equal(mail.attempts,beforeCrash)
  await call(`${base}/notification-preferences`,{preferences:[{kind:'group',inbox:true,email:false}]},'PUT',watch)
  const group=await call(`${base}/ticket-groups`,{name:'Shipping',members:['watch']},'POST')
  const groupId=group.id??group.data?.id
  const current=await DB.prepare('SELECT ticket_version FROM conversations WHERE id=?').bind(widgetId).first()
  await call(ticket(widgetId)+'/ticket',{expected_version:current.ticket_version,group_id:groupId},'PATCH');await settle()
  assert.equal((await call(`${base}/notification-inbox`,undefined,'GET',watch)).data.filter(row=>row.kind==='group').length,1)
  // Customer notice uncertainty also freezes its whole recipient command.
  mail.mode='lost';const customerAttempts=mail.attempts
  const lostRequest={messageId:'r4-lost-customer',to:'inbound@example.com',from:'lost@example.com',text:'Can you help?'}
  await m.gateway(lostRequest);await settle()
  await m.gateway(lostRequest);await m.replay(await m.admitted(lostRequest.messageId));await settle()
  assert.equal(mail.attempts-customerAttempts,1)
  mail.mode='deliver'
  // Erasure winning the notification claim removes its authority before any send.
  const raced=await app.call('/api/conversations',{token:'widget-token',body:{projectId:'p'},status:201})
  const raceBefore=mail.sent.length
  await app.call(`/api/conversations/${raced.data.id}/messages`,{token:'widget-token',headers:{'x-test-statement':'INSERT OR IGNORE INTO notification_trigger_claims','x-test-before-statement':`UPDATE contacts SET metadata_json=json_set(metadata_json,'$.is_erasing',1) WHERE id='widget-contact'`},body:{localId:'race-request',content:'A final request',expectedRevision:0},status:200});await settle()
  assert.equal(mail.sent.length,raceBefore)
  // A sender's 40 Cc addresses and own subject reach nobody but the sender; a Cc participant
  // that writes back through the reply address the desk issued it is proven from then on.
  await call(`${base}/notification-triggers`,{triggers:settings.data.map(row=>row.event==='request_received'?{...row,subject:'Re: {{ticket.subject}}'}:row)})
  const bulkCc=Array.from({length:40},(_,index)=>`bulk${index}@victims${index}.example`),bulkSent=mail.sent.length
  const bulk={messageId:'r4-bulk-cc',to:'inbound@example.com',from:'bulk@example.com',cc:bulkCc,subject:'Visit http://spam.example now',text:'Hello'}
  assert.equal((await m.gateway(bulk)).status,201);await settle()
  const subjectMail=mail.sent.slice(bulkSent).filter(entry=>entry.body.subject?.includes('spam.example'))
  assert.deepEqual(subjectMail.map(entry=>recipients(entry.body)),[['bulk@example.com']],'only the requester receives the notice and its subject')
  assert.equal(mail.sent.slice(bulkSent).some(entry=>recipients(entry.body).some(address=>bulkCc.includes(address))),false,'unproven Cc addresses receive no automatic mail')
  // A person deliberately shares the transcript before this participant can
  // prove its mailbox by using the desk-issued reply address.
  await call(ticket((await m.claim(bulk.messageId)).conversation_id),{send_transcript_to:'bulk0@victims0.example',idempotencyKey:'r4-bulk-transcript'})
  const bulkId=(await m.claim(bulk.messageId)).conversation_id,relay=mail.sent.slice(bulkSent).find(entry=>recipients(entry.body).includes('bulk0@victims0.example'))
  assert.equal((await m.gateway({messageId:'r4-bulk-cc-reply',to:replyTo(relay.body),from:'bulk0@victims0.example',text:'I am on this order too'})).status,201);await settle()
  const joined=(await call(ticket(bulkId),undefined,'GET')).data.participants
  assert.equal(joined.find(row=>row.email==='bulk0@victims0.example').pivot.joined_via,'self')
  assert.ok(joined.filter(row=>row.email!=='bulk0@victims0.example').every(row=>row.pivot.joined_via==='cc_header'))
  await call(ticket(bulkId),{resolved:true});await settle()
  assert.deepEqual(mail.sent.slice(bulkSent).filter(entry=>entry.body.subject?.includes('solved')).map(entry=>recipients(entry.body)[0]).sort(),['bulk0@victims0.example','bulk@example.com'])
  await noticeAddresses(m,call,notices,settle)
  // Missing placeholders are a visible failure and never customer text.
  await call(`${base}/notification-triggers`,{triggers:settings.data.map(row=>({...row,body:'Hello {{ticket.custom.nonexistent}}'}))})
  await m.gateway({...lostRequest,messageId:'r4-template-error',from:'template-error@example.com'});await settle()
  const outcomes=await call(`${base}/notification-triggers`,undefined,'GET')
  assert.ok(outcomes.outcomes.some(row=>row.state==='template_error'&&row.outcome.error.includes('nonexistent')))
  assert.equal(mail.sent.some(entry=>recipients(entry.body).includes('template-error@example.com')),false)
  await DB.prepare("DELETE FROM memberships WHERE project_id='p' AND user_id='quiet'").run()
  const before=mail.sent.length
  const denied=await app.call(ticket(id)+'/notes',{headers:operator,method:'POST',body:{content:'No access @[Quiet](user:quiet)'}})
  assert.equal(denied.status,403);await settle();assert.equal(mail.sent.length,before)
 }finally{await m.close()}
}

// Address provenance rows in the same journey: eligibility must not let a
// customer's Reply-To or collector preference redirect automatic notices.
async function noticeAddresses(m,call,notices,settle){
 const {app,DB}=m,base='/api/management/projects/p',ticket=id=>`/api/dashboard/projects/p/conversations/${id}`
 const send=async(from,replyTo,cc=[])=>{
  const messageId=crypto.randomUUID()
  assert.equal((await m.gateway({messageId,to:'inbound@example.com',from,replyTo,cc,subject:'Address provenance',text:'Please help'})).status,201)
  await settle();return (await m.claim(messageId)).conversation_id
 }
 const requester='from-proof@example.com',victim='reply-to-victim@example.net'
 const id=await send(requester,victim)
 assert.equal(notices('Re: Address provenance',requester).length,1)
 assert.equal(notices('Re: Address provenance',victim).length,0)
 // Old clients resubmit the full profile. A phone edit, including normalized
 // unchanged aliases, never turns a Reply-To into an operator choice.
 const profilePath=`${base}/contacts/${(await DB.prepare('SELECT contact_id FROM conversations WHERE id=?').bind(id).first()).contact_id}`
 const profile=(await call(profilePath,undefined,'GET')).data
 await call(profilePath,{...profile,...JSON.parse(profile.metadata_json),provided_email:` ${victim.toUpperCase()} `,phone:'+1 555 0100'})
 assert.equal(JSON.parse((await call(profilePath,undefined,'GET')).data.metadata_json).provided_email_source,'reply_to')
 for(const path of [profilePath,profilePath.replace('/management/','/dashboard/')]){
  const rejected=await app.call(path,{method:'PUT',headers:m.operator,body:{provided_email:'phone only please'}})
  assert.equal(rejected.status,400);assert.match(JSON.stringify(rejected.data),/provided_email/)
 }
 await call(ticket(id),{resolved:true});await settle()
 assert.equal(notices('solved',requester).length,1);assert.equal(notices('solved',victim).length,0)
 const cc=Array.from({length:5},(_,i)=>`proven-${i}@example.com`)
 for(const [i,address] of cc.entries())await send(address,`amplified-${i}@example.net`)
 const amplified=await send('cc-boss@example.com',undefined,cc)
 await call(ticket(amplified),{resolved:true});await settle()
 for(const [i,address] of cc.entries()){
  assert.equal(notices('Re: Address provenance',address).length,2)
  assert.equal(notices('solved',address).length,1)
  assert.equal(notices('Re: Address provenance',`amplified-${i}@example.net`).length,0)
  assert.equal(notices('solved',`amplified-${i}@example.net`).length,0)
 }
 // An authenticated widget signature proves the identity address, not the
 // different address typed into that identity's collector (including on its own ticket).
 const {createHmac}=await import('node:crypto'),secret='notice-address-secret'
 await DB.prepare('UPDATE projects SET verification_secret=? WHERE id=?').bind(secret,'p').run()
 const address='signed-proven@example.com',typed='widget-victim@example.net'
 const session=await app.call('/api/identity/widget/session',{body:{widgetKey:'w',identifier:address,email:address,contact_hash:createHmac('sha256',secret).update(address).digest('hex')},headers:{Origin:'https://example.com'},status:201})
 const widget=await app.call('/api/conversations',{token:session.data.token,body:{projectId:'p'},status:201})
 await app.call(`/api/conversations/${widget.data.id}/widget-events`,{token:session.data.token,body:{action:'contact',data:{provided_email:typed}},status:200})
 await call(`${base}/contacts/${session.data.contactId}`,{provided_email:typed,phone:'+1 555 0101'})
 assert.equal(JSON.parse((await DB.prepare('SELECT metadata_json FROM contacts WHERE id=?').bind(session.data.contactId).first()).metadata_json).provided_email_source,'widget')
 const invalidWidget=await app.call(`/api/conversations/${widget.data.id}/widget-events`,{token:session.data.token,body:{action:'contact',data:{provided_email:'not a mailbox'}}})
 assert.equal(invalidWidget.status,400);assert.match(JSON.stringify(invalidWidget.data),/provided_email/)
 await app.call(`/api/conversations/${widget.data.id}/messages`,{token:session.data.token,body:{localId:'signed-widget-notice',content:'My own widget ticket',expectedRevision:0},status:200});await settle()
 assert.equal(notices('Re: My own widget ticket',address).length,1)
 assert.equal(notices('Re: My own widget ticket',typed).length,0)
 const shared=await send('widget-cc-boss@example.com',undefined,[address])
 assert.equal(notices('Re: Address provenance',address).length,1)
 await call(ticket(shared),{resolved:true});await settle()
 assert.equal(notices('solved',address).length,1)
 assert.equal(notices('Re: Address provenance',typed).length+notices('solved',typed).length,0)
 // An operator explicitly choosing a preferred address makes that address usable.
 const operatorTicket=await send('operator-source@example.com','unproven-before@example.net')
 const contact=(await DB.prepare('SELECT contact_id FROM conversations WHERE id=?').bind(operatorTicket).first()).contact_id
 const chosenAt=Date.now()
 await call(`${base}/contacts/${contact}`,{provided_email:'chosen-by-operator@example.net'})
 const chosen=JSON.parse((await DB.prepare('SELECT metadata_json FROM contacts WHERE id=?').bind(contact).first()).metadata_json)
 assert.deepEqual(chosen.provided_email_set_by,{type:'user',id:'op'});assert.ok(chosen.provided_email_set_at>=chosenAt)
 await call(`${base}/contacts/${contact}`,{provided_email:' CHOSEN-BY-OPERATOR@example.net ',phone:'+1 555 0102'})
 assert.deepEqual(JSON.parse((await DB.prepare('SELECT metadata_json FROM contacts WHERE id=?').bind(contact).first()).metadata_json),{...chosen,phone:'+1 555 0102'})
 await call(ticket(operatorTicket),{resolved:true});await settle()
 assert.equal(notices('solved','chosen-by-operator@example.net').length,1)
 assert.equal(notices('solved','operator-source@example.com').length,0)
 assert.equal(notices('solved','unproven-before@example.net').length,0)
 // Historical unmarked preferences fail closed rather than becoming operator choices.
 const old=await send('historical-preference@example.com')
 await DB.prepare("UPDATE contacts SET metadata_json=json_set(metadata_json,'$.provided_email','unknown-victim@example.net') WHERE id=(SELECT contact_id FROM conversations WHERE id=?)").bind(old).run()
 await call(ticket(old),{resolved:true});await settle()
 assert.equal(notices('solved','historical-preference@example.com').length,1)
 assert.equal(notices('solved','unknown-victim@example.net').length,0)
 // A historical invalid operator preference must not fall through to a Cc
 // address that nobody proved, even though the old source says operator.
 const legacyCc='invalid-preference-cc@example.net'
 const invalidTicket=await send('invalid-preference-sender@example.com',undefined,[legacyCc])
 await DB.prepare("UPDATE contacts SET metadata_json=json_set(metadata_json,'$.provided_email','phone only please','$.provided_email_source','operator') WHERE email=?").bind(legacyCc).run()
 await call(ticket(invalidTicket),{resolved:true});await settle()
 assert.equal(notices('solved',legacyCc).length,0)
 // A widget's origin survives email replies; an actual consumed grant also
 // proves its exact mailbox on a new email ticket after Closed.
 for(const closed of [false,true]){
  const email=`widget-grant-${closed}@example.net`,s=await app.call('/api/identity/widget/session',{body:{widgetKey:'w',email},headers:{Origin:'https://example.com'},status:201})
  const w=(await app.call('/api/conversations',{token:s.data.token,body:{projectId:'p'},status:201})).data
  await app.call(`/api/conversations/${w.id}/messages`,{token:s.data.token,body:{localId:'grant-widget-request',content:'Grant widget request',expectedRevision:0},status:200});await settle()
  const grant=await m.replyAddress(w.id,email)
  if(closed){const current=(await call(ticket(w.id)+'/ticket',undefined,'GET')).data;await call(ticket(w.id)+'/ticket',{expected_version:current.ticket_version,status_id:'closed'},'PATCH')}
  const form=new FormData(),messageId=`widget-grant-${closed}@example.net`
  for(const [key,value] of Object.entries({from:email,to:grant,subject:'My email follow-up',text:'My email follow-up',SPF:'none',envelope:JSON.stringify({from:email,to:[grant]}),headers:`Message-ID: <${messageId}>\r\nFrom: ${email}\r\nTo: ${grant}`}))form.set(key,value)
  const encoded=new Request('https://sendgrid.example',{method:'POST',body:form})
  const inbound=await app.request('/api/integrations/email/sendgrid/inbound',{method:'POST',raw:true,headers:{Authorization:'Bearer fixture-gateway','Content-Type':encoded.headers.get('Content-Type')},body:await encoded.arrayBuffer()})
  assert.equal(inbound.status,201);await settle()
  const receipt=await m.claim(messageId),proof=JSON.parse(receipt.evidence_json)
  assert.equal(proof.sender_verified,false);assert.equal(proof.grant.recipient,email)
  if(closed){assert.notEqual(receipt.conversation_id,w.id);assert.equal(notices('Re: My email follow-up',email).length,1)}
  else assert.equal((await DB.prepare('SELECT channel FROM conversations WHERE id=?').bind(w.id).first()).channel,'widget')
  const solvedBefore=notices('solved',email).length
  await call(ticket(receipt.conversation_id),{resolved:true});await settle();await settle()
  assert.equal(notices('solved',email).length-solvedBefore,1)
 }
}
