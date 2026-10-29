import assert from 'node:assert/strict'
import {build} from 'esbuild'
import {fixture,root} from './mobile-fixture.mjs'

let clientModule
export const loadClient=()=>clientModule??=build({entryPoints:['src/modules/mobile/client.ts'],bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'}).then(result=>import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64')))

export async function controller(f,device){
 const {MobileClient}=await loadClient(),lifecycle=new EventTarget(),requests=[]
 const network={online:true,loseReply:false,hold:null}
 const fetch=async(url,init)=>{
  const path=new URL(url).pathname+new URL(url).search
  requests.push({path,method:init.method??'GET',body:init.body})
  if(!network.online)throw new TypeError('Disconnected at network edge')
  const response=await f.app.request(path,{method:init.method,headers:Object.fromEntries(new Headers(init.headers)),body:init.body,raw:true})
  if(network.hold&&path===root+'/tickets/'+f.t.id){const hold=network.hold;network.hold=null;hold.started();await hold.wait}
  if(network.loseReply&&path.endsWith('/reply')){network.loseReply=false;await response.arrayBuffer();throw new TypeError('Reply response lost at network edge')}
  return response
 }
 const client=new MobileClient({origin:f.app.origin,credential:{deviceId:device.id,projectId:device.projectId,token:device.token,scopes:device.scopes,expiresAt:device.expiresAt},fetch,lifecycle})
 await client.reconnect()
 return {client,lifecycle,network,requests}
}

// The same admission flow, with an offline mobile caller and real D1/R2 writes.
export async function offlineAdmission(){
 const f=await fixture(),{app,w,t,pair}=f
 try{
  for(const platform of ['ios','android']){
   const {client,lifecycle,network,requests}=await controller(f,await pair({platform}))
   console.info('Mobile offline admission:',platform,'paired')
   try{
    await client.openTicket(t.id)
    client.saveDraft(t.id,'I have checked your return and attached the instructions. '+platform)
    client.stageAttachment(t.id,{filename:'return-instructions.txt',contentType:'text/plain',bytes:new TextEncoder().encode('Return instructions '+platform)})
    network.online=false;lifecycle.dispatchEvent(new Event('offline'))
    assert.equal(client.state.connection,'offline');assert.ok(client.draft(t.id).content.includes('return'));assert.equal(client.cachedTicket(t.id).ticket.id,t.id)
    const before=requests.length
    await assert.rejects(()=>client.sendDraft(t.id));await assert.rejects(()=>client.assign(t.id,w.users.operator));await assert.rejects(()=>client.note(t.id,'Must stay unsent'))
    assert.equal(requests.length,before,'offline actions never leave the controller')
    const schedule=await app.ok(`/api/dashboard/projects/${w.projectId}/workflow-schedules`,{token:w.tokens.operator,body:{conversation_id:t.id,kind:'reply',due_at:Date.now()+3600000,timezone:'UTC',body:'Scheduled return follow-up',owner_id:w.users.operator}})
    network.online=true;lifecycle.dispatchEvent(new Event('online'))
    assert.equal(client.state.connection,'reconnect-required');assert.equal(requests.length,before,'online event does not send or replay')
    await client.reconnect()
    console.info('Mobile offline admission:',platform,'reconnected')
    assert.ok(requests.slice(before).every(request=>request.method==='GET'),'reconnect only refreshes authority and current ticket/schedules')
    assert.ok(client.cachedTicket(t.id).schedules.some(row=>row[0]===(schedule.data?.id??schedule.id)))
    await assert.rejects(()=>client.sendDraft(t.id));assert.equal(client.draft(t.id).reviewRequired,true)
    client.reviewDraft(t.id)
    // Another operator changes the frontier after review, so even an explicit
    // send is refused until a new read and human review.
    await app.ok(`/api/conversations/${t.id}/messages`,{token:w.tokens.owner,body:{localId:'teammate-'+platform,content:'A teammate checked the return.',expectedRevision:client.cachedTicket(t.id).ticket.revision}})
    await assert.rejects(()=>client.sendDraft(t.id),error=>error.status===409)
    assert.equal(client.draft(t.id).outcome,'refused')
    await client.openTicket(t.id);client.reviewDraft(t.id)
    const text=client.draft(t.id).content,result=await client.sendDraft(t.id)
    assert.equal(result.accepted,true);assert.equal(client.draft(t.id),undefined)
    console.info('Mobile offline admission:',platform,'sent attachment reply')
    const snapshot=await client.openTicket(t.id)
    assert.equal(snapshot.messages.filter(message=>message.content===text).length,1)
    const media=snapshot.media.find(media=>media.message_id===result.messageId)
    assert.equal(new TextDecoder().decode(await client.attachment(t.id,media.id)),'Return instructions '+platform)
    // A committed reply whose response was lost is never retried, including
    // after reconnect or another press of Send.
    client.saveDraft(t.id,'One response whose acknowledgment is lost. '+platform);client.reviewDraft(t.id)
    network.loseReply=true;await assert.rejects(()=>client.sendDraft(t.id))
    console.info('Mobile offline admission:',platform,'lost reply response')
    assert.equal(client.draft(t.id).outcome,'uncertain')
    const writes=requests.filter(request=>request.method==='POST').length
    await client.reconnect();await assert.rejects(()=>client.sendDraft(t.id));assert.throws(()=>client.reviewDraft(t.id));
    assert.equal(requests.filter(request=>request.method==='POST').length,writes)
    assert.equal(client.cachedTicket(t.id).messages.filter(message=>message.content==='One response whose acknowledgment is lost. '+platform).length,1)
   }finally{client.dispose()}
  }
 }finally{await app.close()}
}

