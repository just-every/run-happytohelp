import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {startApp} from '../journeys/kit/app.mjs'
import {channelHarness} from './support-channels/journeys.mjs'
import {hubspotContextJourney} from './hubspot-context.mjs'

// Existing CHANNELS-001 network-edge fixture; no channel behavior is replaced.
async function messagingCustomer(){
 const h=await channelHarness(),{app,ws,token}=h,B=`/api/management/projects/${ws.projectId}`,owner={token}
 try{
  const connection=await h.connect('whatsapp'),before=app.requests.length
  assert.equal((await h.deliver(connection,'whatsapp',h.event('whatsapp',{text:'My messaging-channel support request'}))).status,200)
  const thread=await h.ticket(connection)
  assert.ok(thread?.contact_id)
  await app.ok(B+'/contacts/'+thread.contact_id,{...owner,method:'PUT',body:{external_id:'messaging-outcomes'}})
  const customer=(await app.ok(B+'/contacts/'+thread.contact_id,owner)).data
  assert.equal(customer.id,thread.contact_id)
  const record=await app.ok(B+'/contacts/'+customer.id+'/conversations',owner)
  assert.deepEqual(record.data.map(row=>row.id),[thread.conversation_id])
  assert.equal(record.data[0].preview,'My messaging-channel support request')
  const ticket=await app.ok('/api/conversations/'+thread.conversation_id,owner)
  assert.equal(ticket.contact_id,customer.id);assert.equal(ticket.channel,'whatsapp')
  const messages=await app.ok('/api/conversations/'+ticket.id+'/messages',owner)
  assert.equal(messages.messages[0].content,'My messaging-channel support request')
  await h.deliver(connection,'whatsapp',h.event('whatsapp',{text:'STOP'}))
  const consent=(await h.call('/conversations/'+ticket.id)).data.consent
  assert.ok(consent.some(fact=>fact.kind==='stop'))
  const run=await app.ok(B+'/customer-imports/preview',{...owner,body:{kind:'contacts',csv:'Name,External\nImported messaging name,'+customer.external_id,mapping:{name:'Name',externalId:'External'}}})
  assert.equal(run.rows[0].entityId,customer.id)
  const unchanged=async()=>{
   assert.deepEqual((await h.call('/conversations/'+ticket.id)).data.consent,consent)
   assert.deepEqual((await app.ok('/api/conversations/'+ticket.id+'/messages',owner)).messages.map(row=>row.content),['My messaging-channel support request','STOP'])
   assert.equal(app.requests.length,before);assert.equal(h.sends.length,0)
  }
  await unchanged()
  await app.ok(B+'/customer-imports/'+run.id+'/apply',{...owner,body:{}});await unchanged()
  await app.ok(B+'/customer-imports/'+run.id+'/undo',{...owner,body:{}});await unchanged()
  assert.deepEqual((await app.ok(B+'/contacts/'+customer.id,owner)).data,customer)
 }finally{await h.close()}
}

// Same provider contract and native mapping/read/disconnect doors as
// hubspotContextJourney. Only HTTPS at api.hubapi.com is faked.
async function disconnectedCustomerContext(){
 const app=await startApp({captureQueue:true,bindings:{INTEGRATION_ENCRYPTION_KEY:randomBytes(32).toString('base64')},outbound:async request=>{
  const url=new URL(request.url);assert.equal(url.origin,'https://api.hubapi.com')
  if(url.pathname==='/oauth/v2/private-apps/get/access-token-info')return Response.json({hubId:123,scopes:['crm.objects.contacts.read','crm.objects.companies.read']})
  assert.equal(request.method,'GET')
  assert.equal(url.pathname,'/crm/v3/objects/contacts/11')
  return Response.json({id:'11',updatedAt:'2026-10-20T12:00:00Z',properties:{email:'context-outcomes@example.test',support_plan:'Standard'}})
 }})
 try{
  const w=await app.seedWorkspace('customer-context'),owner={token:w.tokens.owner},B=`/api/management/projects/${w.projectId}`,C=B+'/crm/hubspot'
  const contact=(await app.ok(B+'/contacts',{...owner,body:{name:'Context customer',email:'context-outcomes@example.test'}})).data
  const map=C+'/contacts/'+contact.id
  await app.ok(C,{...owner,method:'PUT',body:{token:'synthetic-customer-context',account_id:'123',properties:{plan:'support_plan'}}})
  await app.ok(map,{...owner,method:'PUT',body:{source_contact_id:'11'}})
  await app.ok(map+'/refresh',{...owner,body:{}})
  const fresh=await app.ok(map,owner)
  assert.equal(fresh.state,'fresh');assert.ok(fresh.refreshed_at>0);assert.ok(fresh.checked_at>=fresh.refreshed_at)
  assert.equal(fresh.context.contact.properties.support_plan,'Standard')
  assert.equal((await app.call(map,{token:w.tokens.operator})).status,403)
  await app.ok(C,{...owner,method:'DELETE'})
  const count=app.requests.length,disconnected=await app.ok(map,owner)
  assert.equal(disconnected.state,'disconnected');assert.equal(disconnected.context,null)
  assert.equal(disconnected.grants_customer_access,false)
  assert.equal((await app.call(map+'/refresh',{...owner,body:{}})).status,409)
  assert.equal(app.requests.length,count,'disconnected customer read cannot contact the provider')
  // The disconnect door currently deletes its mapping, losing refreshed_at.
  // This is a CUSTOMER-001 Gap owned by CRM-001, not simulated or excluded.
  console.log('CUSTOMER-001 remaining Gap: disconnected context retains no last-sync time; CRM-001 mapping is deleted')
 }finally{await app.close()}
}
export async function customerEdgeOutcomes(){
 await messagingCustomer()
 await disconnectedCustomerContext()
 await hubspotContextJourney()
}
