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
  const contact=(await app.ok(base+'/contacts',{...owner,body:{name:'Synthetic customer',email}})).data
  const second=(await app.ok(base+'/contacts',{...owner,body:{name:'Other customer',email:'synthetic-hh-2@example.test'}})).data
  const ticket=await app.ok('/api/conversations',{...owner,body:{projectId:p,contactId:contact.id}})
  const ticketPath=`${base}/conversations/${ticket.id}/crm`
  const neverConnectedRequests=app.requests.length
  for(const door of [path+'/contacts/'+contact.id,ticketPath]){
   const expected={context:null,connected:false,state:'unmapped',grants_customer_access:false}
   assert.deepEqual(await app.ok(door,owner),expected)
   assert.deepEqual(await app.ok(door,{token:w.tokens.operator}),expected)
  }
  assert.equal(app.requests.length,neverConnectedRequests)
  await app.ok(path,{...owner,method:'PUT',body:connect})
  assert.ok(!(JSON.stringify((await app.ok(path,owner)))).includes('synthetic-hh-5'))
  const stored=await app.first('SELECT token_cipher FROM crm_connections WHERE project_id=?',p);assert.ok(stored.token_cipher&&!stored.token_cipher.includes('synthetic-hh-5'))
  const company=(await app.ok(base+'/companies',{...owner,body:{name:'Synthetic company',domains:['synthetic-hh.example']}})).company
  await app.ok(`${base}/companies/${company.id}/members/${contact.id}`,{...owner,method:'PUT',body:{}})
  const map=path+'/contacts/'+contact.id,mapping={source_contact_id:'11',company_id:company.id,source_company_id:'21'}
  await app.ok(map,{...owner,method:'PUT',body:mapping});assert.equal((await app.ok(map,owner)).state,'stale')
  assert.equal((await app.call(path+'/contacts/'+second.id,{...owner,method:'PUT',body:{source_contact_id:'11'}})).status,409)
  const refresh=()=>app.ok(map+'/refresh',{...owner,body:{}})
  let result=await refresh();assert.equal(result.state,'fresh');assert.equal(result.context.contact.id,'11');assert.equal(result.context.company.id,'21');assert.equal(result.context.contact.properties.support_plan,'Standard');assert.equal(result.grants_customer_access,false)
  const role={name:'Ticket support without customer management',base:'operator',permissions:['conversations.reply','conversations.notes','conversations.follow','conversations.manage']}
  const roleId=(await app.ok(base+'/roles',{...owner,body:role})).data.id
  await app.ok(`${base}/agents/${w.users.operator}`,{...owner,method:'PUT',body:{role:roleId}})
  const operator={token:w.tokens.operator}
  const snapshot=async()=>({connections:await app.sql('SELECT * FROM crm_connections WHERE project_id=?',p),mappings:await app.sql('SELECT * FROM crm_mappings WHERE project_id=?',p)})
  const operatorRead=async state=>{
   const before=await snapshot(),requests=app.requests.length
   const expected=await app.ok(map,owner)
   assert.equal(expected.state,state)
   for(const door of [map,ticketPath]){
    const data=await app.ok(door,operator)
    assert.deepEqual(data,expected,'operator receives exactly the owner cached context')
    assert.equal(data.grants_customer_access,false)
    assert.doesNotMatch(JSON.stringify(data),/synthetic-hh-5|token_cipher|context_json|revision|synthetic-hh-2@example.test/)
    if(['identity_mismatch','disconnected'].includes(state))assert.equal(data.context,null)
   }
   assert.equal(app.requests.length,requests,'operator reads never call HubSpot')
   assert.deepEqual(await snapshot(),before,'operator reads never write CRM state')
  }
  await operatorRead('fresh')
  const beforeWrites=await snapshot(),requestsBeforeWrites=app.requests.length
  for(const [door,method,body] of [[path,'PUT',connect],[path,'DELETE'],[map,'PUT',mapping],[map,'DELETE'],[map+'/refresh','POST',{}],[ticketPath+'/refresh','POST',{}]])assert.equal((await app.call(door,{...operator,method,body})).status,403)
  assert.deepEqual(await snapshot(),beforeWrites);assert.equal(app.requests.length,requestsBeforeWrites,'refused operator writes never call HubSpot')
  assert.equal((await app.call(path,operator)).status,403,'connection administration stays private')
  assert.equal((await app.call(path+'/contacts/'+second.id,operator)).status,404,'an arbitrary customer without readable tickets grants no CRM access')
  console.log('CONTEXT baseline: native operator GET ticket/customer CRM -> identical fresh owner cache; six mutations 403; provider requests and CRM writes unchanged')
  assert.equal((await app.ok(ticketPath,owner)).context.contact.id,'11')
  assert.equal((await app.call(`/api/management/projects/${foreign.projectId}/conversations/${ticket.id}/crm`,{token:foreign.tokens.owner})).status,404)
  await app.ok(base+'/contacts/'+contact.id,{...owner,method:'PUT',body:{email:'changed@example.test'}})
  assert.equal((await app.ok(ticketPath,owner)).state,'identity_mismatch');assert.equal((await app.ok(ticketPath,owner)).context,null)
  await operatorRead('identity_mismatch')
  await app.ok(base+'/contacts/'+contact.id,{...owner,method:'PUT',body:{email}})
  const firstRefresh=await app.ok(map,owner);assert.ok(firstRefresh.refreshed_at&&firstRefresh.checked_at);assert.equal(firstRefresh.account_id,'123')
  plan='Enterprise';entitlement='Priority';result=await app.ok(ticketPath+'/refresh',{...owner,body:{}});assert.equal(result.context.company.properties.support_plan,'Enterprise');assert.equal(result.context.contact.properties.support_entitlement,'Priority')
  await app.db.prepare('UPDATE crm_mappings SET refreshed_at=? WHERE project_id=?').bind(Date.now()-600000,p).run();assert.equal((await app.ok(map,owner)).state,'stale')
  await operatorRead('stale')
  email='synthetic-hh-3@example.test';result=await refresh();assert.equal(result.state,'identity_mismatch');assert.equal((await app.ok(map,owner)).context,null);await operatorRead('identity_mismatch');email='synthetic-hh-1@example.test'
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
  await operatorRead('unmapped')
  assert.equal((await app.ok(map,operator)).connected,true,'connected unmapped customers remain visible')
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
  await operatorRead('fresh')
  assert.equal((await app.call(map,{token:w.tokens.admin})).status,200)
  assert.equal(app.requests.length,count,'denied callers send no provider traffic')
  assert.equal((await app.call(ticketPath,{token:visitor.token})).status,403)
  assert.equal((await app.call(ticketPath,{token:foreign.tokens.owner})).status,403)
  assert.equal((await app.call(`${base}/conversations/not-a-ticket/crm`,operator)).status,404)
  const foreignTicket=await app.ok('/api/conversations',{token:foreign.tokens.owner,body:{projectId:foreign.projectId,contactId:foreignContact.id}})
  assert.equal((await app.call(`${base}/conversations/${foreignTicket.id}/crm`,operator)).status,404)
  assert.equal((await app.call(path+'/contacts/'+foreignContact.id,operator)).status,404)
  // Stored selections use the same native ticket predicate; role edits use public doors.
  await app.db.prepare('INSERT INTO ticket_groups(id,project_id,name,updated_at) VALUES(?,?,?,1)').bind('crm-hidden',p,'Hidden support group').run()
  const hiddenTicket=await app.ok('/api/conversations',{...owner,body:{projectId:p,contactId:second.id}})
  await app.db.prepare('UPDATE conversations SET group_id=? WHERE id=?').bind('crm-hidden',hiddenTicket.id).run()
  const select=scope=>app.db.prepare('UPDATE project_roles SET ticket_scope_json=? WHERE project_id=? AND id=?').bind(JSON.stringify(scope),p,roleId).run()
  await select({groupIds:[],includeUngrouped:true})
  assert.equal((await app.call(`${base}/conversations/${hiddenTicket.id}/crm`,operator)).status,404)
  assert.equal((await app.call(path+'/contacts/'+second.id,operator)).status,404)
  await operatorRead('fresh')
  await select({groupIds:[],includeUngrouped:false})
  for(const door of [ticketPath,map])assert.equal((await app.call(door,operator)).status,404,'scope narrowing takes effect on the next request')
  await select({groupIds:[],includeUngrouped:true})
  await app.ok(`${base}/roles/${roleId}`,{...owner,method:'PUT',body:{...role,permissions:[]}})
  for(const [door,route] of [[ticketPath,'/api/management/projects/:projectId/conversations/:conversationId/crm'],[map,'/api/management/projects/:projectId/crm/hubspot/contacts/:contactId']]){
   const before=await app.sql('SELECT id FROM audit_events WHERE project_id=?',p)
   const response=await app.call(door,operator)
   assert.equal(response.status,403,'a role without inbox authority reads nothing')
   assert.equal(response.data.code,'permission_denied')
   const added=(await app.sql('SELECT * FROM audit_events WHERE project_id=?',p)).filter(event=>!before.some(row=>row.id===event.id))
   assert.equal(added.length,1,'one audit event per refused CRM read')
   const event=added[0]
   assert.deepEqual({category:event.category,action:event.action,outcome:event.outcome,actor_type:event.actor_type,actor_id:event.actor_id,source:event.source,target_type:event.target_type,target_id:event.target_id,detail:JSON.parse(event.detail_json)},
    {category:'access',action:'permission.denied',outcome:'refused',actor_type:'user',actor_id:w.users.operator,source:'dashboard',target_type:'route',target_id:'GET '+route,detail:{role:role.name,permission:'conversations.reply'}})
  }
  console.log('PROBE CRM-001 1: GET native ticket/customer CRM with no inbox permission -> two 403 permission_denied responses, exactly one permission.denied audit event each with native route/actor/role shape')
  await app.ok(`${base}/roles/${roleId}`,{...owner,method:'PUT',body:role})
  await operatorRead('fresh')
  const member=await app.first('SELECT * FROM memberships WHERE project_id=? AND user_id=?',p,w.users.operator)
  await app.db.prepare('DELETE FROM memberships WHERE project_id=? AND user_id=?').bind(p,w.users.operator).run()
  assert.equal((await app.call(ticketPath,operator)).status,401,'membership revocation invalidates the session')
  await app.db.prepare('INSERT INTO memberships(project_id,user_id,role) VALUES(?,?,?)').bind(p,w.users.operator,member.role).run()
  console.log('CONTEXT baseline: native CRM reads after ticket-scope narrowing -> 404; permission removal -> 403; membership revocation -> 401; foreign/customer doors refused')
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
  await operatorRead('disconnected')
  await app.ok(path,{...owner,method:'DELETE'})
  assert.equal((await app.ok(path,owner)).connection.connected,false);assert.equal((await app.ok(map,owner)).state,'disconnected');assert.equal((await app.call(map+'/refresh',{...owner,body:{}})).status,409)
  assert.equal((await app.first('SELECT token_cipher FROM crm_connections WHERE project_id=?',p)).token_cipher,null)
  await operatorRead('disconnected')
  assert.equal((await app.ok(map,operator)).connected,false)
  console.log('PROBE CRM-001 2: GET cached CRM before connect/after disconnect -> connected false; connected unmapped -> connected true; reads call no provider')
  await app.ok(path,{...owner,method:'PUT',body:connect});await app.ok(map,{...owner,method:'PUT',body:mapping});await refresh()
  await app.ok(`${base}/contacts/${contact.id}/erase`,{...owner,body:{}})
  assert.equal((await app.first('SELECT count(*) n FROM crm_mappings WHERE project_id=?',p)).n,0)
  assert.equal((await app.call(map+'/refresh',{...owner,body:{}})).status,404)
  for(const door of [ticketPath,map])assert.equal((await app.call(door,operator)).status,404,'erased customers are unavailable to operators')
  assert.ok((await app.sql("SELECT action FROM audit_events WHERE project_id=? AND action LIKE 'crm.%'",p)).length>5)
  assert.equal((await app.first('SELECT count(*) n FROM customer_identity_links WHERE project_id=?',p)).n,0)
 }finally{await app.close()}
}
