import assert from 'node:assert/strict'
import {zendeskCorpus,publicBytes,privateBytes} from './zendesk-offline-fixture.mjs'
import {assertBusinessEquality} from './business-equality.mjs'
const root='/api/move-in/projects/p/imports',post=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),encode=records=>records.map(JSON.stringify).join('\n')
/** One owner's offline move, inspected through the existing review, ticket,
 * media and erasure doors. Absorbed by the existing Zendesk landing journey. */
export async function zendeskOfflineJourney(imported){
 const records=await zendeskCorpus(),body=encode(records)
 assert.doesNotMatch(body,/synthetic-hh-local-only|\?token=|\/attachments\/token\//)
 await imported('zendesk',body,{apply:false,before:h=>h.snapshot(),check:async({h,rows,review,initial,rejection,omissions})=>{
  assertBusinessEquality(initial,await h.snapshot(),'review has no native effect')
  const damaged=structuredClone(records);damaged.filter(r=>r.ticket?.id===1001).forEach(r=>r.ticket._offline.attachments[0].sha256='0'.repeat(64))
  const damagedRun=(await h.call(`${root}?vendor=zendesk`,{method:'POST',headers:{'X-Import-Filename':'synthetic-hh-damaged.ndjson'},body:encode(damaged)})).data
  await h.drain();const damagedReview=(await h.call(`${root}/${damagedRun.id}`)).data
  assert.equal(damagedReview.plan.decisions.find(d=>d.kind==='ticket'&&d.sourceId==='1001').rejection,'attachment_digest_mismatch')
  assertBusinessEquality(initial,await h.snapshot(),'rejected supplied bytes have no native effect')
  assert.equal(review.plan.duplicateRecords,1)
  assert.equal(rejection('ticket/2001'),'zendesk_comments_incomplete');assert.equal(rejection('ticket/2002'),'zendesk_comments_incomplete')
  assert.ok(omissions('ticket/1001').includes('attachments_metadata_retained_bytes_not_imported:503'))
  const target=review.plan.decisions.find(d=>d.kind==='ticket'&&d.sourceId==='1001').targets[0]
  assert.deepEqual(target.transcript,{comments:2,notes:1,status:'open',fields:1,tags:1});assert.equal(target.history.events,5);assert.equal(target.attachments.length,2)
  assert.equal((await h.raw(`${root}/${review.id}/apply`,post({fingerprint:'stale'}))).response.status,409)
  assert.equal((await h.raw(`${root}/${review.id}/apply`,{...post({fingerprint:review.plan.fingerprint}),actor:'foreign'})).response.status,404)
  await h.call(`${root}/${review.id}/apply`,post({fingerprint:review.plan.fingerprint}));await h.step()
  const partial=(await h.call(`${root}/${review.id}`)).data;assert.ok(['applying','completed'].includes(partial.state))
  await h.call(`${root}/${review.id}/resume`,post({}));await h.drain()
  const c=(await rows("SELECT c.id,c.contact_id FROM conversations c JOIN move_in_conversations s ON s.conversation_id=c.id WHERE s.source_id='1001'"))[0]
  assert.equal((await rows('SELECT * FROM conversations')).length,6);assert.equal((await rows('SELECT * FROM contacts')).length,1)
  assert.equal((await rows('SELECT * FROM users')).length,3,'historical staff have no native login')
  assert.ok((await rows('SELECT is_verified FROM contacts')).every(r=>r.is_verified===0));assert.ok((await rows('SELECT portal_company_view FROM companies')).every(r=>r.portal_company_view===0))
  assert.equal((await rows('SELECT * FROM ticket_field_values')).length,6)
  const history=await h.call(`/api/conversations/${c.id}/imported-history`);assert.equal(history.history.events.length,5);assert.equal(history.history.events.find(e=>e.id==='602').elapsed.business,480)
  assert.equal((await h.raw(`/api/conversations/${c.id}/imported-history`,{actor:'foreign'})).response.status,404)
  const media=await rows('SELECT * FROM media ORDER BY message_id DESC');assert.equal(media.length,2);assert.equal(new Set(media.map(m=>m.id)).size,2);assert.ok(media.every(m=>m.filename==='receipt.txt'))
  for(const m of media){const path=`/api/conversations/${c.id}/media/${m.id}`;assert.deepEqual((await h.download(path)).bytes,m.message_id?publicBytes:privateBytes);assert.equal((await h.download(path,'foreign')).status,404)}
  for(const table of ['ticket_sla_state','sla_alerts'])assert.equal((await rows(`SELECT * FROM ${table}`)).length,0)
  const after=await h.snapshot(),repeat=(await h.call(`${root}?vendor=zendesk`,{method:'POST',headers:{'X-Import-Filename':'synthetic-hh-repeat.ndjson'},body:body+' \n'})).data
  await h.drain();const ready=(await h.call(`${root}/${repeat.id}`)).data;assert.equal(ready.plan.counts.rejected,2)
  await h.call(`${root}/${repeat.id}/apply`,post({fingerprint:ready.plan.fingerprint}));await h.drain();assertBusinessEquality(after,await h.snapshot())
  await h.call(`${root}/${review.id}/undo`,post({}));await h.drain();assertBusinessEquality(initial,await h.snapshot());assert.equal((await rows('SELECT * FROM move_in_attachment_bytes')).length,0)
 }})
 await imported('zendesk',body,{check:async({h,rows,review})=>{
  const c=(await rows("SELECT c.id,c.contact_id FROM conversations c JOIN move_in_conversations s ON s.conversation_id=c.id WHERE s.source_id='1001'"))[0]
  const native=await h.call(`/api/conversations/${c.id}/media`,{method:'POST',headers:{'Content-Type':'text/plain','X-Filename':'synthetic-hh-native.txt'},body:'synthetic-hh-native-edit'})
  const correctedBeforeErasure=structuredClone(records);correctedBeforeErasure.filter(r=>r.ticket?.id===1001).forEach(r=>r.ticket.subject='synthetic-hh-corrected')
  const correction=(await h.call(`${root}?vendor=zendesk`,{method:'POST',headers:{'X-Import-Filename':'synthetic-hh-correction.ndjson'},body:encode(correctedBeforeErasure)})).data
  await h.drain();const correctedReview=(await h.call(`${root}/${correction.id}`)).data
  assert.equal(correctedReview.plan.decisions.find(d=>d.kind==='ticket'&&d.sourceId==='1001').rejection,'source_changed_conflict')
  await h.call(`${root}/${review.id}/undo`,post({}));await h.drain()
  assert.equal((await h.download(`/api/conversations/${c.id}/media/${native.id}`)).status,200,'undo preserves native edits and their imported ticket')
  const other=(await h.call('/api/management/projects/p/contacts',post({name:'synthetic-hh-9',email:'synthetic-hh-9@example.test'}))).data
  await h.contactSession('other-customer','p',other.id)
  for(const m of await rows('SELECT * FROM media'))assert.equal((await h.download(`/api/conversations/${c.id}/media/${m.id}`,'other-customer')).status,404)
  await h.contactSession('visitor','p',c.contact_id)
  assert.equal((await h.raw(`/api/conversations/${c.id}/imported-history`,{actor:'visitor'})).response.status,404)
  const visitor=JSON.stringify(await h.call(`/api/conversations/${c.id}/messages`,{actor:'visitor'}));assert.doesNotMatch(visitor,/private note|502/)
  for(const m of await rows('SELECT * FROM media'))assert.equal((await h.download(`/api/conversations/${c.id}/media/${m.id}`,'visitor')).status,m.message_id?200:404)
  await h.call(`/api/management/projects/p/contacts/${c.contact_id}/erase`,post({}))
  assert.equal((await rows('SELECT * FROM move_in_attachment_bytes')).length,0)
  assert.equal((await rows('SELECT * FROM move_in_notes')).length,0)
  assert.equal((await rows('SELECT * FROM ik_jobs')).length,0);assert.equal((await rows('SELECT * FROM move_in_records')).length,0)
  assert.equal((await (await h.files).list({prefix:'move-in/'})).objects.length,0)
  assert.equal((await h.raw(`/api/conversations/${c.id}/imported-history`)).response.status,404)
  assert.equal((await h.call(`${root}/${review.id}`)).data.state,'erased')
  const corrected=structuredClone(records);corrected.filter(r=>r.ticket?.id===1001).forEach(r=>r.ticket.subject='synthetic-hh-corrected')
  for(const source of [body,encode(corrected)])assert.equal((await h.raw(`${root}?vendor=zendesk`,{method:'POST',headers:{'X-Import-Filename':'synthetic-hh-erased.ndjson'},body:source})).response.status,410)
  assert.equal((await h.raw(`${root}/${review.id}/resume`,post({}))).response.status,409)
  assert.equal(h.outbound,0)
 }})
}
