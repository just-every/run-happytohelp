import assert from 'node:assert/strict'
import {createHmac} from 'node:crypto'
import {startApp} from '../journeys/kit/app.mjs'
import {customer,history} from '../move-in/helpscout-fixtures.mjs'

/** The real router, database, queue and reviewed importer; only Help Scout's
 * HTTPS boundary is substituted. Native API credentials never authenticate it. */
export async function helpScoutSyncJourney(){
 const credential='synthetic-happytohelp-12',webhookSecret='synthetic-happytohelp-13',mailbox=101
 const histories=[history()],queries=[];for(const h of histories)h.conversation.mailboxId=mailbox
 let failure,afterRead

 const app=await startApp({captureQueue:true,bindings:{INTEGRATION_ENCRYPTION_KEY:btoa('1'.repeat(32))},outbound:async request=>{
  const url=new URL(request.url);assert.equal(url.origin,'https://api.helpscout.net');assert.equal(request.method,'GET');assert.equal(request.headers.get('Authorization'),'Bearer '+credential)
  if(failure)return failure(request)
  if(url.pathname==='/v2/mailboxes/'+mailbox)return Response.json({id:mailbox})
  if(url.pathname==='/v2/conversations'){
   queries.push(Object.fromEntries(url.searchParams));assert.equal(url.searchParams.get('mailbox'),String(mailbox));assert.equal(url.searchParams.get('status'),'all')
   if(afterRead){const run=afterRead;afterRead=null;await run()}
   return Response.json({_embedded:{conversations:histories.map(h=>h.conversation)},page:{number:1,size:25,totalPages:1,totalElements:histories.length},_links:{self:{href:url.href}}})
  }
  if(url.pathname==='/v2/customers/7')return Response.json(customer())
  const match=url.pathname.match(/^\/v2\/conversations\/(\d+)(\/threads)?$/),h=match&&histories.find(h=>h.conversation.id===Number(match[1]));assert.ok(h,'expected provider request '+url.pathname)
  return Response.json(match[2]?h.page:h.conversation)
 }})
 try{

  const w=await app.seedWorkspace('helpscout'),foreign=await app.seedWorkspace('foreign'),root=`/api/management/projects/${w.projectId}/connections/helpscout`,native=`/api/move-in/projects/${w.projectId}/imports`
  const call=(suffix='',options={})=>app.call(root+suffix,{token:w.tokens.owner,...options})
  const input={mailboxId:mailbox,accessToken:credential,webhookSecret,continuous:true,startFrom:'2024-01-01T00:00:00Z'},connect=()=>call('',{body:input}),sync=()=>call('/sync',{body:{}})
  assert.equal((await call('',{token:w.tokens.operator,body:input})).status,403)
  assert.equal((await app.call(root,{token:foreign.tokens.owner,body:input})).status,404)
  assert.equal(app.requests.length,0)
  assert.equal((await connect()).status,201)
  const stored=await app.first('SELECT * FROM helpscout_connections');assert.ok(!JSON.stringify(stored).includes(credential));assert.ok(!JSON.stringify(stored).includes(webhookSecret))
  assert.ok(!JSON.stringify((await call()).data).includes('cipher'))

  const first=await sync();assert.equal(first.status,202,JSON.stringify(first.data));assert.equal(first.data.runs.length,1)
  assert.equal((await app.first('SELECT count(*) n FROM conversations')).n,0,'sync only stages review, never imports or replies')
  const apply=async id=>{await app.drainJobs();const ready=(await app.call(native+'/'+id,{token:w.tokens.owner})).data.data;assert.equal(ready.state,'ready');assert.equal(ready.plan.counts.rejected,0,JSON.stringify(ready.plan));assert.equal((await app.call(native+'/'+id+'/apply',{token:w.tokens.owner,body:{fingerprint:ready.plan.fingerprint}})).status,202);await app.drainJobs();assert.equal((await app.call(native+'/'+id,{token:w.tokens.owner})).data.data.state,'completed')}
  await apply(first.data.runs[0]);assert.equal((await app.first('SELECT count(*) n FROM conversations')).n,1)
  const repeated=await sync();assert.equal(repeated.status,202);assert.deepEqual(repeated.data.runs,[]);assert.equal(repeated.data.unchanged,1)
  const before=(await call()).data.data.cursor
  // A signed event is a wake-up hint, never customer-data or write authority.
  const event='convo.customer.reply.created',raw=JSON.stringify({id:901,mailboxId:mailbox}),headers={'Content-Type':'application/json','X-HelpScout-Event':event,'X-HelpScout-Signature':createHmac('sha1',webhookSecret).update(raw).digest('base64')}
  const deliver=(text=raw,extra={})=>app.call(`/api/helpscout/${w.projectId}/events`,{raw:true,body:text,headers:{...headers,...extra}})
  assert.equal((await deliver(raw+' ')).status,403)
  assert.deepEqual((await deliver()).data,{accepted:true,duplicate:false})
  assert.deepEqual((await deliver()).data,{accepted:true,duplicate:true})
  assert.equal((await app.first('SELECT count(*) n FROM helpscout_webhook_receipts')).n,1)
  assert.equal((await call('',{method:'DELETE'})).status,200)
  assert.equal((await sync()).status,409);assert.equal((await deliver()).status,404)
  assert.equal((await connect()).status,200);assert.equal((await call()).data.data.cursor,before,'reconnect retains the cursor')
  const next=history(902);next.conversation.mailboxId=mailbox;histories.push(next)
  const delta=await sync();assert.equal(delta.status,202,JSON.stringify(delta.data));assert.equal(delta.data.runs.length,1);assert.equal(delta.data.unchanged,1)
  assert.ok(Date.parse(queries.at(-1).modifiedSince)>=Date.parse(before)-5*60000-1000,'incremental request retains its overlap')
  await apply(delta.data.runs[0]);assert.equal((await app.first('SELECT count(*) n FROM conversations')).n,2)
  assert.equal((await app.first('SELECT count(*) n FROM messages')).n,4,'redelivered history never replays native messages')
  // The next snapshot appends only reviewed history to an existing ticket.
  const originalTicket=await app.first("SELECT * FROM conversations WHERE id IN (SELECT conversation_id FROM move_in_conversations WHERE source_id='901')")
  await app.db.prepare('UPDATE conversations SET subject=?,assigned_to=? WHERE id=?').bind('Native subject stays',w.users.operator,originalTicket.id).run()
  const addThread=(h,id,type,body)=>{
   h.page._embedded.threads.push({id,type,state:'published',body,createdAt:'2024-02-01T00:00:00Z',...(type==='customer'?{customer:{id:7,type:'customer',first:'Ada',last:'Customer'}}:{createdBy:{id:900001,type:'user',first:'Historical',last:'Teammate'}})})
   h.page.page.totalElements++;if(type!=='note')h.conversation.threads++;h.conversation.userUpdatedAt='2024-02-01T00:00:00Z'
  }
  addThread(histories[0],9014,'customer','A new source reply');addThread(histories[0],9015,'note','A new private note')
  // Cron admits bounded reads; a provider event is only a wake-up hint and
  // background work stages a review without modifying the live ticket.
  await app.db.prepare('UPDATE helpscout_connections SET next_sync_at=0').run()
  await app.scheduled();const queued=await app.takeJobs();assert.equal(queued.filter(job=>job.type==='helpscout.sync').length,1)
  await app.runJobs(queued);await app.drainJobs()
  const staged=(await call()).data.attempts.find(attempt=>attempt.state==='ready');assert.ok(staged)
  assert.equal((await app.first('SELECT count(*) n FROM messages')).n,4)
  const merge='/runs/'+staged.run_id+'/merge'
  assert.equal((await call(merge,{token:w.tokens.operator})).status,403)
  assert.equal((await call(merge,{token:foreign.tokens.owner})).status,404)
  const preview=await call(merge);assert.equal(preview.status,200,JSON.stringify(preview.data))
  assert.equal(preview.data.data.messages.length,1);assert.equal(preview.data.data.notes.length,1)
  assert.equal((await call(merge,{body:{fingerprint:'stale'}})).status,409)
  // A native write after review invalidates that review, preserving the edit.
  await app.call(`/api/conversations/${originalTicket.id}/messages`,{token:w.tokens.owner,body:{localId:'synthetic-happytohelp-merge',content:'Native reply stays',expectedRevision:originalTicket.revision},status:200})
  assert.equal((await call(merge,{body:{fingerprint:preview.data.data.fingerprint}})).status,409)
  const current=await call(merge);assert.equal(current.status,200,JSON.stringify(current.data))
  const beforeMerge=await app.first('SELECT * FROM conversations WHERE id=?',originalTicket.id)
  const beforeEvents=(await app.first('SELECT count(*) n FROM native_integration_events')).n
  const messagesBeforeRace=(await app.first('SELECT count(*) n FROM messages')).n
  const revoked=await call(merge,{body:{fingerprint:current.data.data.fingerprint},headers:{'x-test-statement':'INSERT INTO helpscout_merge_receipts','x-test-before-statement':`UPDATE sessions SET revoked_at=1 WHERE actor_id='${w.users.owner}'`}})
  assert.equal(revoked.status,403);assert.equal((await app.first('SELECT count(*) n FROM messages')).n,messagesBeforeRace)
  assert.equal((await app.first('SELECT count(*) n FROM helpscout_merge_receipts')).n,0,'revocation at commit leaves no receipt or partial history')
  await app.db.prepare('UPDATE sessions SET revoked_at=NULL WHERE actor_id=?').bind(w.users.owner).run()
  const merged=await call(merge,{body:{fingerprint:current.data.data.fingerprint}});assert.equal(merged.status,200,JSON.stringify(merged.data));assert.equal(merged.data.data.messages,1);assert.equal(merged.data.data.notes,1)
  assert.equal((await call(merge,{body:{fingerprint:current.data.data.fingerprint}})).data.duplicate,true)
  const ticket=(await app.call('/api/conversations/'+originalTicket.id+'/messages',{token:w.tokens.owner,status:200})).data
  assert.ok(JSON.stringify(ticket).includes('A new source reply'));assert.ok(JSON.stringify(ticket).includes('Native reply stays'))
  const after=await app.first('SELECT * FROM conversations WHERE id=?',originalTicket.id);assert.equal(after.subject,'Native subject stays');assert.equal(after.assigned_to,beforeMerge.assigned_to);assert.equal(after.status_id,beforeMerge.status_id)
  assert.equal((await app.first('SELECT count(*) n FROM native_integration_events')).n,beforeEvents,'merged history emits no events or outbound replies')
  assert.equal((await sync()).data.runs.length,0)
  assert.equal((await call()).data.attempts.find(attempt=>attempt.run_id===staged.run_id).messages,1)
  // Edited or removed historical source content requires manual reconciliation.
  histories[0].page._embedded.threads[0].body='Changed historical reply'
  const conflict=await sync();await app.drainJobs();assert.equal((await call('/runs/'+conflict.data.runs[0]+'/merge')).status,409)
  histories[0].page._embedded.threads[0].body='Historical reply'
  // Background authority expires with its connecting session; no provider read
  // is attempted until an authorized reconnect explicitly renews the grant.
  const requestsBeforeExpiry=app.requests.length
  await app.db.prepare('UPDATE sessions SET expires_at=1 WHERE actor_id=?').bind(w.users.owner).run()
  await app.db.prepare('UPDATE helpscout_connections SET next_sync_at=0').run()
  await app.scheduled();await app.drainJobs();assert.equal(app.requests.length,requestsBeforeExpiry)
  assert.equal((await app.first('SELECT error_code FROM helpscout_connections')).error_code,'helpscout_authority_unavailable')
  await app.db.prepare('UPDATE sessions SET expires_at=? WHERE actor_id=?').bind(Date.now()+3600000,w.users.owner).run()
  assert.equal((await connect()).status,200)
  // A failed or redirected read cannot advance a cursor or leave the lock held.
  const cursor=(await call()).data.data.cursor
  for(const response of [()=>new Response('forbidden',{status:403}),()=>new Response(null,{status:302,headers:{Location:'https://elsewhere.example/steal'}}),()=>Response.json({_embedded:{conversations:[]},page:{number:1,size:25,totalPages:2,totalElements:1}})]){
   failure=response;assert.equal((await sync()).status,502);const health=(await call()).data.data;assert.equal(health.cursor,cursor);assert.equal(health.syncing,false);assert.equal(health.pending,true)
  }
  failure=null
  // The session and its current custom role fence each provider request, not
  // merely the eventual staging write after a whole mailbox has been read.
  const role='synthetic-happytohelp-14'
  await app.db.prepare('INSERT INTO project_roles(id,project_id,name,base,permissions_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind(role,w.projectId,'Import administrator','admin',JSON.stringify(['data.import','integrations.install']),Date.now(),Date.now()).run()
  await app.db.prepare('INSERT INTO member_roles(project_id,user_id,role_key,assigned_at) VALUES(?,?,?,?)').bind(w.projectId,w.users.owner,role,Date.now()).run()
  for(const revoke of [
   ()=>app.db.prepare('UPDATE project_roles SET permissions_json=? WHERE id=? AND project_id=?').bind(JSON.stringify(['integrations.install']),role,w.projectId).run(),
   ()=>app.db.prepare('UPDATE sessions SET revoked_at=1 WHERE actor_id=?').bind(w.users.owner).run(),
  ]){
   const requests=app.requests.length,runs=(await app.first('SELECT count(*) n FROM move_in_runs')).n
   afterRead=revoke
   assert.equal((await sync()).status,403)
   assert.equal(app.requests.length,requests+1,'no conversation, customer or private-thread read follows revoked authority')
   assert.equal((await app.first('SELECT count(*) n FROM move_in_runs')).n,runs)
   assert.equal((await app.first('SELECT cursor FROM helpscout_connections')).cursor,cursor)
   await app.db.prepare('UPDATE project_roles SET permissions_json=? WHERE id=? AND project_id=?').bind(JSON.stringify(['data.import','integrations.install']),role,w.projectId).run()
   await app.db.prepare('UPDATE sessions SET revoked_at=NULL WHERE actor_id=?').bind(w.users.owner).run()
  }
  await app.db.prepare('DELETE FROM member_roles WHERE project_id=? AND user_id=?').bind(w.projectId,w.users.owner).run()
  await app.db.prepare('DELETE FROM project_roles WHERE project_id=? AND id=?').bind(w.projectId,role).run()
  // Revoking a connection during provider I/O fences staging at its next write.
  const interrupted=history(903);interrupted.conversation.mailboxId=mailbox;histories.push(interrupted)
  const countBeforeDisconnect=(await app.first('SELECT count(*) n FROM move_in_runs')).n
  let release,entered;const held=new Promise(done=>release=done),started=new Promise(done=>entered=done)
  afterRead=async()=>{entered();await held}
  const inFlight=sync();await started
  assert.equal((await call('',{method:'DELETE'})).status,200);release()
  assert.equal((await inFlight).status,409)
  assert.equal((await app.first('SELECT count(*) n FROM move_in_runs')).n,countBeforeDisconnect)
  assert.equal((await call()).data.data.status,'disconnected')
  histories.pop();assert.equal((await connect()).status,200)
  // Erasure removes the staged originals too; unchanged and changed copies are
  // both blocked rather than resurrecting source data through a new connection.
  const contact=await app.first("SELECT id FROM contacts WHERE external_id='import:helpscout:7'")
  assert.equal((await app.call(`/api/management/projects/${w.projectId}/contacts/${contact.id}/erase`,{token:w.tokens.owner,body:{}})).status,200)
  assert.equal((await sync()).status,410);assert.equal((await app.first('SELECT count(*) n FROM helpscout_sync_receipts')).n,4)
  histories[0].conversation.subject='A changed copy';assert.equal((await sync()).status,410)
  assert.equal((await call(merge,{body:{fingerprint:current.data.data.fingerprint}})).status,410,'an old merge receipt never authorizes erased history')
 }finally{await app.close()}
}