// Lifecycle erasure of the same ticket, unsent draft and attachment cache, not
// an assertion that a server policy document makes a native device erase bytes.
export async function offlineAuthority(){
 const f=await fixture(),{app,w,t,pair,call}=f
 try{
  for(const reason of ['signout','offline-signout','revocation','parent-signout','authority-change','workspace-change','process-exit']){
   const device=await pair({token:reason==='parent-signout'?w.tokens.admin:w.tokens.owner}),{client,lifecycle,network,requests}=await controller(f,device)
   try{
    await client.tickets();await client.openTicket(t.id)
    client.saveDraft(t.id,'Private pending reply '+reason)
    client.stageAttachment(t.id,{filename:'private.txt',contentType:'text/plain',bytes:new TextEncoder().encode('Private customer attachment')})
    const snapshot=client.cachedTicket(t.id),draft=client.draft(t.id),bytes=draft.files[0].bytes
    assert.ok(snapshot.ticket.id&&draft.content&&bytes.some(byte=>byte!==0))
    console.info('Mobile offline authority:',reason,'loaded')
    if(reason==='signout'){assert.equal((await client.signOut()).serverRevoked,true);assert.equal((await call('/session',{token:device.token})).status,401)}
    if(reason==='offline-signout'){network.online=false;client.setOffline();assert.equal((await client.signOut()).serverRevoked,false)}
    if(reason==='revocation'){client.setOffline();await call(`/devices/${device.id}`,{token:w.tokens.owner,method:'DELETE',status:200});await assert.rejects(()=>client.reconnect(),error=>error.status===401)}
    if(reason==='parent-signout'){await app.call('/api/identity/session',{token:w.tokens.admin,method:'DELETE',status:200});await assert.rejects(()=>client.reconnect(),error=>error.status===401)}
    if(reason==='authority-change')client.authorityChanged()
    if(reason==='workspace-change')client.workspaceChanged()
    if(reason==='process-exit')lifecycle.dispatchEvent(new Event('pagehide'))
    assert.equal(client.state.connection,'signed-out');assert.equal(client.state.ticketCount+client.state.draftCount+client.state.resourceCount,0)
    assert.deepEqual(snapshot,{});assert.deepEqual(draft,{});assert.ok(bytes.every(byte=>byte===0),'held attachment buffers are zeroed')
    const ended=requests.length;await assert.rejects(()=>client.reconnect());await assert.rejects(()=>client.sendDraft(t.id));assert.equal(requests.length,ended,'a purged client no longer has authority to issue a request')
   }finally{client.dispose()}
  }
  // Role loss is discovered at the first reconnect and purges before rendering
  // a response; restoring the role never restores cached data or credentials.
  const device=await pair(),{client}=await controller(f,device)
  try{
   await client.openTicket(t.id);client.saveDraft(t.id,'Lost authority while offline');client.setOffline()
   await app.ok(`/api/management/projects/${w.projectId}/agents/${w.users.operator}`,{token:w.tokens.owner,method:'PUT',body:{role:'collaborator'}})
   await assert.rejects(()=>client.reconnect(),error=>error.status===401);assert.equal(client.state.draftCount,0)
   await app.ok(`/api/management/projects/${w.projectId}/agents/${w.users.operator}`,{token:w.tokens.owner,method:'PUT',body:{role:'operator'}})
   await assert.rejects(()=>client.reconnect());assert.equal(client.cachedTicket(t.id),undefined)
  }finally{client.dispose()}
  // A network callback may arrive after a workspace change even if its host
  // ignores AbortSignal. It must not repopulate the now-empty cache.
  const late=await controller(f,await pair({token:w.tokens.owner}))
  try{
   let release,started
   const wait=new Promise(done=>release=done),seen=new Promise(done=>started=done)
   late.network.hold={wait,started};const pending=late.client.openTicket(t.id)
   await seen;late.client.workspaceChanged();release()
   await assert.rejects(()=>pending);assert.equal(late.client.state.ticketCount,0)
  }finally{late.client.dispose()}
 }finally{await app.close()}
}
