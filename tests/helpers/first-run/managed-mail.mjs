import assert from 'node:assert/strict'
import {managedInstallation} from '../email/rer-mail.mjs'
import {managedEdge,mime} from '../email/rer-edge.mjs'
export async function managedFirstRunJourney(){
 const i=await managedInstallation('first'),{app,edge,owner,assigned}=i
 try{
  const first=await i.settings();assert.equal(first.configured,true);assert.equal(first.data.inbound_address,assigned.RER_MAIL_ADDRESS);assert.equal(first.managed.state,'active');assert.equal(edge.sends[0].payload.to[0],'owner-first@example.test')
  await app.ok(`/api/management/projects/${owner.projectId}/email-settings/managed/retry`,{token:owner.token,method:'POST'});assert.equal((await i.settings()).managed.address,assigned.RER_MAIL_ADDRESS,'repeated binding returns its original assignment')
  const retried=await app.first("SELECT actor_type,actor_id FROM audit_events WHERE project_id=? AND action='managed_mail.retry_requested'",owner.projectId);assert.equal(retried.actor_type,'user');assert.ok(retried.actor_id)
  assert.ok(await app.first("SELECT 1 FROM audit_events WHERE project_id=? AND action='managed_mail.bound'",owner.projectId))
  const activation=await app.ok(`/api/management/projects/${owner.projectId}/activation`,{token:owner.token});assert.equal(activation.data.facts.mail.managed.address,assigned.RER_MAIL_ADDRESS);assert.ok(!activation.data.steps.some(row=>['sender_dns','inbound_address'].includes(row.id)&&row.placement==='needs_you'))
  assert.equal((await app.call('/api/identity/forgot-password',{body:{email:'owner-first@example.test'},status:200})).status,200);assert.ok(edge.sends.some(row=>row.payload.text.toLowerCase().includes('password')))
  await app.ok(`/api/management/projects/${owner.projectId}/settings`,{token:owner.token,method:'PUT',body:{name:'Northstar Support'}})
  assert.equal((await i.settings()).managed.address,assigned.RER_MAIL_ADDRESS)
  const original=edge.installations.get(assigned.MAIL_API_KEY),rotated='synthetic-rotated-relay-authority';edge.installations.set(rotated,original);edge.installations.delete(assigned.MAIL_API_KEY);await app.configure({MAIL_API_KEY:rotated})
  assert.equal((await i.settings()).managed.address,assigned.RER_MAIL_ADDRESS)
  const second=await app.ok('/api/management/projects',{token:owner.token,body:{name:'Northstar Support',allowed_origin:'https://second.example.test'}})
  const secondStatus=await app.ok(`/api/management/projects/${second.id}/email-settings`,{token:owner.token});assert.notEqual(secondStatus.managed.address,assigned.RER_MAIL_ADDRESS);assert.equal(secondStatus.managed.state,'active')
  const intake=await i.ingress(mime({id:'synthetic-core-job'}));assert.equal(intake.data.state,'delivered','fresh Managed core intake needs no mail fields')
  // A network-edge read failure must leave inbound and replies usable, while
  // exposing the uncertainty until the independently scheduled short retry.
  edge.statusFailures=1
  const checked=(await i.settings()).managed.checkedAt
  await app.db.prepare('UPDATE rer_mailboxes SET route_check_next_at=0 WHERE project_id=?').bind(owner.projectId).run()
  await app.scheduled();await app.drainJobs()
  const uncertain=(await i.settings()).managed;assert.equal(uncertain.routeActive,true);assert.equal(uncertain.routeUncertain,true);assert.equal(uncertain.checkedAt,checked);assert.ok(uncertain.routeCheckError)
  assert.ok(uncertain.nextCheckAt>Date.now()&&uncertain.nextCheckAt<Date.now()+60000,'failed observation schedules a short bounded retry')
  assert.equal((await i.ingress(mime({id:'synthetic-during-blip'}),{deliveryId:'synthetic-during-blip'})).status,200)
  const head=await app.first('SELECT revision,last_message_id FROM conversations WHERE id=?',intake.data.conversationId)
  const reply=await app.ok(`/api/conversations/${intake.data.conversationId}/messages`,{token:owner.token,body:{localId:'synthetic-status-blip-reply',content:'We can still help with your order.',expectedRevision:head.revision,expectedLastMessageId:head.last_message_id}})
  await app.scheduled();await app.until(async()=>(await app.first('SELECT state FROM email_deliveries WHERE id=?',`message:${reply.message.id}:notification`))?.state==='sent')
  assert.equal((await i.settings()).managed.routeUncertain,true)
  await new Promise(done=>setTimeout(done,Math.max(0,uncertain.nextCheckAt-Date.now()+50)))
  await app.scheduled();await app.drainJobs()
  const recovered=(await i.settings()).managed;assert.equal(recovered.routeActive,true);assert.equal(recovered.routeUncertain,false);assert.ok(recovered.checkedAt>checked)
  edge.routeActive=false
  await app.db.prepare('UPDATE rer_mailboxes SET route_check_next_at=0 WHERE project_id=?').bind(owner.projectId).run();await app.scheduled();await app.drainJobs()
  assert.equal((await i.settings()).managed.routeActive,false,'a confirmed inactive status still revokes local routing')
  assert.equal((await i.ingress(mime({id:'synthetic-confirmed-inactive'}),{deliveryId:'synthetic-confirmed-inactive'})).status,403)
  edge.routeActive=true
  await app.db.prepare('UPDATE rer_mailboxes SET route_check_next_at=0 WHERE project_id=?').bind(owner.projectId).run();await app.scheduled();await app.drainJobs()
  await app.ok(`/api/management/projects/${second.id}`,{token:owner.token,method:'DELETE'});await app.scheduled();await app.drainJobs();assert.ok(edge.controls.some(row=>row.payload?.action==='retire'&&row.payload.mailboxId!==assigned.RER_MAILBOX_ID))
  const retired=await app.first('SELECT * FROM rer_mailboxes WHERE project_id=?',second.id);assert.equal(retired.state,'revoked');assert.equal(retired.route_active,0);assert.ok(await app.first("SELECT 1 FROM audit_events WHERE project_id=? AND action='managed_mail.retired'",second.id))
  // A conflict is visible and only the native authorized retry can rebind it.
  edge.conflict=true
  const conflict=await app.ok('/api/management/projects',{token:owner.token,body:{name:'Warehouse',allowed_origin:'https://warehouse.example.test'}})
  const before=await app.ok(`/api/management/projects/${conflict.id}/email-settings`,{token:owner.token});assert.equal(before.managed.state,'failed');assert.ok(before.managed.error);assert.ok(await app.first("SELECT 1 FROM audit_events WHERE project_id=? AND action='managed_mail.binding_conflict'",conflict.id))
  edge.conflict=false
  await app.ok(`/api/management/projects/${conflict.id}/email-settings/managed/retry`,{token:owner.token,method:'POST'})
  assert.equal((await app.ok(`/api/management/projects/${conflict.id}/email-settings`,{token:owner.token})).managed.state,'active')
  // The network boundary enforces installation scope; this is engineering proof,
  // never a claim about the live platform or real mail routing.
  const other=await managedInstallation('other',{edge,bindings:{RER_MAILBOX_ID:assigned.RER_MAILBOX_ID,RER_MAIL_ADDRESS:assigned.RER_MAIL_ADDRESS,MAIL_FROM:assigned.RER_MAIL_ADDRESS}})
  try{const refused=await other.settings();assert.equal(refused.managed.routeActive,false);assert.equal(refused.managed.state,'failed');assert.ok(!edge.sends.some(row=>row.authority===other.assigned.MAIL_API_KEY))}finally{await other.close()}
 }finally{await i.close()}
 await managedUpgradeJourney()
}

