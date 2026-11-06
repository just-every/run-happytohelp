import assert from 'node:assert/strict'
import {setTimeout} from 'node:timers/promises'
import {allScopes,body,harness,sha} from './harness.mjs'
import {deliveryLifecycle} from './delivery.mjs'
import {installSlack,assertSlack} from './slack.mjs'

const settings='/api/management/projects/p/connections'
const deliveryState=async(h,id)=>(await h.call(settings+'/deliveries')).data.filter(row=>row.id===id).at(-1)

async function credentialOutcomes(h){
 const scopes=['contacts:read','contacts:write'],expires=Date.now()+4000
 const issued=await h.issue([...scopes].reverse(),'p',{expires_at:new Date(expires).toISOString()})
 assert.match(issued.token,/^int_[a-f0-9]{64}$/)
 assert.deepEqual(issued.data.scopes,scopes,'issue grants exactly the selected owner/admin scopes')
 assert.equal(issued.data.expiresAt,new Date(expires).toISOString())
 const stored=await h.db.prepare('SELECT * FROM integration_tokens WHERE namespace=? AND id=?').bind('p',issued.data.id).first()
 assert.equal(stored.token_hash,sha(issued.token),'the stored verifier is SHA-256 of the shown secret')
 assert.equal(stored.expires_at,expires)
 assert.deepEqual(JSON.parse(stored.scopes),scopes)
 assert.ok(!JSON.stringify(stored).includes(issued.token),'the secret is not stored in the token record')
 const policy=await h.db.prepare('SELECT * FROM api_credentials WHERE namespace=? AND id=?').bind('p',issued.data.id).first()
 assert.equal(policy.source_product,null,'this is the CONNECTIONS-001 credential, without machine bindings')
 assert.equal(policy.expires_at,expires)
 assert.deepEqual(JSON.parse(policy.scopes),scopes)
 assert.ok(!JSON.stringify(policy).includes(issued.token))
 const created=await h.call('/api/v1/contacts',{token:issued.token,...body({name:'Native API contact',email:'connections-scope@example.com'})})
 assert.equal((await h.call('/api/v1/contacts/'+created.data.id,{token:issued.token})).data.name,'Native API contact')
 for(const path of ['/api/v1/articles','/api/v1/conversations'])assert.equal((await h.raw(path,{token:issued.token})).status,403,'unselected scope refused')
 const crossOrigin=await h.raw('/api/v1/contacts',{token:issued.token,headers:{Origin:'https://caller.example.com'}})
 assert.equal(crossOrigin.status,200)
 assert.equal(crossOrigin.headers.get('Access-Control-Allow-Origin'),null,'the bearer API never grants CORS')
 assert.equal((await h.raw('/api/v1/contacts',{token:null,headers:{Cookie:'h2h_session='+issued.token}})).status,401)
 assert.equal((await h.raw('/api/v1/contacts?token='+issued.token,{token:null})).status,401)
 assert.equal((await h.raw('/api/v1/contacts')).status,401,'native session is not an API credential')
 const usage=await h.call(settings+'/tokens/usage')
 assert.ok(usage.data.some(row=>row.tokenId===issued.data.id&&row.allowed&&row.requiredScopes.includes('contacts:write')))
 assert.ok(usage.data.some(row=>row.tokenId===issued.data.id&&!row.allowed))
 async function listedOnce(){
  const list=await h.call(settings+'/tokens'),metadata=list.data.find(row=>row.id===issued.data.id)
  assert.deepEqual(metadata.scopes,scopes)
  assert.equal(metadata.expiresAt,new Date(expires).toISOString())
  assert.ok(!JSON.stringify(list).includes(issued.token),'listing never shows the secret again')
  assert.ok(!JSON.stringify(list).includes(stored.token_hash),'listing never exposes the stored verifier')
 }
 await listedOnce();await h.restart();await listedOnce()
 // Exercise real expiry, without changing the credential or replacing its clock.
 await setTimeout(Math.max(0,expires-Date.now()+50))
 assert.equal((await h.raw('/api/v1/contacts',{token:issued.token})).status,401)
 assert.equal((await h.raw('/api/v1/contacts',{token:issued.token,...body({name:'Expired write'})})).status,401)
 assert.equal((await h.db.prepare("SELECT count(*) n FROM contacts WHERE name='Expired write'").first()).n,0)

 const full=await h.issue()
 assert.deepEqual(full.data.scopes,[...allScopes].sort())
 assert.equal(full.data.expiresAt,null,'expiry is optional for the existing owner/admin model')
 const unexpired=await h.db.prepare('SELECT token_hash,expires_at FROM integration_tokens WHERE namespace=? AND id=?').bind('p',full.data.id).first()
 assert.equal(unexpired.token_hash,sha(full.token));assert.equal(unexpired.expires_at,null)
 for(const input of [{expires_at:new Date(1).toISOString()},{expires_at:'invalid'},{scopes:['unsupported:scope']}])assert.equal((await h.raw(settings+'/tokens',body({name:'Refused grant',scopes,...input}))).status,400)
 // An admin uses the same public settings door; an operator cannot issue grants.
 await h.db.prepare("UPDATE memberships SET role='admin' WHERE project_id='p' AND user_id='owner'").run()
 await h.session('administrator','p','owner','admin')
 const admin=await h.call(settings+'/tokens',{actor:'administrator',...body({name:'Admin connection',scopes:['articles:read']})})
 assert.deepEqual(admin.data.scopes,['articles:read'])
 assert.equal((await h.raw('/api/v1/articles',{token:admin.token})).status,200)
 await h.db.prepare("UPDATE memberships SET role='operator' WHERE project_id='p' AND user_id='owner'").run()
 await h.session('operator','p','owner','operator')
 assert.equal((await h.raw(settings+'/tokens',{actor:'operator',...body({name:'Denied',scopes})})).status,403)
 await h.db.prepare("UPDATE memberships SET role='owner' WHERE project_id='p' AND user_id='owner'").run()
 await h.call(settings+'/tokens/'+admin.data.id,{method:'DELETE'})
 assert.equal((await h.raw('/api/v1/articles',{token:admin.token})).status,401)
 const audit=(await h.db.prepare('SELECT * FROM native_integration_audit WHERE project_id=?').bind('p').all()).results
 assert.ok(audit.some(row=>row.action==='token.issued'&&JSON.parse(row.resource_id).credential_id===issued.data.id))
 assert.ok(audit.some(row=>row.action==='token.revoke'&&row.resource_id===admin.data.id))
 for(const secret of [issued.token,full.token,admin.token])assert.ok(!JSON.stringify([audit,usage,await h.call(settings+'/tokens')]).includes(secret))
 return full
}

