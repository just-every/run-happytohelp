import assert from 'node:assert/strict'
import {nativeHarness} from './harness.mjs'
import {contact,ticket,agent} from './freshdesk-fixtures.mjs'
import {suppliedFreshdesk,attachment,publicBytes,privateBytes} from './supplied-attachments.mjs'
import {root,json,encode,review,apply,state,rows,upload} from './journey-kit.mjs'

export async function importErasureJourney(){
 const h=await nativeHarness()
 try{
  const peerContact=structuredClone(contact);peerContact.contact.id=8;peerContact.contact.email='peer@example.test';peerContact.contact.other_emails=[]
  const peer=ticket(5002);peer.ticket.requester_id=8
  peer.ticket.attachments=[attachment(82,'peer-receipt.txt',publicBytes)]
  peer.ticket.conversations=[{...peer.ticket.conversations[0],user_id:7,attachments:[attachment(83,'cross-private.txt',privateBytes)]}]
  const original=encode([...suppliedFreshdesk(),peerContact,peer]),ready=await review(h,'freshdesk',original)
  await apply(h,ready)
  const own=(await rows(h,"SELECT c.id,c.contact_id FROM conversations c JOIN move_in_conversations m ON m.conversation_id=c.id WHERE m.source_id='5001'"))[0]
  const other=(await rows(h,"SELECT c.id,c.contact_id FROM conversations c JOIN move_in_conversations m ON m.conversation_id=c.id WHERE m.source_id='5002'"))[0]
  await h.contactSession('visitor','p',own.contact_id)
  const visitor=JSON.stringify(await h.call(`/api/conversations/${own.id}/messages`,{actor:'visitor'}))
  assert.ok(visitor.includes('Refund sent.'));assert.ok(visitor.includes('public-receipt.txt'))
  assert.ok(!visitor.includes('Private triage'));assert.ok(!visitor.includes('private-triage'))
  const ownMedia=await rows(h,'SELECT * FROM media WHERE conversation_id=?',own.id)
  for(const file of ownMedia){const result=await h.download(`/api/conversations/${own.id}/media/${file.id}`,'visitor');assert.equal(result.status,file.message_id?200:404);if(file.message_id)assert.deepEqual(result.bytes,publicBytes)}
  assert.equal((await h.raw(`${root}/${ready.id}`,{actor:'visitor'})).response.status,403)
  assert.equal((await h.raw(`/api/dashboard/projects/p/conversations/${own.id}/buckets`,{actor:'visitor'})).response.status,403)
  // The same customer has rejected and incomplete uploads awaiting review. Their
  // email connects the new source ID, and that ID connects a later alias.
  const person=(id,email)=>({type:'contact',id,email,created_at:1704067200})
  const pending=await review(h,'intercom',encode([person('bridge','ada@example.test'),{type:'contact',id:'opaque',email:{address:'ada@example.test'},created_at:1704067200}]),'pending.jsonl')
  assert.ok(pending.plan.decisions.some(item=>item.rejection))
  const alias=await review(h,'intercom',encode([person('bridge','private-alias@example.test')]),'alias.jsonl')
  const unlinked=await upload(h,'intercom',encode([person('unparsed','private-alias@example.test')]),'not-reviewed.jsonl')
  const peerBefore=(await rows(h,'SELECT * FROM contacts WHERE id=?',other.contact_id))[0]
  const peerMessages=await rows(h,'SELECT * FROM messages WHERE conversation_id=?',other.id)
  await h.call(`/api/management/projects/p/contacts/${own.contact_id}/erase`,json({}))
  for(const run of [ready,pending,alias,unlinked]){
   const gone=await state(h,run)
   assert.equal(gone.state,'erased');assert.equal(gone.plan,null)
   assert.equal((await h.raw(`${root}/${run.id}/resume`,json({}))).response.status,409)
  }
  assert.equal((await (await h.files).list({prefix:'move-in/'})).objects.length,0)
  assert.equal((await rows(h,'SELECT COUNT(*) n FROM move_in_records'))[0].n,0)
  assert.equal((await rows(h,'SELECT COUNT(*) n FROM ik_jobs'))[0].n,0)
  assert.equal((await rows(h,"SELECT COUNT(*) n FROM messages WHERE conversation_id=? AND content<>''",own.id))[0].n,0)
  assert.deepEqual((await rows(h,'SELECT * FROM contacts WHERE id=?',other.contact_id))[0],peerBefore)
  assert.deepEqual(await rows(h,'SELECT * FROM messages WHERE conversation_id=?',other.id),peerMessages)
  const remaining=await rows(h,'SELECT * FROM media')
  assert.equal(remaining.length,1);assert.equal(remaining[0].filename,'peer-receipt.txt')
  assert.deepEqual((await h.download(`/api/conversations/${other.id}/media/${remaining[0].id}`)).bytes,publicBytes)
  for(const file of ownMedia)assert.equal((await h.download(`/api/conversations/${own.id}/media/${file.id}`)).status,404)
  assert.equal((await h.raw(`/api/conversations/${own.id}/messages`,{actor:'visitor'})).response.status,401)
  for(const [vendor,body] of [['freshdesk',original],['freshdesk',encode([{contact:{...contact.contact,email:'changed@example.test'}}])],['intercom',encode([person('fresh','ada@example.test')])],['intercom',encode([person('fresh','private-alias@example.test')])],['intercom',encode([person('bridge','changed@example.test')])]]){
   const result=await h.raw(`${root}?vendor=${vendor}`,{method:'POST',headers:{'X-Import-Filename':'replay.jsonl','X-Import-Schema':'2.16'},body})
   assert.equal(result.response.status,410);assert.equal(h.lastWrites,0)
  }
  assert.equal(h.outbound,0)
 }finally{await h.close()}
}
