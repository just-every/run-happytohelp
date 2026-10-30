import assert from 'node:assert/strict'

import {fixture,allScopes} from './mobile-fixture.mjs'
import {offlineAdmission,offlineAuthority,controller} from './mobile-offline.mjs'

// Extends the native admission journey with the same business behavior through
// the mobile door; no additional node:test registration or fixture-only engine.
export async function mobileAdmission(){
 await offlineAdmission()
}

export async function mobileAuthority(){
 await offlineAuthority()
 const {app,w,other,t,foreign,pair,call,read}=await fixture()
 try{
  const device=await pair(),readonly=await pair({scopes:['read']}),snapshot=await read(device)
  assert.equal((await app.call('/api/conversations',{token:device.token})).status,401,'a device token is not a native session')
  assert.equal((await call(`/tickets/${foreign.id}`,{token:device.token})).status,404)
  assert.equal((await call(`/tickets/${t.id}/reply`,{token:readonly.token,body:{localId:'denied',content:'Denied',frontier:snapshot.frontier}})).status,403)
  const scoped=(await call('/tickets',{token:device.token,status:200})).data;assert.ok(scoped.tickets.some(row=>row.id===t.id));assert.equal(scoped.tickets.some(row=>row.id===foreign.id),false)
  await app.ok(`/api/management/projects/${w.projectId}/agents/${w.users.operator}`,{token:w.tokens.owner,method:'PUT',body:{role:'collaborator'}})
  const revoked=await call('/session',{token:device.token});assert.equal(revoked.status,401);assert.equal(revoked.data.purge,true);assert.equal(revoked.headers.get('Mobile-Cache-Action'),'purge')
  assert.equal((await call(`/tickets/${t.id}/reply`,{token:device.token,body:{localId:'revoked',content:'Denied after role change',frontier:snapshot.frontier}})).status,401)
  assert.equal((await call('/devices',{token:w.tokens.operator,body:{platform:'ios',scopes:allScopes}})).status,403)
  const collaborator=await pair({scopes:['read','notes','attachments']})
  const current=await read(collaborator)
  const attachment=await call(`/tickets/${t.id}/attachments`,{token:collaborator.token,method:'POST',raw:true,body:'Private note attachment',headers:{'Mobile-Frontier':current.frontier,'Content-Type':'text/plain','X-Filename':'private-note.txt'},status:201})
  const note={localId:'collaborator-note',content:'Private collaborator note',frontier:current.frontier,mediaIds:[attachment.data.id]}
  await call(`/tickets/${t.id}/notes`,{token:collaborator.token,body:note,status:201})
  assert.equal((await call(`/tickets/${t.id}/notes`,{token:collaborator.token,body:note,status:200})).data.duplicate,true)
  assert.equal((await read(collaborator)).notes.filter(n=>n.content===note.content).length,1)
  assert.equal((await call(`/tickets/${t.id}/attachments/${attachment.data.id}`,{token:collaborator.token,status:200})).data,'Private note attachment')
  assert.equal((await call(`/tickets/${foreign.id}/attachments/${attachment.data.id}`,{token:collaborator.token})).status,404)
  await app.ok(`/api/management/projects/${w.projectId}/agents/${w.users.operator}`,{token:w.tokens.owner,method:'PUT',body:{role:'operator'}})
  assert.equal((await call('/session',{token:device.token})).status,401,'restoring the role never revives an offline credential')
  const fresh=await pair(),signedOut=await call('/session',{token:fresh.token,method:'DELETE',status:200});assert.equal(signedOut.data.purge,true)
  assert.equal((await call('/session',{token:fresh.token})).status,401)
  const parentBound=await pair({token:w.tokens.admin});await app.call('/api/identity/session',{token:w.tokens.admin,method:'DELETE',status:200})
  assert.equal((await call('/session',{token:parentBound.token})).status,401,'native sign-out retires derived devices')

 }finally{await app.close()}
}

