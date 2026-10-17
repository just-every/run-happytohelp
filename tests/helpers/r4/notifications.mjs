import assert from 'node:assert/strict'
import {mailApp,recipients} from '../email/app.mjs'
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
  ])
  const watch={Authorization:'Bearer watch-token'}
  const settings=await call(`${base}/notification-triggers`,undefined,'GET')
  await call(`${base}/notification-triggers`,{triggers:settings.data.map(row=>({...row,expected_reply_time:'within two business hours'}))})
  assert.equal((await app.call(`${base}/notification-triggers`,{headers:watch,method:'PUT',body:{triggers:settings.data}})).status,403,'collaborator cannot change workspace triggers')
  const request={messageId:'r4-request',to:'inbound@example.com',from:'requester@example.com',cc:['cc@example.com','CC@example.com'],text:'Please help with my order'}
  assert.equal((await m.gateway(request)).status,201);await settle()
  const id=(await m.claim(request.messageId)).conversation_id,first=await m.admitted(request.messageId)
  for(const address of ['requester@example.com','cc@example.com']){
   assert.equal(notices('received',address).length,1)
   assert.match(notices('received',address)[0].body.text,new RegExp(id))
   assert.match(notices('received',address)[0].body.text,/two business hours/)
   assert.equal(notices('received',address)[0].body.headers['X-Auto-Response-Suppress'],'All')
  }
  await m.gateway(request);await m.replay(first);await settle()
  assert.equal(notices('received','requester@example.com').length,1)
  await call(ticket(id),{resolved:true});await settle();await call(ticket(id),{resolved:false});await call(ticket(id),{resolved:true});await settle()
  assert.equal(notices('solved','requester@example.com').length,1);assert.equal(notices('solved','cc@example.com').length,1)
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
