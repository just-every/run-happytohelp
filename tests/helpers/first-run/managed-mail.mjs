import assert from 'node:assert/strict'
import {managedInstallation} from '../email/rer-mail.mjs'
import {managedEdge,mime} from '../email/rer-edge.mjs'
export async function managedFirstRunJourney(){
 const i=await managedInstallation('first'),{app,edge,owner,assigned}=i
 try{
  const first=await i.settings();assert.equal(first.configured,true);assert.equal(first.data.inbound_address,assigned.RER_MAIL_ADDRESS);assert.equal(first.managed.state,'active');assert.equal(edge.sends[0].payload.to[0],'owner-first@example.test')
  await app.ok(`/api/management/projects/${owner.projectId}/email-settings/managed/retry`,{token:owner.token,method:'POST'});assert.equal((await i.settings()).managed.address,assigned.RER_MAIL_ADDRESS,'repeated binding returns its original assignment')
  const activation=await app.ok(`/api/management/projects/${owner.projectId}/activation`,{token:owner.token});assert.equal(activation.data.facts.mail.managed.address,assigned.RER_MAIL_ADDRESS);assert.ok(!activation.data.steps.some(row=>['sender_dns','inbound_address'].includes(row.id)&&row.placement==='needs_you'))
  assert.equal((await app.call('/api/identity/forgot-password',{body:{email:'owner-first@example.test'},status:200})).status,200);assert.ok(edge.sends.some(row=>row.payload.text.toLowerCase().includes('password')))
  await app.ok(`/api/management/projects/${owner.projectId}/settings`,{token:owner.token,method:'PUT',body:{name:'Northstar Support'}})
  assert.equal((await i.settings()).managed.address,assigned.RER_MAIL_ADDRESS)
  const original=edge.installations.get(assigned.MAIL_API_KEY),rotated='synthetic-rotated-relay-authority';edge.installations.set(rotated,original);edge.installations.delete(assigned.MAIL_API_KEY);await app.configure({MAIL_API_KEY:rotated})
  assert.equal((await i.settings()).managed.address,assigned.RER_MAIL_ADDRESS)
  const second=await app.ok('/api/management/projects',{token:owner.token,body:{name:'Northstar Support',allowed_origin:'https://second.example.test'}})
  const secondStatus=await app.ok(`/api/management/projects/${second.id}/email-settings`,{token:owner.token});assert.notEqual(secondStatus.managed.address,assigned.RER_MAIL_ADDRESS);assert.equal(secondStatus.managed.state,'active')
  assert.equal((await i.ingress(mime({id:'synthetic-core-job'}))).data.state,'delivered','fresh Managed core intake needs no mail fields')
  await app.ok(`/api/management/projects/${second.id}`,{token:owner.token,method:'DELETE'});await app.scheduled();await app.drainJobs();assert.ok(edge.controls.some(row=>row.payload?.action==='retire'&&row.payload.mailboxId!==assigned.RER_MAILBOX_ID))
  const retired=await app.first('SELECT * FROM rer_mailboxes WHERE project_id=?',second.id);assert.equal(retired.state,'revoked');assert.equal(retired.route_active,0)
  // A conflict is visible and only the native authorized retry can rebind it.
  edge.conflict=true
  const conflict=await app.ok('/api/management/projects',{token:owner.token,body:{name:'Warehouse',allowed_origin:'https://warehouse.example.test'}})
  const before=await app.ok(`/api/management/projects/${conflict.id}/email-settings`,{token:owner.token});assert.equal(before.managed.state,'failed');assert.ok(before.managed.error)
  edge.conflict=false
  await app.ok(`/api/management/projects/${conflict.id}/email-settings/managed/retry`,{token:owner.token,method:'POST'})
  assert.equal((await app.ok(`/api/management/projects/${conflict.id}/email-settings`,{token:owner.token})).managed.state,'active')
  // The network boundary enforces installation scope; this is engineering proof,
  // never a claim about the live platform or real mail routing.
  const other=await managedInstallation('other',{edge,bindings:{RER_MAILBOX_ID:assigned.RER_MAILBOX_ID,RER_MAIL_ADDRESS:assigned.RER_MAIL_ADDRESS,MAIL_FROM:assigned.RER_MAIL_ADDRESS}})
  try{const refused=await other.settings();assert.equal(refused.managed.routeActive,false);assert.equal(refused.managed.state,'failed');assert.ok(!edge.sends.some(row=>row.authority===other.assigned.MAIL_API_KEY))}finally{await other.close()}
 }finally{await i.close()}
}
