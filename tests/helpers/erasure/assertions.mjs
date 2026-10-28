import assert from 'node:assert/strict'

export function erasedCustomer(state){
 const flags=JSON.parse(state.contact.metadata_json)
 assert.equal(state.contact.name,null);assert.equal(state.contact.email,null)
 assert.equal(state.contact.external_id,null);assert.equal(state.contact.is_verified,0)
 assert.ok(flags.is_erased&&flags.is_blocked&&flags.is_deleted)
 assert.ok(state.messages.length>0)
 for(const message of state.messages){
  assert.equal(message.content,'');assert.equal(message.intent_hash,null);assert.ok(message.erased)
  assert.doesNotMatch(message.local_id,/Alice|4471/)
 }
 for(const key of ['sessions','media','notes','participants','reads','contextJobEvents','localAttachments','localGrants','staged'])assert.deepEqual(state[key],[],key)
 assert.ok(state.objects.every(object=>object===null))
 assert.ok(Object.values(state.context).every(count=>count===0))
 assert.ok(state.rawContent.every(row=>row.content_raw===null))
 assert.ok(state.ratings.length>0&&state.ratings.every(row=>row.comment===''))
 assert.ok(state.legacy.every(row=>Object.keys(JSON.parse(row.source_json)).length===0))
 assert.ok(state.buckets.every(row=>Object.keys(JSON.parse(row.metadata_json)).length===0))
 assert.ok(state.email.every(row=>row.recipient===''))
 assert.equal(state.localJob.status,'cancelled');assert.equal(state.localJob.cancel_requested,1)
 assert.equal(state.localJob.instructions,'');assert.equal(state.localJob.context,null);assert.equal(state.localJob.result,null)
 assert.equal(state.localEffect.state,'cancelled');assert.equal(state.localReceipt.review_message,null)
 assert.equal(state.generations.find(row=>row.id==='gen-run').state,'cancelled')
 // Scan the complete retained custody view, including AI/delegation payloads,
 // inbound evidence and imported archive copies, for the seeded personal content.
 const retained=JSON.stringify(state)
 for(const fragment of ['Alice','alice','4471','4242','Sydney','crm-alice','203.0.113.9','Private Lane','Second conversation secret'])assert.equal(retained.includes(fragment),false,`${fragment} remains in customer custody`)
}
