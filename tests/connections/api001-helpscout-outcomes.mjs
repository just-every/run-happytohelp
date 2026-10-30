import assert from 'node:assert/strict'
import {createHmac} from 'node:crypto'
import {archivePolicy} from '../../scripts/installer/portability-policy.mjs'
import {harness,body} from './harness.mjs'
import {customer,history} from '../move-in/helpscout-fixtures.mjs'
const root='/api/management/projects/p/connections/helpscout',imports='/api/move-in/projects/p/imports'
export async function api001ScoutOutcomes(){
 const h=await harness()
 try{
  let ids=[901],error=null,failThreads=false,changed=false,pageMode=false,badNext=false,oversize=false
  const seen=[]
  h.setScoutResponder(receipt=>{
   const url=new URL('https://edge.test'+receipt.path),path=url.pathname.replace('/api.helpscout.net','');seen.push(path+url.search)
   if(error)return {status:error,body:'private provider failure must never appear'}
   if(path==='/v2/oauth2/token')return json({access_token:'synthetic-scout-access',token_type:'bearer',expires_in:3600})
   if(path==='/v2/conversations'&&oversize)return {status:200,headers:{'Content-Length':'65537'},body:'x'.repeat(65537)}
   if(path==='/v2/conversations'&&pageMode){const page=Number(url.searchParams.get('page')||1),next=new URL('https://api.helpscout.net/v2/conversations'+url.search);next.searchParams.set('page','2');return json({_embedded:{conversations:[]},page:{number:page,size:25,totalElements:0,totalPages:2},_links:{self:{href:'https://api.helpscout.net/v2/conversations'+url.search},...(page===1?{next:{href:badNext?'https://foreign.example/v2/conversations?page=2':next.href}}:{})}})}
   if(path==='/v2/conversations')return json({_embedded:{conversations:ids.map(id=>({id}))},page:{number:1,size:25,totalElements:ids.length,totalPages:1},_links:{self:{href:'https://api.helpscout.net/v2/conversations'+url.search}}})
   const match=/^\/v2\/conversations\/(\d+)(\/threads)?$/.exec(path)
   if(match){const item=history(Number(match[1]),Number(match[1])===901?7:8);item.conversation.mailboxId=1;if(changed)item.conversation.subject='Changed after initial pull';if(match[2]&&failThreads)return {status:500,body:'interrupted before run'};return json(match[2]?item.page:item.conversation)}
   const person=/^\/v2\/customers\/(\d+)$/.exec(path);if(person)return json(customer(Number(person[1]),Number(person[1])===7?'ada@example.test':'person8@example.test'))
   throw Error('Unexpected Help Scout request '+path)
  })
  const connect=secret=>h.call(root,{...body({app_id:'synthetic-app',app_secret:secret,webhook_secret:'synthetic-webhook-secret',mailbox_id:'1'}),method:'PUT'})
  await h.contact('scout-visitor');assert.equal((await h.raw(root,{actor:'scout-visitor'})).status,403)
  const native=await h.issue();assert.equal((await h.raw(root,{token:native.token})).status,404)
  await connect('synthetic-app-secret')
  const metadata=await h.call(root);assert.equal(metadata.connected,true)
  const archived=archivePolicy.exportRow('helpscout_connections',{project_id:'p',secret_ciphertext:'secret',claim:'claim',claim_until:99,cursor:'retained'});assert.equal(archived.secret_ciphertext,null);assert.equal(archived.cursor,'retained');assert.equal(archivePolicy.importRow('helpscout_connections',{...archived,secret_ciphertext:'old-secret'}).secret_ciphertext,null)
  const stored=await h.db.prepare("SELECT secret_ciphertext FROM helpscout_connections WHERE project_id='p'").first();assert.ok(!stored.secret_ciphertext.includes('synthetic-app-secret'))
  for(const secret of ['synthetic-app','synthetic-app-secret','synthetic-webhook-secret'])assert.ok(!JSON.stringify(metadata).includes(secret))
  for(const token of ['synthetic-app-secret','synthetic-webhook-secret','synthetic-scout-access']){
   assert.equal((await h.raw('/api/v1/contacts',{token})).status,401)
   assert.equal((await h.raw('/api/v1/mcp',{token,...body({jsonrpc:'2.0',id:1,method:'tools/list'})})).status,401)
  }
  // O6: signed intake only marks changes; duplicate digest and forged body are inert.
  const payload=JSON.stringify({id:901,type:'convo.updated',private:'not persisted'}),signature=createHmac('sha1','synthetic-webhook-secret').update(payload).digest('base64')
  const hook=(text=payload,sig=signature)=>h.raw('/api/helpscout/projects/p/webhook',{token:null,method:'POST',headers:{'X-HelpScout-Signature':sig},body:text})
  assert.equal((await hook()).status,202);assert.equal((await (await hook()).json()).duplicate,true)
  assert.equal((await h.call(root)).waiting_events,1)
  assert.equal((await hook(payload+' ',signature)).status,401)
  assert.equal((await h.db.prepare("SELECT count(*) n FROM helpscout_events WHERE project_id='p'").first()).n,1)
  assert.ok(!JSON.stringify((await h.db.prepare('SELECT * FROM helpscout_events').all()).results).includes('not persisted'))
  assert.equal((await h.raw('/api/helpscout/projects/p/webhook',{token:native.token,...body({})})).status,401)
  // First pull stages custody, not native history. Parsing and applying use the existing public import door.
  const first=await h.call(root+'/pull',body({}));assert.equal(first.review_required,true);assert.equal(first.runs.length,1)
  assert.equal((await h.db.prepare('SELECT count(*) n FROM move_in_conversations').first()).n,0)
  await h.drain()
  const reviewed=(await h.call(imports+'/'+first.runs[0])).data;assert.equal(reviewed.state,'ready');assert.equal(reviewed.plan.counts.rejected,0,JSON.stringify(reviewed.plan))
  await h.call(imports+'/'+reviewed.id+'/apply',body({fingerprint:reviewed.plan.fingerprint}));await h.drain()
  assert.equal((await h.call(imports+'/'+reviewed.id)).data.state,'completed')
  assert.equal((await h.db.prepare('SELECT count(*) n FROM move_in_conversations').first()).n,1)
  const cursor=(await h.call(root)).cursor;assert.ok(cursor);assert.equal((await h.call(root)).waiting_events,0)
  // Earlier imports are content/source deduplicated. A later changed pull uses modifiedSince and stays reviewed.
  const repeat=await h.call(root+'/pull',body({}));assert.deepEqual(repeat.runs,[reviewed.id]);await h.drain()
  assert.equal((await h.db.prepare('SELECT count(*) n FROM move_in_conversations').first()).n,1)
  changed=true;ids=[902]
  const later=await h.call(root+'/pull',body({}));assert.equal(later.runs.length,1);assert.ok(seen.some(path=>path.startsWith('/v2/conversations?')&&path.includes('modifiedSince=')))
  await h.drain();const laterRun=(await h.call(imports+'/'+later.runs[0])).data;assert.equal(laterRun.state,'ready')
  assert.equal((await h.db.prepare('SELECT count(*) n FROM move_in_conversations').first()).n,1,'changed conversations stay staged')
  // An interrupted response cannot advance the cursor, and no automatic retries hide the error.
  const beforeFailure=await h.call(root);failThreads=true
  const interrupted=await h.raw(root+'/pull',body({}));assert.equal(interrupted.status,502);assert.equal((await h.call(root)).cursor,beforeFailure.cursor);failThreads=false
  for(const status of [429,401]){error=status;const before=seen.length;const failed=await h.raw(root+'/pull',body({}));assert.equal(failed.status,502);assert.equal((await failed.json()).error.code,status===429?'rate_limited':'credentials_refused');assert.equal(seen.length,before+1);assert.equal((await h.call(root)).cursor,beforeFailure.cursor)}error=null
  // Disconnect and rotate retain the last successful cursor; next pull does not restart the source.
  await h.call(root,{method:'DELETE'});const disconnected=await h.call(root);assert.equal(disconnected.connected,false);assert.equal(disconnected.cursor,beforeFailure.cursor)
  assert.equal((await hook()).status,404)
  await connect('rotated-scout-app-secret');assert.equal((await h.call(root)).cursor,beforeFailure.cursor)
  const reconnectedAt=seen.length;ids=[];await h.call(root+'/pull',body({}));assert.ok(seen.slice(reconnectedAt).some(path=>path.includes('modifiedSince='+encodeURIComponent(beforeFailure.cursor))))
  // O7: the same pull contains an erased identity and an unrelated customer.
  // Per-conversation immutable packages let the existing 410 refusal skip only the erased one.
  const own=await h.db.prepare("SELECT c.contact_id FROM conversations c JOIN move_in_conversations m ON m.conversation_id=c.id WHERE m.source_id='901'").first()
  await h.call('/api/management/projects/p/contacts/'+own.contact_id+'/erase',body({}))
  ids=[901,903];changed=true
  const mixed=await h.call(root+'/pull',body({}));assert.equal(mixed.skipped_erased,1);assert.deepEqual(mixed.skips,[{reason:'erased_identity_match'}]);assert.equal(mixed.runs.length,1)
  await h.drain();const peer=(await h.call(imports+'/'+mixed.runs[0])).data;assert.equal(peer.state,'ready');assert.equal(peer.plan.counts.rejected,0)
  await h.call(imports+'/'+peer.id+'/apply',body({fingerprint:peer.plan.fingerprint}));await h.drain()
  assert.equal((await h.call(imports+'/'+peer.id)).data.state,'completed')
  assert.equal((await h.db.prepare("SELECT count(*) n FROM contacts WHERE email='ada@example.test'").first()).n,0)
  assert.equal((await h.db.prepare("SELECT count(*) n FROM move_in_conversations WHERE source_id='903'").first()).n,1)
  const repeatPeer=await h.call(root+'/pull',body({}));await h.drain();assert.equal(repeatPeer.skipped_erased,1)
  assert.equal((await h.db.prepare("SELECT count(*) n FROM move_in_conversations WHERE source_id='903'").first()).n,1)
  // Bounded pagination is resumable across manual pulls and reconnect; forged next URLs and oversized reads cannot move it.
  ids=[];pageMode=true;badNext=true;const pageCursor=(await h.call(root)).cursor
  assert.equal((await h.raw(root+'/pull',body({}))).status,502);assert.equal((await h.call(root)).cursor,pageCursor)
  badNext=false;const pageOne=await h.call(root+'/pull',body({}));assert.equal(pageOne.has_more,true);assert.equal(pageOne.cursor,pageCursor)
  await h.call(root,{method:'DELETE'});await connect('second-rotated-secret');const pageTwo=await h.call(root+'/pull',body({}));assert.equal(pageTwo.has_more,false);assert.ok(seen.at(-1).includes('page=2'));pageMode=false
  oversize=true;const beforeSize=(await h.call(root)).cursor,sizeFailure=await h.raw(root+'/pull',body({}));assert.equal(sizeFailure.status,502);assert.equal((await sizeFailure.json()).error.code,'response_size');assert.equal((await h.call(root)).cursor,beforeSize);oversize=false
  // O8: Help Scout health exposes errors, cursor, waiting count and the manual pull, never content.
  error=429;await h.raw(root+'/pull',body({}));const catalog=(await h.call('/api/management/projects/p/connections/connectors')).data,scout=catalog.find(row=>row.id==='helpscout')
  assert.equal(scout.health,'failing');assert.equal(scout.error_class,'rate_limited');assert.ok(scout.cursor&&scout.last_pull_at);assert.equal(scout.reconciliation[0].path,'/helpscout/pull')
  const safe=JSON.stringify(catalog);for(const text of ['rotated-scout-app-secret','synthetic-webhook-secret','Historical reply','Private note','private provider failure'])assert.ok(!safe.includes(text))
  assert.equal(h.external,0)
 }finally{await h.close()}
}
function json(data){return {status:200,headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}}