// The same capability adoption works through a settings read, an explicit retry,
// and the scheduled reconciler; none needs a fresh workspace or repeated reserve.
export async function managedUpgradeJourney(){
 for(const door of ['settings','retry','schedule']){
  const i=await managedInstallation('upgrade-'+door,{bindings:{MAIL_PROVIDER:''}}),{app,owner,edge,assigned}=i
  try{
   assert.equal((await i.settings()).managed,null)
   await app.configure({MAIL_PROVIDER:'rer'})
   if(door==='retry')await app.ok(`/api/management/projects/${owner.projectId}/email-settings/managed/retry`,{token:owner.token,method:'POST'})
   if(door==='schedule'){await app.scheduled();await app.drainJobs()}
   const state=await i.settings();assert.equal(state.managed.state,'active');assert.equal(state.managed.address,assigned.RER_MAIL_ADDRESS);assert.equal(state.data.inbound_address,assigned.RER_MAIL_ADDRESS)
   assert.equal((await i.ingress(mime({id:'synthetic-upgrade-'+door}))).data.state,'delivered')
   await app.ok(`/api/management/projects/${owner.projectId}/email-settings/test`,{token:owner.token,body:{idempotencyKey:'synthetic-upgrade-send-'+door}})
   await i.settings();await app.scheduled();await app.drainJobs()
   assert.equal((await app.first('SELECT count(*) n FROM rer_mailboxes')).n,1)
   assert.equal(edge.controls.filter(row=>row.payload?.action==='reserve').length,0,'adoption uses the installation default')
  }finally{await i.close()}
 }
}
