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

// The existing inbox browser journey supplies this proof without a new registration.
export async function customerScreenOutcomes(){
 const {createHmac}=await import('node:crypto'),{createRuntime}=await import('./emitted-runtime.mjs')
 const {launchBrowser,evidence}=await import('../journeys/kit/browser.mjs')
 const runtime=await createRuntime(),browser=await launchBrowser(),shot=await evidence('customer-outcomes')
 let context,passed=false
 try{
  const response=await fetch(runtime.origin+'/api/identity/bootstrap',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Customer screen team',ownerName:'Screen Reviewer',email:'screen-owner@example.test',password:randomBytes(24).toString('base64url'),allowedOrigin:runtime.origin})})
  assert.equal(response.status,201)
  const owner=await response.json(),p=owner.projectId,B='/api/management/projects/'+p
  context=await browser.newContext({viewport:{width:1440,height:1000}})
  await context.addCookies([{name:'h2h_session',value:owner.token,url:runtime.origin}])
  const api=async(path,body,method=body===undefined?'GET':'POST')=>{
   const result=await context.request.fetch(runtime.origin+path,{method,...(body===undefined?{}:{data:body})})
   assert.ok(result.ok(),method+' '+path+': '+result.status());return result.json()
  }
  await api(B+'/availability',{is_presence_away_enabled:false},'PUT')
  const settings=await api(B+'/widget-settings')
  const signed=async(name,email)=>{
   const result=await context.request.post(runtime.origin+'/api/identity/widget/session',{data:{widgetKey:settings.widgetKey,name,identifier:email,email,contact_hash:createHmac('sha256',settings.verificationSecret).update(email).digest('hex')},headers:{Origin:runtime.origin}})
   assert.equal(result.status(),201);return result.json()
  }
  const primary=await signed('Avery Customer','avery-screen@example.test'),alternate=await signed('Avery alternate','alternate-screen@example.test')
  const typed=(await api(B+'/contacts',{name:'Typed only',email:'typed-screen@example.test'})).data
  const company=(await api(B+'/companies',{name:'Screen account'})).company
  await api(B+'/companies/'+company.id+'/members/'+primary.contactId,{},'PUT')
  const ticket=await api('/api/conversations',{projectId:p,contactId:alternate.contactId})
  await api('/api/conversations/'+ticket.id+'/messages',{localId:'screen-linked-history',content:'Alternate support history',expectedRevision:0})
  const page=await context.newPage();page.setDefaultTimeout(20000)
  const capture=async name=>{
   for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.screenshot({path:shot(name+'-'+width+'.png'),fullPage:true})}
   await page.setViewportSize({width:1440,height:1000})
  }
  await page.goto(runtime.origin+'/projects/'+p+'/companies')
  await page.getByRole('button',{name:'View Screen account',exact:true}).click()
  await page.getByRole('link',{name:'Avery Customer',exact:true}).waitFor()
  await capture('company')
  await page.getByRole('link',{name:'Avery Customer',exact:true}).click()
  await page.getByRole('heading',{name:'Possibly the same customer Context only',exact:true}).waitFor()
  const choose=async name=>{
   await page.getByRole('button',{name:'Link a verified identity',exact:true}).click()
   const region=page.getByRole('region',{name:'Link a verified identity',exact:true})
   await region.getByLabel('Customer name or email',{exact:true}).fill(name)
   await region.getByRole('button',{name:'Find customers',exact:true}).click()
   await region.locator('li').filter({hasText:name}).getByRole('button',{name:'Choose',exact:true}).click()
   return region
  }
  let region=await choose('Typed only')
  await region.getByLabel('Evidence',{exact:true}).fill('A typed address is not proof')
  await region.getByRole('button',{name:'Preview link',exact:true}).click()
  await region.getByRole('alert').filter({hasText:'Both identities require independent verification'}).waitFor()
  assert.equal((await api(B+'/contacts/'+primary.contactId+'/identity-links')).links.length,0)
  await region.getByRole('button',{name:'Cancel',exact:true}).click()
  region=await choose('Avery alternate')
  const evidenceText='Customer confirmed both signed identities in screen request 10482'
  await region.getByLabel('Evidence',{exact:true}).fill(evidenceText)
  await region.getByRole('button',{name:'Preview link',exact:true}).click()
  await region.getByText('Preview — nothing changed yet',{exact:true}).waitFor()
  await region.getByText('Nothing is merged',{exact:true}).waitFor()
  await region.getByText('No message is sent',{exact:true}).waitFor()
  await region.getByText('Unchanged; each customer sees only their own conversations',{exact:true}).waitFor()
  assert.equal((await api(B+'/contacts/'+primary.contactId+'/identity-links')).links.length,0)
  await region.getByRole('button',{name:'Confirm link',exact:true}).click()
  await page.getByRole('link',{name:'Alternate support history',exact:true}).waitFor()
  assert.match(await page.locator('.identity-links__meta').textContent(),/Linked by Screen Reviewer · .*\d{4}/)
  await page.locator('.identity-links__list .identity-links__evidence').filter({hasText:evidenceText}).waitFor()
  await capture('customer-linked')
  await page.getByRole('button',{name:'Unlink Avery alternate',exact:true}).click()
  region=page.getByRole('region',{name:'Unlink Avery alternate',exact:true})
  const reason='Customer requested separate identities after review'
  await region.getByLabel('Reason for unlinking',{exact:true}).fill(reason)
  await region.getByRole('button',{name:'Preview unlink',exact:true}).click()
  await region.getByRole('button',{name:'Confirm unlink',exact:true}).click()
  const history=page.locator('.identity-links__decisions')
  await history.getByText('Unlinked Avery alternate',{exact:true}).waitFor()
  await history.getByText('Linked Avery alternate',{exact:true}).waitFor()
  await history.locator('.identity-links__evidence').filter({hasText:reason}).waitFor();await history.locator('.identity-links__evidence').filter({hasText:evidenceText}).waitFor()
  const times=await history.locator('time').evaluateAll(nodes=>nodes.map(node=>node.dateTime))
  assert.equal(times.length,2);assert.ok(times.every(time=>Number.isFinite(Date.parse(time))))
  assert.equal((await api(B+'/contacts/'+primary.contactId+'/identity-links')).links.length,0)
  await capture('customer-history')
  await page.goto(runtime.origin+'/projects/'+p+'/security-log')
  await page.getByText('Customer identity linked',{exact:true}).waitFor()
  await page.getByText('Customer identity unlinked',{exact:true}).waitFor()
  await capture('security-log')
  assert.equal((await api(B+'/contacts/'+typed.id)).data.email,'typed-screen@example.test')
  passed=true
 }finally{await context?.close();await browser.close();await runtime.close(passed)}
}
