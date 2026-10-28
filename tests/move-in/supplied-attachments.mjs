import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {contact,agent,ticket} from './freshdesk-fixtures.mjs'
import {assertBusinessEquality} from './business-equality.mjs'
export const publicBytes=Buffer.from('synthetic-hh-1 public receipt\n')
export const privateBytes=Buffer.from('synthetic-hh-2 private triage\n')
export const attachment=(id,name,bytes)=>({id,name,content_type:'text/plain',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),base64:bytes.toString('base64')})
export function suppliedFreshdesk(id=5001){const t=ticket(id);t.ticket.attachments=[attachment(80,'public-receipt.txt',publicBytes)];t.ticket.conversations[0].attachments=[attachment(81,'private-triage.txt',privateBytes)];return [structuredClone(contact),structuredClone(agent),t]}
const root='/api/move-in/projects/p/imports',post=body=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),encode=records=>records.map(JSON.stringify).join('\n')
export async function attachmentJourney(imported){
 const source=encode(suppliedFreshdesk())
 await imported('freshdesk',source,{before:h=>h.snapshot(),check:async({h,rows,review,initial})=>{
  const media=await rows('SELECT * FROM media ORDER BY filename'),c=(await rows('SELECT id,contact_id FROM conversations'))[0]
  assert.equal(media.length,2);assert.ok(media.find(m=>m.filename==='public-receipt.txt').message_id);assert.equal(media.find(m=>m.filename==='private-triage.txt').message_id,null)
  for(const m of media){const path=`/api/conversations/${c.id}/media/${m.id}`,expected=m.message_id?publicBytes:privateBytes
   assert.deepEqual((await h.download(path)).bytes,expected)
   assert.equal((await h.download(path,'foreign')).status,404)
  }
  const buckets=JSON.stringify(await h.call(`/api/dashboard/projects/p/conversations/${c.id}/buckets`));assert.match(buckets,/private-triage.txt/)
  const before=await h.snapshot(),repeat=(await h.call(`${root}?vendor=freshdesk`,{method:'POST',headers:{'X-Import-Filename':'repeat.jsonl'},body:source+'\n'})).data
  await h.drain();const ready=(await h.call(`${root}/${repeat.id}`)).data;assert.equal(ready.plan.counts.rejected,0)
  await h.call(`${root}/${repeat.id}/apply`,post({fingerprint:ready.plan.fingerprint}));await h.drain();assertBusinessEquality(before,await h.snapshot())
  await h.call(`${root}/${review.id}/undo`,post({}));await h.drain();const undone=(await h.call(`${root}/${review.id}`)).data;assert.equal(undone.state,'undone',JSON.stringify({error:undone.error,report:undone.report}));assertBusinessEquality(initial,await h.snapshot());assert.equal((await rows('SELECT * FROM move_in_attachment_bytes')).length,0)
  for(const m of media)assert.equal((await h.download(`/api/conversations/${c.id}/media/${m.id}`)).status,404)
 }})
 const bounded=suppliedFreshdesk(),boundedBytes=Buffer.alloc(48*1024,97);bounded[2].ticket.attachments=[attachment(80,'bounded.txt',boundedBytes)]
 await imported('freshdesk',encode(bounded),{check:async({h,rows})=>{const m=(await rows("SELECT * FROM media WHERE filename='bounded.txt'"))[0];assert.deepEqual((await h.download(`/api/conversations/${m.conversation_id}/media/${m.id}`)).bytes,boundedBytes)}})
 for(const mutate of [a=>a.sha256='0'.repeat(64),a=>a.base64='!invalid!',a=>a.size++,a=>a.base64='YQ=='.repeat(17000)]){
  const records=suppliedFreshdesk();mutate(records[2].ticket.attachments[0])
  await imported('freshdesk',encode(records),{apply:false,check:async({rejection,rows})=>{assert.match(rejection('ticket/5001'),/^attachment_/);assert.equal((await rows('SELECT * FROM media')).length,0)}})
 }
 const tooMany=suppliedFreshdesk();tooMany[2].ticket.attachments=Array.from({length:21},(_,i)=>attachment(i+100,'receipt.txt',publicBytes));await imported('freshdesk',encode(tooMany),{apply:false,check:({rejection})=>assert.equal(rejection('ticket/5001'),'attachment_count_limit')})
 await imported('freshdesk',source,{check:async({h,rows,review})=>{
  const media=(await rows('SELECT * FROM media'))[0],native=await h.call(`/api/conversations/${media.conversation_id}/media`,{method:'POST',headers:{'Content-Type':'text/plain','X-Filename':'native-edit.txt'},body:'synthetic-hh-3'})
  await h.call(`${root}/${review.id}/undo`,post({}));await h.drain();assert.equal((await rows('SELECT filename FROM media WHERE id='+JSON.stringify(native.id)))[0].filename,'native-edit.txt');assert.deepEqual((await h.download(`/api/conversations/${media.conversation_id}/media/${native.id}`)).bytes,Buffer.from('synthetic-hh-3'));assert.equal((await h.download(`/api/conversations/${media.conversation_id}/media/${media.id}`)).status,200)
 }})
 await imported('freshdesk',source,{apply:false,check:async({h,review,rows})=>{
  assert.equal((await h.raw(`${root}/${review.id}/apply`,{...post({fingerprint:review.plan.fingerprint}),actor:'operator'})).response.status,403)
  await h.db.prepare("UPDATE memberships SET role='operator' WHERE project_id='p' AND user_id='owner'").run()
  assert.equal((await h.raw(`${root}/${review.id}/apply`,post({fingerprint:review.plan.fingerprint}))).response.status,401);assert.equal((await rows('SELECT * FROM media')).length,0)
  await h.db.prepare("UPDATE memberships SET role='owner' WHERE project_id='p' AND user_id='owner'").run()
  await h.call(`${root}/${review.id}/apply`,post({fingerprint:review.plan.fingerprint}));await h.step();await h.call(`${root}/${review.id}/resume`,post({}));await h.drain();assert.equal((await rows('SELECT * FROM media')).length,2)
 }})
 const otherContact=structuredClone(contact);otherContact.contact.id=8;otherContact.contact.email='other@example.test'
 const otherTicket=ticket(5002);otherTicket.ticket.requester_id=8;otherTicket.ticket.attachments=[attachment(82,'other-receipt.txt',publicBytes)];otherTicket.ticket.conversations=[{...otherTicket.ticket.conversations[0],user_id:7,attachments:[attachment(83,'cross-private.txt',privateBytes)]}]
 await imported('freshdesk',encode([...suppliedFreshdesk(),otherContact,otherTicket]),{check:async({h,rows,review})=>{
  const c=(await rows("SELECT c.id,c.contact_id FROM conversations c JOIN move_in_conversations o ON o.conversation_id=c.id WHERE o.source_id='5001'"))[0],media=await rows('SELECT id FROM media WHERE conversation_id='+JSON.stringify(c.id))
  await h.contactSession('visitor','p',c.contact_id)
  const visitor=JSON.stringify(await h.call(`/api/conversations/${c.id}/messages`,{actor:'visitor'}));assert.match(visitor,/public-receipt.txt/);assert.doesNotMatch(visitor,/private-triage|Private triage/)
  for(const m of await rows('SELECT * FROM media WHERE conversation_id='+JSON.stringify(c.id))){const result=await h.download(`/api/conversations/${c.id}/media/${m.id}`,'visitor');assert.equal(result.status,m.message_id?200:404);if(m.message_id)assert.deepEqual(result.bytes,publicBytes)}
  await h.call(`/api/management/projects/p/contacts/${c.contact_id}/erase`,post({}))
  assert.equal((await rows('SELECT * FROM move_in_attachment_bytes')).length,1);const remaining=await rows('SELECT * FROM media');assert.equal(remaining.length,1);assert.equal(remaining[0].filename,'other-receipt.txt');assert.deepEqual((await h.download(`/api/conversations/${remaining[0].conversation_id}/media/${remaining[0].id}`)).bytes,publicBytes)
  for(const m of media)assert.equal((await h.download(`/api/conversations/${c.id}/media/${m.id}`)).status,404)
  assert.equal((await h.call(`${root}/${review.id}`)).data.state,'erased')
  assert.equal((await h.raw(`${root}?vendor=freshdesk`,{method:'POST',headers:{'X-Import-Filename':'erased.jsonl'},body:source})).response.status,410)
 }})
}
