import assert from 'node:assert/strict'
import {recipients} from '../email/app.mjs'
import {sha} from '../../journeys/kit/app.mjs'

// One public-door journey. Only mail provider/DNS are network fixtures; persistence,
// sessions, admission, ticket mutation, note mentions and settings use the real app.
export async function notificationTriggersJourney(m){
 const {app,DB,mail,operator}=m
 const base='/api/management/projects/p',ticket=id=>`/api/dashboard/projects/p/conversations/${id}`
 const call=async(path,body,method='PUT',headers=operator)=>{const r=await app.call(path,{headers,method,body});assert.ok(r.status>=200&&r.status<300,`${path}: ${r.status} ${JSON.stringify(r.data)}`);return r.data}
 const notices=(kind,address)=>mail.sent.filter(entry=>entry.body.subject?.includes(kind)&&recipients(entry.body).includes(address))
 const settle=()=>app.scheduled()
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
  await call(`${base}/notification-preferences`,{preferences:[{kind:'mention',inbox:true,email:false},{kind:'follower',inbox:true,email:false},{kind:'group',inbox:true,email:false}]},'PUT',watch)
  await call(ticket(id)+'/notes',{content:'Please inspect @[Watch](user:watch)'},'POST');await settle()
  const inbox=(await call(`${base}/notification-inbox`,undefined,'GET',watch)).data
  assert.ok(inbox.some(row=>row.kind==='mention'));assert.ok(!mail.sent.some(entry=>recipients(entry.body).includes('watch@example.com')))
  await call(ticket(id)+'/followers',{user_ids:['watch']});await settle()
  assert.ok((await call(`${base}/notification-inbox`,undefined,'GET',watch)).data.some(row=>row.kind==='follower'))
  await m.gateway({...request,messageId:'machine-mail',from:'machine@example.com',cc:[],headers:{'Auto-Submitted':'auto-replied'}});await settle()
  assert.ok(!mail.sent.some(entry=>recipients(entry.body).includes('machine@example.com')))
  return id
}
