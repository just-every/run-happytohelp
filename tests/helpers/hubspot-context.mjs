import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {startApp,sha} from '../journeys/kit/app.mjs'

export async function hubspotContextJourney(){
 let plan='Standard',entitlement='Standard',email='synthetic-hh-1@example.test',accountId=123,permission=200,extraScope=false,associated=true,malformed=false,transport=null
 const app=await startApp({captureQueue:true,bindings:{INTEGRATION_ENCRYPTION_KEY:randomBytes(32).toString('base64')},outbound:async request=>{
  const url=new URL(request.url);assert.equal(url.origin,'https://api.hubapi.com');assert.ok(!url.href.includes('synthetic-hh-5'))
  if(transport==='redirect')return new Response(null,{status:302,headers:{Location:'https://foreign.example/never'}})
  if(transport==='oversized')return new Response('x'.repeat(65537))
  if(permission!==200)return new Response('Denied',{status:permission})
  if(malformed)return new Response('malformed',{status:200})
  if(url.pathname==='/oauth/v2/private-apps/get/access-token-info'){
   assert.equal(request.method,'POST');assert.equal((await request.json()).tokenKey,'synthetic-hh-5')
   return Response.json({hubId:accountId,scopes:['crm.objects.contacts.read','crm.objects.companies.read',...(extraScope?['crm.objects.contacts.write']:[])]})
  }
  assert.equal(request.method,'GET');assert.equal(request.headers.get('Authorization'),'Bearer synthetic-hh-5')
  if(url.pathname==='/crm/v3/objects/contacts/11')return Response.json({id:'11',updatedAt:'2026-10-20T12:00:00Z',properties:{email,hubspot_owner_id:'51',support_plan:plan,support_entitlement:entitlement},associations:{companies:{results:associated?[{id:'21'}]:[]}}})
  if(url.pathname==='/crm/v3/objects/companies/21')return Response.json({id:'21',updatedAt:'2026-10-20T12:00:00Z',properties:{domain:'synthetic-hh.example',name:'Synthetic company',support_plan:plan,support_entitlement:entitlement,hubspot_owner_id:'52'}})
  throw Error('Unexpected provider request '+url.pathname)
 }})
 try{
  const w=await app.seedWorkspace('crm'),foreign=await app.seedWorkspace('crm-foreign'),p=w.projectId,base=`/api/management/projects/${p}`,path=base+'/crm/hubspot',owner={token:w.tokens.owner}
  const connect={token:'synthetic-hh-5',account_id:'123',properties:{plan:'support_plan',entitlement:'support_entitlement'}}
  extraScope=true;assert.equal((await app.call(path,{...owner,method:'PUT',body:connect})).status,400);extraScope=false
  accountId=999;assert.equal((await app.call(path,{...owner,method:'PUT',body:connect})).status,400);accountId=123
  assert.equal((await app.call(path,{token:w.tokens.operator,method:'PUT',body:connect})).status,403)
  await app.ok(path,{...owner,method:'PUT',body:connect})
  assert.ok(!(JSON.stringify((await app.ok(path,owner)))).includes('synthetic-hh-5'))
  const stored=await app.first('SELECT token_cipher FROM crm_connections WHERE project_id=?',p);assert.ok(stored.token_cipher&&!stored.token_cipher.includes('synthetic-hh-5'))
  const contact=(await app.ok(base+'/contacts',{...owner,body:{name:'Synthetic customer',email}})).data
  const second=(await app.ok(base+'/contacts',{...owner,body:{name:'Other customer',email:'synthetic-hh-2@example.test'}})).data
  const company=(await app.ok(base+'/companies',{...owner,body:{name:'Synthetic company',domains:['synthetic-hh.example']}})).company
  await app.ok(`${base}/companies/${company.id}/members/${contact.id}`,{...owner,method:'PUT',body:{}})
  const map=path+'/contacts/'+contact.id,mapping={source_contact_id:'11',company_id:company.id,source_company_id:'21'}
  await app.ok(map,{...owner,method:'PUT',body:mapping});assert.equal((await app.ok(map,owner)).state,'stale')
  assert.equal((await app.call(path+'/contacts/'+second.id,{...owner,method:'PUT',body:{source_contact_id:'11'}})).status,409)
  const refresh=()=>app.ok(map+'/refresh',{...owner,body:{}})
  let result=await refresh();assert.equal(result.state,'fresh');assert.equal(result.context.contact.id,'11');assert.equal(result.context.company.id,'21');assert.equal(result.context.contact.properties.support_plan,'Standard');assert.equal(result.grants_customer_access,false)
  const ticket=await app.ok('/api/conversations',{...owner,body:{projectId:p,contactId:contact.id}})
  const ticketPath=`${base}/conversations/${ticket.id}/crm`
  assert.equal((await app.ok(ticketPath,owner)).context.contact.id,'11')
  assert.equal((await app.call(`/api/management/projects/${foreign.projectId}/conversations/${ticket.id}/crm`,{token:foreign.tokens.owner})).status,404)
  await app.ok(base+'/contacts/'+contact.id,{...owner,method:'PUT',body:{email:'changed@example.test'}})
  assert.equal((await app.ok(ticketPath,owner)).state,'identity_mismatch');assert.equal((await app.ok(ticketPath,owner)).context,null)
  await app.ok(base+'/contacts/'+contact.id,{...owner,method:'PUT',body:{email}})
  const firstRefresh=await app.ok(map,owner);assert.ok(firstRefresh.refreshed_at&&firstRefresh.checked_at);assert.equal(firstRefresh.account_id,'123')
  plan='Enterprise';entitlement='Priority';result=await app.ok(ticketPath+'/refresh',{...owner,body:{}});assert.equal(result.context.company.properties.support_plan,'Enterprise');assert.equal(result.context.contact.properties.support_entitlement,'Priority')
  await app.db.prepare('UPDATE crm_mappings SET refreshed_at=? WHERE project_id=?').bind(Date.now()-600000,p).run();assert.equal((await app.ok(map,owner)).state,'stale')
  email='synthetic-hh-3@example.test';result=await refresh();assert.equal(result.state,'identity_mismatch');assert.equal((await app.ok(map,owner)).context,null);email='synthetic-hh-1@example.test'
  associated=false;assert.equal((await refresh()).state,'identity_mismatch');associated=true
  accountId=999;assert.equal((await refresh()).state,'identity_mismatch');accountId=123
  extraScope=true;assert.equal((await refresh()).state,'scope_refused');extraScope=false
  permission=403;assert.equal((await refresh()).state,'permission_lost');assert.equal((await app.ok(map,owner)).context,null);permission=200
  malformed=true;assert.equal((await refresh()).state,'unavailable');malformed=false
  for(const mode of ['redirect','oversized']){transport=mode;const before=app.requests.length;assert.equal((await refresh()).state,'unavailable');assert.equal(app.requests.length,before+1,'failed reads never retry or follow redirects')};transport=null
  await refresh()
  const foreignContact=(await app.ok(`/api/management/projects/${foreign.projectId}/contacts`,{token:foreign.tokens.owner,body:{name:'Foreign',email:'foreign@example.test'}})).data
  await app.ok(`/api/management/projects/${foreign.projectId}/crm/hubspot`,{token:foreign.tokens.owner,method:'PUT',body:connect})
  await app.ok(map,{...owner,method:'DELETE'});assert.equal((await app.ok(map,owner)).state,'unmapped')
  await app.ok(map,{...owner,method:'PUT',body:mapping});await refresh()
  const otherCompany=(await app.ok(base+'/companies',{...owner,body:{name:'Other company',domains:['other.example']}})).company
  await app.ok(`${base}/companies/${otherCompany.id}/members/${second.id}`,{...owner,method:'PUT',body:{}})
  assert.equal((await app.call(path+'/contacts/'+second.id,{...owner,method:'PUT',body:{source_contact_id:'12',company_id:otherCompany.id,source_company_id:'21'}})).status,409)
  const count=app.requests.length
  assert.equal((await app.call(`/api/management/projects/${foreign.projectId}/crm/hubspot/contacts/${contact.id}`,{token:foreign.tokens.owner})).status,404)
  assert.equal((await app.call(path+'/contacts/'+foreignContact.id,{...owner,method:'PUT',body:{source_contact_id:'11'}})).status,404)
  assert.equal((await app.call(map,{token:foreign.tokens.owner})).status,403)
  const visitor=await app.ok('/api/identity/widget/session',{body:{widgetKey:w.widgetKey,email},headers:{Origin:w.allowedOrigin}})
  assert.equal((await app.call(map,{token:visitor.token})).status,403)
  assert.equal((await app.call(map,{token:w.tokens.operator})).status,403)
  assert.equal((await app.call(map,{token:w.tokens.admin})).status,200)
  assert.equal(app.requests.length,count,'denied callers send no provider traffic')
  // Authority lost while the provider was answering must refuse the durable write.
  const requesterRace=await app.call(ticketPath+'/refresh',{...owner,body:{},headers:{'x-test-before-batch':`UPDATE conversations SET contact_id='${second.id}' WHERE id='${ticket.id}'`}})
  assert.equal(requesterRace.status,409)
  await app.db.prepare('UPDATE conversations SET contact_id=? WHERE id=?').bind(contact.id,ticket.id).run()
  const lost=await app.call(map+'/refresh',{...owner,body:{},headers:{'x-test-before-batch':`UPDATE sessions SET revoked_at=1 WHERE token_hash='${sha(w.tokens.owner)}'`}})
  assert.equal(lost.status,409)
  await app.db.prepare('UPDATE sessions SET revoked_at=NULL WHERE token_hash=?').bind(sha(w.tokens.owner)).run()
  const disconnectedInFlight=await app.call(map+'/refresh',{...owner,body:{},headers:{'x-test-before-batch':`UPDATE crm_connections SET token_cipher=NULL,revision='disconnected' WHERE project_id='${p}'`}})
  assert.equal(disconnectedInFlight.status,409)
  assert.equal((await app.ok(map,owner)).state,'disconnected');assert.equal((await app.ok(map,owner)).context,null)
  await app.ok(path,{...owner,method:'DELETE'})
  assert.equal((await app.ok(path,owner)).connection.connected,false);assert.equal((await app.ok(map,owner)).state,'disconnected');assert.equal((await app.call(map+'/refresh',{...owner,body:{}})).status,409)
  assert.equal((await app.first('SELECT token_cipher FROM crm_connections WHERE project_id=?',p)).token_cipher,null)
  await app.ok(path,{...owner,method:'PUT',body:connect});await app.ok(map,{...owner,method:'PUT',body:mapping});await refresh()
  await app.ok(`${base}/contacts/${contact.id}/erase`,{...owner,body:{}})
  assert.equal((await app.first('SELECT count(*) n FROM crm_mappings WHERE project_id=?',p)).n,0)
  assert.equal((await app.call(map+'/refresh',{...owner,body:{}})).status,404)
  assert.ok((await app.sql("SELECT action FROM audit_events WHERE project_id=? AND action LIKE 'crm.%'",p)).length>5)
  assert.equal((await app.first('SELECT count(*) n FROM customer_identity_links WHERE project_id=?',p)).n,0)
 }finally{await app.close()}
}
