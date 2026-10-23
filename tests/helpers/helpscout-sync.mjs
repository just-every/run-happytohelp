import assert from 'node:assert/strict'
import {createHmac} from 'node:crypto'
import {execFileSync} from 'node:child_process'
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
  const input={mailboxId:mailbox,accessToken:credential,webhookSecret,startFrom:'2024-01-01T00:00:00Z'},connect=()=>call('',{body:input}),sync=()=>call('/sync',{body:{}})
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
  // A failed or redirected read cannot advance a cursor or leave the lock held.
  const cursor=(await call()).data.data.cursor
  for(const response of [()=>new Response('forbidden',{status:403}),()=>new Response(null,{status:302,headers:{Location:'https://elsewhere.example/steal'}}),()=>Response.json({_embedded:{conversations:[]},page:{number:1,size:25,totalPages:2,totalElements:1}})]){
   failure=response;assert.equal((await sync()).status,502);const health=(await call()).data.data;assert.equal(health.cursor,cursor);assert.equal(health.syncing,false);assert.equal(health.pending,true)
  }
  failure=null
  // Revoking a connection during provider I/O fences staging at its next write.
  const interrupted=history(903);interrupted.conversation.mailboxId=mailbox;histories.push(interrupted)
  const countBeforeDisconnect=(await app.first('SELECT count(*) n FROM move_in_runs')).n
  let release,entered;const held=new Promise(done=>release=done),started=new Promise(done=>entered=done)
  afterRead=async()=>{entered();await held}
  const inFlight=sync();await started
  assert.equal((await call('',{method:'DELETE'})).status,200);release()
  assert.equal((await inFlight).status,502)
  assert.equal((await app.first('SELECT count(*) n FROM move_in_runs')).n,countBeforeDisconnect)
  assert.equal((await call()).data.data.status,'disconnected')
  histories.pop();assert.equal((await connect()).status,200)
  // Erasure removes the staged originals too; unchanged and changed copies are
  // both blocked rather than resurrecting source data through a new connection.
  const contact=await app.first("SELECT id FROM contacts WHERE external_id='import:helpscout:7'")
  assert.equal((await app.call(`/api/management/projects/${w.projectId}/contacts/${contact.id}/erase`,{token:w.tokens.owner,body:{}})).status,200)
  assert.equal((await sync()).status,410);assert.equal((await app.first('SELECT count(*) n FROM helpscout_sync_receipts')).n,2)
  histories[0].conversation.subject='A changed copy';assert.equal((await sync()).status,410)
  assert.equal((await app.first('SELECT count(*) n FROM native_integration_events')).n,0,'staging emits no native support event')
  // Installer policy imports Wrangler, which configures process-wide network
  // handling. Keep its complete credential-exclusion assertion in a child so
  // later provider-edge journeys retain their own loopback transport.
  const policy=new URL('../../scripts/installer/portability-policy.mjs',import.meta.url).href
  execFileSync(process.execPath,['--input-type=module','-e',`import assert from 'node:assert/strict';const {archivePolicy}=await import(${JSON.stringify(policy)});for(const table of ['helpscout_connections','helpscout_sync_receipts','helpscout_webhook_receipts'])assert.ok(archivePolicy.excludeTables.includes(table),'restore does not transplant '+table);process.exit(0)`],{timeout:30000,stdio:'pipe'})
 }finally{await app.close()}
}
