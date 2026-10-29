import assert from 'node:assert/strict'
import {startApp} from '../journeys/kit/app.mjs'

const root='/api/mobile/v1',allScopes=['read','reply','notes','assign','attachments','knowledge','push']
async function fixture(){
 const app=await startApp(),w=await app.seedWorkspace('mobile'),other=await app.seedWorkspace('mobile-other')
 await app.presenceAwayOff(w.projectId);await app.presenceAwayOff(other.projectId)
 const ticket=async(workspace,suffix)=>{
  const contact=await app.ok(`/api/management/projects/${workspace.projectId}/contacts`,{token:workspace.tokens.owner,body:{name:'Private customer '+suffix,email:`customer-${suffix}@example.test`}})
  const id=contact.data?.id??contact.id
  return app.ok('/api/conversations',{token:workspace.tokens.owner,body:{projectId:workspace.projectId,contactId:id}})
 }
 const t=await ticket(w,'one'),foreign=await ticket(other,'two')
 const pair=async({token=w.tokens.operator,scopes=allScopes,platform='ios'}={})=>app.ok(root+'/devices',{token,body:{platform,scopes}})
 const call=(path,{token,...options}={})=>app.call(root+path,{token,...options})
 const read=async(device,id=t.id)=>(await call(`/tickets/${id}`,{token:device.token,status:200})).data
 return {app,w,other,t,foreign,pair,call,read}
}

// Extends the native admission journey with the same business behavior through
// the mobile door; no additional node:test registration or fixture-only engine.
export async function mobileAdmission(){
 const f=await fixture(),{app,w,t,foreign,pair,call,read}=f
 try{
  for(const platform of ['ios','android']){
   const device=await pair({platform}),snapshot=await read(device)
   const bytes='private attachment '+platform
   const attachment=await call(`/tickets/${t.id}/attachments`,{token:device.token,method:'POST',raw:true,body:bytes,headers:{'Mobile-Frontier':snapshot.frontier,'Content-Type':'text/plain','X-Filename':'private.txt'},status:201})
   const command={localId:'reply-'+platform,content:'A human approved reply '+platform,frontier:snapshot.frontier,mediaIds:[attachment.data.id]}
   const replies=await Promise.all([1,2].map(()=>call(`/tickets/${t.id}/reply`,{token:device.token,body:command})))
   assert.ok(replies.every(r=>r.status===200),JSON.stringify(replies.map(r=>r.data)));assert.equal(replies.filter(r=>!r.data.duplicate).length,1)
   assert.equal((await call(`/tickets/${t.id}/reply`,{token:device.token,body:command,status:200})).data.duplicate,true)
   assert.equal((await call(`/tickets/${t.id}/reply`,{token:device.token,body:{...command,content:'Changed command'}})).status,409)
   assert.equal((await call(`/tickets/${t.id}/reply`,{token:device.token,body:{...command,localId:'stale-'+platform}})).status,409)
   const after=await read(device);assert.equal(after.messages.filter(m=>m.content===command.content).length,1)
   assert.equal((await call(`/tickets/${t.id}/attachments/${attachment.data.id}`,{token:device.token,status:200})).data,bytes)
   assert.equal((await call(`/tickets/${foreign.id}/attachments/${attachment.data.id}`,{token:device.token})).status,404)
   // A new schedule is part of the frontier even if no message or assignment changed.
   await app.ok(`/api/dashboard/projects/${w.projectId}/workflow-schedules`,{token:w.tokens.operator,body:{conversation_id:t.id,kind:'reply',due_at:Date.now()+3600000,timezone:'UTC',body:'Scheduled teammate reply',owner_id:w.users.operator}})
   assert.equal((await call(`/tickets/${t.id}/reply`,{token:device.token,body:{localId:'schedule-'+platform,content:'Offline stale reply',frontier:after.frontier}})).status,409)
   const latest=await read(device)
   // Revoke after validation, immediately before the real admission transaction.
   const race=await call(`/tickets/${t.id}/reply`,{token:device.token,body:{localId:'race-'+platform,content:'Must not send',frontier:latest.frontier},headers:{'x-test-before-batch':`UPDATE mobile_devices SET revoked_at=1 WHERE id='${device.id}'`}})
   assert.ok([401,409].includes(race.status),JSON.stringify(race.data))
   const native=await app.ok(`/api/conversations/${t.id}/messages`,{token:w.tokens.owner});assert.equal(native.messages.some(m=>m.content==='Must not send'||m.content==='Offline stale reply'),false)
  }
 }finally{await app.close()}
}