async function outgoingByteOutcomes(h,destination){
 // Persisted-queue boundary fixtures: start with a real owner-created test
 // delivery, then vary only its durable body before public-door retry. No
 // transport, repository, clock or application function is replaced.
 const limit=1048576
 for(const [label,payload,accepted] of [
  ['at-limit',JSON.stringify('x'.repeat(limit-2)),true],
  ['over-limit',JSON.stringify('x'.repeat(limit-1)),false],
  ['utf8-over-limit',JSON.stringify('😀'.repeat(limit/4)),false]
 ]){
  h.responses.push({status:429,headers:{'Retry-After':'0'}})
  const queued=await h.call(settings+'/webhooks/'+destination.id+'/test',body({}))
  assert.equal((await deliveryState(h,queued.id)).state,'queued')
  const row=await h.db.prepare('SELECT envelope FROM integration_deliveries WHERE namespace=? AND id=?').bind('p',queued.id).first()
  const envelope={...JSON.parse(row.envelope),body:payload}
  assert.equal(Buffer.byteLength(payload)>limit,!accepted,label+' measures UTF-8 bytes')
  await h.db.prepare('UPDATE integration_deliveries SET envelope=?,next_at=0 WHERE namespace=? AND id=?').bind(JSON.stringify(envelope),'p',queued.id).run()
  const before=h.received.length
  // The ordinary Settings test action also drains ready persisted work.
  await h.call(settings+'/webhooks/'+destination.id+'/test',body({}))
  const receipts=h.received.slice(before).filter(receipt=>receipt.headers['webhook-id']===queued.id)
  assert.equal(receipts.length,accepted?1:0,label+' is enforced before network I/O')
  const state=await deliveryState(h,queued.id)
  assert.equal(state.state,accepted?'accepted':'rejected')
  if(accepted)assert.equal(receipts[0].body.byteLength,limit)
  else assert.equal(state.error_class,'preflight_failed')
 }
 const stopped=h.received.length
 await h.restart()
 await h.call(settings+'/webhooks/'+destination.id+'/test',body({}))
 assert.equal(h.received.length,stopped+1,'only the new explicit test sends; rejected oversized work stays stopped')
}