export async function mobileTicketWork(){
 const {app,w,t,pair,call,read}=await fixture()
 try{
  const device=await pair(),snapshot=await read(device)
  const assign={localId:'assign',frontier:snapshot.frontier,assignee:w.users.operator}
  await call(`/tickets/${t.id}/assignment`,{token:device.token,body:assign,status:201})
  assert.equal((await call(`/tickets/${t.id}/assignment`,{token:device.token,body:assign,status:200})).data.duplicate,true)
  const assigned=await read(device);assert.equal(assigned.ticket.assigned_to,w.users.operator)
  await call(`/tickets/${t.id}/assignment`,{token:device.token,body:{...assign,localId:'stale-assignment',assignee:w.users.admin},status:409})
  // Public knowledge is reusable; a draft and a restricted collection are not
  // disclosed to an unverified customer through the mobile knowledge door.
  const knowledge=`/api/knowledge/${w.projectId}`
  await app.ok(knowledge+'/articles',{token:w.tokens.owner,body:{title:'Public returns',slug:'public-returns',content:'Public instructions',status:'published'}})
  await app.ok(knowledge+'/articles',{token:w.tokens.owner,body:{title:'Unreviewed secret',slug:'unreviewed-secret',content:'Private draft',status:'draft'}})
  const restricted=await app.ok(knowledge+'/categories',{token:w.tokens.owner,body:{title:'Private collection',audience:'signed-in'}});
  await app.ok(knowledge+'/articles',{token:w.tokens.owner,body:{title:'Private returns',slug:'private-returns',content:'Private instructions',status:'published',categoryId:restricted.id}});
  const articles=(await call(`/tickets/${t.id}/knowledge?q=`,{token:device.token,status:200})).data.articles
  assert.ok(articles.some(a=>a.title==='Public returns'));assert.equal(articles.some(a=>a.title==='Unreviewed secret'||a.title==='Private returns'),false)
  // A failed note outcome cannot silently replay its side effect.
  const interrupted=await call(`/tickets/${t.id}/notes`,{token:device.token,body:{localId:'lost-note',frontier:assigned.frontier,content:'One interrupted note'},headers:{'x-test-fault':'db-after'}})
  assert.equal(interrupted.status,500)
  const retry=await call(`/tickets/${t.id}/notes`,{token:device.token,body:{localId:'lost-note',frontier:assigned.frontier,content:'One interrupted note'},status:409})
  assert.equal(retry.data.state,'uncertain');assert.equal(retry.data.replay,false)
  assert.equal((await read(device)).notes.filter(n=>n.content==='One interrupted note').length,1)
 }finally{await app.close()}
}

export async function mobileNotifications(){
 const f=await fixture(),{app,w,other,t,pair,call}=f
 try{
  const device=await pair(),foreign=await pair({token:other.tokens.operator})
  await call('/push',{token:device.token,method:'PUT',body:{enabled:true},status:200})
  const base=`/api/dashboard/projects/${w.projectId}/conversations/${t.id}`
  const content=`Sensitive case @[Operator](user:${w.users.operator}) with private account details`
  await app.ok(base+'/notes',{token:w.tokens.owner,body:{content}})
  const one=(await call('/push/prepared',{token:device.token,status:200})).data
  assert.equal(one.delivery,'not-configured');assert.equal(one.payloads.length,1)
  const payload=one.payloads[0],link=new URL(payload.link).pathname.slice(1)
  for(const sensitive of [content,w.projectId,t.id,'Private customer','customer-one@example.test'])assert.equal(JSON.stringify(payload).includes(sensitive),false)
  assert.deepEqual((await call('/links/'+link,{token:device.token,status:200})).data,{projectId:w.projectId,ticketId:t.id,path:`/projects/${w.projectId}/conversations/${t.id}`})
  const {client}=await controller(f,device)
  try{const route=await client.openLink(payload.link);assert.equal(route.ticketId,t.id);assert.equal(client.cachedTicket(t.id).ticket.id,t.id);await assert.rejects(()=>client.openLink('https://example.test/open/'+link))}finally{client.dispose()}
  assert.equal((await call('/links/'+link,{token:foreign.token})).status,404)
  await app.ok(`/api/management/projects/${w.projectId}/notification-preferences`,{token:w.tokens.operator,method:'PUT',body:{preferences:[{kind:'mention',inbox:false,email:false}]}})
  await app.ok(base+'/notes',{token:w.tokens.owner,body:{content}})
  assert.equal((await call('/push/prepared',{token:device.token,status:200})).data.payloads.length,0)
  await call('/push',{token:device.token,method:'PUT',body:{enabled:false},status:200})
  assert.equal((await call('/links/'+link,{token:device.token})).status,404)
  const third=await pair();await call('/push',{token:third.token,method:'PUT',body:{enabled:true},status:200});
  await app.ok(`/api/management/projects/${w.projectId}/notification-preferences`,{token:w.tokens.operator,method:'PUT',body:{preferences:[{kind:'mention',inbox:true,email:false}]}});
  await app.ok(base+'/notes',{token:w.tokens.owner,body:{content}});
  const erasureLink=(await call('/push/prepared',{token:third.token,status:200})).data.payloads[0];
  await app.ok(`/api/management/projects/${w.projectId}/contacts/${t.contact_id}/erase`,{token:w.tokens.owner,body:{}});
  assert.equal((await call('/links/'+new URL(erasureLink.link).pathname.slice(1),{token:third.token})).status,404,'erasure fences existing links');
  assert.equal(app.requests.length,0,'prepared envelopes are never reported as provider delivery')
 }finally{await app.close()}
}