export async function mobileAuthority(){
 const {app,w,other,t,foreign,pair,call,read}=await fixture()
 try{
  const device=await pair(),readonly=await pair({scopes:['read']}),snapshot=await read(device)
  assert.equal((await app.call('/api/conversations',{token:device.token})).status,401,'a device token is not a native session')
  assert.equal((await call('/session',{headers:{Cookie:'h2h_session='+device.token}})).status,401)
  assert.equal((await call('/session?token='+device.token)).status,401)
  assert.equal((await call('/session',{token:w.tokens.operator})).status,401)
  assert.equal((await call(`/tickets/${foreign.id}`,{token:device.token})).status,404)
  assert.equal((await call(`/tickets/${t.id}/reply`,{token:readonly.token,body:{localId:'denied',content:'Denied',frontier:snapshot.frontier}})).status,403)
  assert.equal((await call('/devices',{token:w.tokens.operator,body:{platform:'ios',scopes:['read','constructor']}})).status,400)
  assert.equal((await call(`/devices/${device.id}`,{token:other.tokens.owner,method:'DELETE'})).status,404)
  const scoped=(await call('/tickets',{token:device.token,status:200})).data;assert.ok(scoped.tickets.some(row=>row.id===t.id));assert.equal(scoped.tickets.some(row=>row.id===foreign.id),false)
  assert.equal((await call('/session',{token:device.token,status:200})).headers.get('Cache-Control'),'no-store')
  await app.ok(`/api/management/projects/${w.projectId}/agents/${w.users.operator}`,{token:w.tokens.owner,method:'PUT',body:{role:'collaborator'}})
  const revoked=await call('/session',{token:device.token});assert.equal(revoked.status,401);assert.equal(revoked.data.purge,true);assert.equal(revoked.headers.get('Mobile-Cache-Action'),'purge')
  assert.equal((await call(`/tickets/${t.id}/reply`,{token:device.token,body:{localId:'revoked',content:'Denied after role change',frontier:snapshot.frontier}})).status,401)
  assert.equal((await call('/devices',{token:w.tokens.operator,body:{platform:'ios',scopes:allScopes}})).status,403)
  const collaborator=await pair({scopes:['read','notes','attachments']})
  const current=await read(collaborator)
  const note={localId:'collaborator-note',content:'Private collaborator note',frontier:current.frontier}
  await call(`/tickets/${t.id}/notes`,{token:collaborator.token,body:note,status:201})
  assert.equal((await call(`/tickets/${t.id}/notes`,{token:collaborator.token,body:note,status:200})).data.duplicate,true)
  assert.equal((await read(collaborator)).notes.filter(n=>n.content===note.content).length,1)
  await app.ok(`/api/management/projects/${w.projectId}/agents/${w.users.operator}`,{token:w.tokens.owner,method:'PUT',body:{role:'operator'}})
  assert.equal((await call('/session',{token:device.token})).status,401,'restoring the role never revives an offline credential')
  const fresh=await pair(),signedOut=await call('/session',{token:fresh.token,method:'DELETE',status:200});assert.equal(signedOut.data.purge,true)
  assert.equal((await call('/session',{token:fresh.token})).status,401)
  const parentBound=await pair({token:w.tokens.admin});await app.call('/api/identity/session',{token:w.tokens.admin,method:'DELETE',status:200})
  assert.equal((await call('/session',{token:parentBound.token})).status,401,'native sign-out retires derived devices')
  const ownerDevice=await pair({token:w.tokens.owner});await call(`/devices/${ownerDevice.id}`,{token:w.tokens.owner,method:'DELETE',status:200})
  assert.equal((await call('/session',{token:ownerDevice.token})).status,401)
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
  const articles=(await call(`/tickets/${t.id}/knowledge?q=`,{token:device.token,status:200})).data.articles
  assert.ok(articles.some(a=>a.title==='Public returns'));assert.equal(articles.some(a=>a.title==='Unreviewed secret'),false)
  // A failed note outcome cannot silently replay its side effect.
  const interrupted=await call(`/tickets/${t.id}/notes`,{token:device.token,body:{localId:'lost-note',frontier:assigned.frontier,content:'One interrupted note'},headers:{'x-test-fault':'db-after'}})
  assert.equal(interrupted.status,500)
  const retry=await call(`/tickets/${t.id}/notes`,{token:device.token,body:{localId:'lost-note',frontier:assigned.frontier,content:'One interrupted note'},status:409})
  assert.equal(retry.data.state,'uncertain');assert.equal(retry.data.replay,false)
  assert.equal((await read(device)).notes.filter(n=>n.content==='One interrupted note').length,1)
 }finally{await app.close()}
}