async function boundedRateLimitOutcomes(h,destination){
 const testPath=settings+'/webhooks/'+destination.id+'/test'
 h.responses.push({status:429,headers:{'Retry-After':'0'}})
 const queued=await h.call(testPath,body({}))
 for(let attempt=2;attempt<=4;attempt++){
  const prior=await deliveryState(h,queued.id)
  assert.equal(prior.state,'queued');assert.equal(prior.attempts,attempt-1)
  await h.db.prepare('UPDATE integration_deliveries SET next_at=0 WHERE namespace=? AND id=?').bind('p',queued.id).run()
  h.responses.push({status:429,headers:{'Retry-After':'0'}})
  await h.call(testPath,body({}))
 }
 const terminal=await deliveryState(h,queued.id)
 assert.equal(terminal.state,'rejected');assert.equal(terminal.attempts,4)
 const receipts=h.received.filter(receipt=>receipt.headers['webhook-id']===queued.id)
 assert.equal(receipts.length,4)
 assert.ok(receipts.every(receipt=>receipt.body.equals(receipts[0].body)),'all bounded 429 attempts retain the same event bytes')
 await h.restart();await h.call(testPath,body({}))
 assert.equal(h.received.filter(receipt=>receipt.headers['webhook-id']===queued.id).length,4,'exhausted 429 work never replays')
}

