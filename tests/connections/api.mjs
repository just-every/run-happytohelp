import {api001Outcomes} from './api001-outcomes.mjs'
import {api001ScoutOutcomes} from './api001-helpscout-outcomes.mjs'
import assert from 'node:assert/strict'
import {harness,body,sha} from './harness.mjs'
import {deliveryLifecycle} from './delivery.mjs'
import {installSlack,assertSlack} from './slack.mjs'

// A connected product installs scoped credentials, opens a real support request
// and observes its signed lifecycle. Network receivers are the only fakes.
export async function connectionsJourney(){
 await api001Outcomes()
 await api001ScoutOutcomes()
 const h=await harness(),settings='/api/management/projects/p/connections'
 try{
  const destination=await h.call(settings+'/webhooks',body({name:'Support events',url:'https://receiver.example.com/events',events:['conversation.created','message.created','conversation.resolved','conversation.rated']}))
  const slack=await installSlack(h)
  const creator=await h.issue(['conversations:create'],'p',{name:'Order system',source_product:'orders'}),token=creator.token
  const stored=await h.db.prepare('SELECT token_hash FROM integration_tokens WHERE id=?').bind(creator.data.id).first()
  assert.equal(stored.token_hash,sha(token));assert.ok(!JSON.stringify(await h.call(settings+'/tokens')).includes(token))
  assert.equal((await h.raw(settings+'/tokens',{token})).status,404,'machine credentials cannot manage settings')
  const input={requester:{email:'buyer@example.test'},subject:'Replacement delivery',body:'<!channel> <@U123> & <https://example.test|link>',source_ref:{product:'orders',ref:'TO-48200',url:'https://orders.example.test/TO-48200'}}
  const create=(value=input,key='order-support')=>h.raw('/api/v1/conversations',{token,...body(value),headers:{'Content-Type':'application/json','Idempotency-Key':key}})
  const first=await create();assert.equal(first.status,201);const created=await first.json(),id=created.data.id
  const replay=await create();assert.equal(replay.status,201);assert.equal(replay.headers.get('Idempotency-Replayed'),'true');assert.deepEqual(await replay.json(),created)
  assert.equal((await create({...input,body:'Changed request'})).status,409)
  assert.equal((await h.raw('/api/v1/conversations/'+id,{token})).status,403)
  const appender=await h.issue(['messages:append'],'p',{source_product:'orders',bindings:{credentials:[creator.data.id]}})
  const append='/api/v1/conversations/'+id+'/append',command={kind:'customer',localId:'order-update',content:'Here is my replacement order reference.'}
  const appended=await h.call(append,{token:appender.token,...body(command)});assert.equal((await h.call(append,{token:appender.token,...body(command)})).data.id,appended.data.id)
  const note=await h.call(append,{token:appender.token,...body({kind:'note',localId:'order-private-note',content:'Private warehouse context'})});assert.ok(note.data.id)
  const reader=await h.issue(['conversations:read'],'p',{source_product:'orders',bindings:{credentials:[creator.data.id]}})
  assert.equal((await h.call('/api/v1/conversations',{token:reader.token})).data[0].id,id)
  const foreign=await h.issue(['conversations:read'],'q')
  assert.equal((await h.raw('/api/v1/conversations/'+id,{token:foreign.token})).status,404)
  const publicBytes=JSON.stringify(await h.call('/api/v1/conversations/'+id+'/messages',{token:reader.token}));assert.ok(!publicBytes.includes('Private warehouse context'))

  // The same request notifies the installed workspace, once, with escaped Slack
  // text and signed event bytes. Repeated executor runs do not send duplicates.
  h.responses.push(...Array.from({length:12},()=>({status:200,body:'ok'})))
  await h.dispatch();h.responses.length=0
  await assertSlack(h,slack,id)
  const eventReceipts=h.received.filter(receipt=>receipt.headers['webhook-destination']===destination.id)
  assert.ok(eventReceipts.length>0)
  await deliveryLifecycle(h,destination,eventReceipts)

  // Native API operations use the same admission/frontier and resolution doors.
  const full=await h.issue(),current=(await h.call('/api/v1/conversations/'+id+'/messages',{token:full.token}))
  const revision=(await h.db.prepare('SELECT revision FROM conversations WHERE id=?').bind(id).first()).revision
  const reply={localId:'operator-api-reply',content:'Your replacement has shipped.',expectedRevision:revision}
  const sent=await h.call('/api/v1/conversations/'+id+'/messages',{token:full.token,...body(reply)})
  assert.equal((await h.call('/api/v1/conversations/'+id+'/messages',{token:full.token,...body(reply)})).duplicate,true)
  assert.ok(sent.data.id);assert.ok(current.data)
  await h.call('/api/v1/conversations/'+id+'/resolve',{token:full.token,...body({})})
  assert.ok((await h.db.prepare('SELECT resolved_at FROM conversations WHERE id=?').bind(id).first()).resolved_at)
  const limited=await h.issue(['contacts:read']);assert.equal((await h.raw('/api/v1/articles',{token:limited.token})).status,403)
  const minute=Math.floor(Date.now()/60000)*60000
  await h.db.prepare('INSERT INTO abuse_counters(key,window_start,used,expires_at) VALUES(?,?,120,?) ON CONFLICT(key) DO UPDATE SET window_start=excluded.window_start,used=excluded.used,expires_at=excluded.expires_at').bind('rate:apiRequestsPerTokenMinute:'+sha(limited.data.id),minute,minute+60000).run()
  const refused=await h.raw('/api/v1/contacts',{token:limited.token});assert.equal(refused.status,429);assert.ok(refused.headers.get('Retry-After'))
  assert.equal((await h.raw('/api/v1/contacts',{token:full.token})).status,200)

  // Pagination is tied to this grant's tenant and filter, with no missing tied rows.
  await h.contact('another');await h.conversation('another')
  const one=await h.call('/api/v1/conversations?limit=1',{token:full.token}),two=await h.call('/api/v1/conversations?limit=1&cursor='+encodeURIComponent(one.next_cursor),{token:full.token})
  assert.equal(new Set([...one.data,...two.data].map(ticket=>ticket.id)).size,2);assert.equal(two.next_cursor,null)
  const expiring=await h.issue(['contacts:read'],'p',{expires_at:new Date(Date.now()+60000).toISOString()})
  await h.db.prepare('UPDATE api_credentials SET expires_at=1 WHERE id=?').bind(expiring.data.id).run();assert.equal((await h.raw('/api/v1/contacts',{token:expiring.token})).status,401)
  const contact=await h.db.prepare('SELECT contact_id FROM conversations WHERE id=?').bind(id).first()
  await h.call('/api/management/projects/p/contacts/'+contact.contact_id+'/erase',body({}))
  assert.equal((await h.raw('/api/v1/conversations/'+id,{token:full.token})).status,404)
  assert.equal((await create({...input,source_ref:{...input.source_ref,ref:'cannot-recreate'}},'after-erasure')).status,409)
  await h.call(settings+'/tokens/'+full.data.id,{method:'DELETE'});assert.equal((await h.raw('/api/v1/contacts',{token:full.token})).status,401)
  assert.equal(h.external,0)
 }finally{await h.close()}
}