export async function mobileNotifications(){
 const {app,w,other,t,pair,call}=await fixture()
 try{
  const device=await pair(),second=await pair({platform:'android'}),foreign=await pair({token:other.tokens.operator})
  await call('/push',{token:device.token,method:'PUT',body:{enabled:true},status:200})
  await call('/push',{token:second.token,method:'PUT',body:{enabled:true},status:200})
  const base=`/api/dashboard/projects/${w.projectId}/conversations/${t.id}`
  const content=`Sensitive case @[Operator](user:${w.users.operator}) with private account details`
  await app.ok(base+'/notes',{token:w.tokens.owner,body:{content}})
  const one=(await call('/push/prepared',{token:device.token,status:200})).data,two=(await call('/push/prepared',{token:second.token,status:200})).data
  assert.equal(one.delivery,'not-configured');assert.equal(one.payloads.length,1);assert.equal(two.payloads.length,1)
  const payload=one.payloads[0],link=new URL(payload.link).pathname.slice(1)
  for(const sensitive of [content,w.projectId,t.id,'Private customer','customer-one@example.test'])assert.equal(JSON.stringify(payload).includes(sensitive),false)
  assert.deepEqual((await call('/links/'+link,{token:device.token,status:200})).data,{projectId:w.projectId,ticketId:t.id,path:`/projects/${w.projectId}/conversations/${t.id}`})
  assert.equal((await call('/links/'+link,{token:second.token})).status,404);assert.equal((await call('/links/'+link,{token:foreign.token})).status,404)
  await app.ok(`/api/management/projects/${w.projectId}/notification-preferences`,{token:w.tokens.operator,method:'PUT',body:{preferences:[{kind:'mention',inbox:false,email:false}]}})
  await app.ok(base+'/notes',{token:w.tokens.owner,body:{content}})
  assert.equal((await call('/push/prepared',{token:device.token,status:200})).data.payloads.length,0)
  await call('/push',{token:device.token,method:'PUT',body:{enabled:false},status:200})
  assert.equal((await call('/links/'+link,{token:device.token})).status,404)
  await call('/session',{token:second.token,method:'DELETE',status:200})
  assert.equal((await call('/links/'+new URL(two.payloads[0].link).pathname.slice(1),{token:second.token})).status,401)
  assert.equal(app.requests.length,0,'prepared envelopes are never reported as provider delivery')
 }finally{await app.close()}
}