export async function connectionOutcomes(){
 const h=await harness()
 try{
  const full=await credentialOutcomes(h)
  const destination=await h.call(settings+'/webhooks',body({name:'Native support events',url:'https://receiver.example.com/native',events:['conversation.created','message.created','conversation.resolved','conversation.rated']}))
  const slack=await installSlack(h)
  // A native visitor starts the case. No source product, bindings, rotation or
  // machine create/append protocol participates in this CONNECTIONS-001 proof.
  const visitor=await h.call('/api/v1/contacts',{token:full.token,...body({name:'Native visitor',email:'connections-erasure@example.com'})})
  await h.session('native-visitor','p',visitor.data.id)
  const conversation=await h.conversation('native-visitor'),id=conversation.id
  const prefix='<!channel> <@U123> & <https://example.com|link> '+'😀'.repeat(500)
  const tail='TAIL_MUST_NOT_REACH_SLACK',content=prefix+'x'.repeat(100000-prefix.length-tail.length)+tail
  assert.equal(content.length,100000)
  const admitted=await h.call('/api/conversations/'+id+'/messages',{actor:'native-visitor',...body({localId:'native-large-message',content,expectedRevision:0})})
  assert.equal(admitted.accepted,true)
  h.responses.push(...Array.from({length:8},()=>({status:200,body:'ok'})))
  await h.call(settings+'/webhooks/'+destination.id+'/test',body({}));h.responses.length=0
  await assertSlack(h,slack,id)
  const notification=h.received.find(receipt=>receipt.path.startsWith('/hooks.slack.com/'))
  const escaped=Array.from(content).slice(0,500).join('').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
  assert.equal(JSON.parse(notification.body).blocks[0].text.text,escaped,'Slack projects exactly the first 500 Unicode characters')
  assert.ok(!notification.body.includes(Buffer.from('TAIL_MUST_NOT_REACH_SLACK')))
  for(const receipt of h.received)assert.ok(receipt.body.byteLength<=1048576,'emitted webhook and Slack bytes stay bounded')
  const events=h.received.filter(receipt=>receipt.headers['webhook-destination']===destination.id)
  assert.ok(events.some(receipt=>JSON.parse(receipt.body).event==='conversation.created'))
  assert.ok(events.some(receipt=>JSON.parse(receipt.body).event==='message.created'))
  await deliveryLifecycle(h,destination,events)
  const revision=(await h.call('/api/v1/conversations/'+id+'/messages',{token:full.token})).revision
  const reply={localId:'native-api-reply',content:'Your support request is received.',expectedRevision:revision}
  const sent=await h.call('/api/v1/conversations/'+id+'/messages',{token:full.token,...body(reply)})
  assert.ok(sent.data.id)
  assert.equal((await h.call('/api/v1/conversations/'+id+'/messages',{token:full.token,...body(reply)})).duplicate,true)
  await h.call('/api/v1/conversations/'+id+'/resolve',{token:full.token,...body({})})
  const limited=await h.issue(['contacts:read'])
  const minute=Math.floor(Date.now()/60000)*60000
  await h.db.prepare('INSERT INTO abuse_counters(key,window_start,used,expires_at) VALUES(?,?,120,?)').bind('rate:apiRequestsPerTokenMinute:'+sha(limited.data.id),minute,minute+60000).run()
  const refused=await h.raw('/api/v1/contacts',{token:limited.token})
  assert.equal(refused.status,429);assert.ok(refused.headers.get('Retry-After'))
  assert.equal((await h.raw('/api/v1/contacts',{token:full.token})).status,200,'one token cannot consume another token\'s quota')
  const pending=(await h.db.prepare('SELECT i.id FROM native_integration_intents i JOIN native_integration_events e ON e.id=i.event_id WHERE e.project_id=? AND e.contact_id=?').bind('p',visitor.data.id).all()).results.map(row=>row.id)
  await h.call('/api/management/projects/p/contacts/'+visitor.data.id+'/erase',body({}))
  assert.equal((await h.raw('/api/v1/contacts',{token:full.token,...body({name:'Cannot restore',email:'connections-erasure@example.com'})})).status,409,'native API cannot restore an erased identity')
  assert.equal((await h.raw('/api/v1/conversations/'+id,{token:full.token})).status,404)
  const erased=await h.db.prepare('SELECT * FROM native_integration_events WHERE project_id=? AND erased_at IS NOT NULL').bind('p').all()
  assert.ok(erased.results.length>0)
  for(const event of erased.results){assert.equal(event.body,'{}');assert.equal(event.contact_id,null);assert.equal(event.conversation_id,null)}
  const before=h.received.length
  await h.call(settings+'/webhooks/'+destination.id+'/test',body({}))
  const afterErasure=h.received.slice(before)
  assert.ok(afterErasure.every(receipt=>!pending.includes(receipt.headers['webhook-id'])),'erased pending native payloads never send')
  assert.deepEqual(afterErasure.map(receipt=>JSON.parse(receipt.body).event).sort(),['contact.erased','integration.test'],'only the explicit erasure notification and new test may send')
  await h.call(settings+'/tokens/'+full.data.id,{method:'DELETE'})
  assert.equal((await h.raw('/api/v1/contacts',{token:full.token})).status,401)
  await outgoingByteOutcomes(h,destination)
  await boundedRateLimitOutcomes(h,destination)
  assert.equal(h.external,0)
 }finally{await h.close()}
}
