import assert from 'node:assert/strict'

// Search the customer's real history after queue/status changes, not a second
// database populated only to exercise every spelling of the same predicate.
export async function inboxSearchFlow(f){
 const {app,w,foreign,visitor,get,patch}=f,id=f.queueIds[0]
 const current=await get(id),text='Refund the last invoice for the cobalt buckle replacement; code 100%_north.'
 await app.ok(`/api/conversations/${id}/messages`,{token:w.tokens.owner,body:{localId:'retained-search-answer',content:text,expectedRevision:current.revision}})
 const search=async(q,filters={})=>(await app.ok(`${f.base}/conversations?`+new URLSearchParams({q,...filters}),{token:w.tokens.owner})).data
 for(const q of ['refund "last invoice"','replacement buckle','Dana Whitfield','  DANA.WHITFIELD@example.test  ','100%_north'])assert.ok((await search(q)).some(row=>row.id===id),q)
 assert.ok(!(await search('"invoice last"')).some(row=>row.id===id))
 assert.deepEqual(await search('%%'),[],'SQL wildcard syntax stays literal')
 const head=await get(id)
 await app.ok(`/api/conversations/${id}/messages`,{token:w.tokens.owner,body:{localId:'latest-search-answer',content:'Your revised receipt is attached.',expectedRevision:head.revision}})
 const retained=(await search('cobalt buckle replacement')).find(row=>row.id===id)
 assert.equal(retained.matched_message.content,text)
 assert.equal(retained.last_message.content,'Your revised receipt is attached.')
 await patch(id,{status_id:'solved',assigned_to:w.users.owner})
 assert.ok((await search('cobalt buckle replacement',{view:'open'})).some(row=>row.id===id),'all-history search finds the solved ticket from the live queue')
 assert.ok(!(await search('cobalt buckle replacement',{search_scope:'view',view:'open'})).some(row=>row.id===id))
 assert.ok((await search('cobalt buckle replacement',{search_scope:'view',status:'resolved',assigned_to:'myself'})).some(row=>row.id===id))
 assert.ok(!(await search('cobalt buckle replacement',{search_scope:'view',status:'resolved',assigned_to:'none'})).some(row=>row.id===id))
 assert.equal((await app.call(`${f.base}/conversations?q=cobalt`,{token:foreign.tokens.owner})).status,403)
 assert.equal((await app.call(`${f.base}/conversations?q=`+'x'.repeat(6000),{token:w.tokens.owner})).status,400)
 f.searchErasureQuery='cobalt buckle replacement'
}
