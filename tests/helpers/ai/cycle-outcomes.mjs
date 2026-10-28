import assert from 'node:assert/strict'

// Continue the native answering journey: a later cycle must never relabel the first answer.
export async function cycleOutcomes(a,v,firstRun){
 const {app,p,owner,ai}=a,id=v.conversationId
 const path=`/api/ai-support/projects/${p}/conversations/${id}/trace`
 const read=async()=>(await app.call(path,{token:owner,status:200})).data.generations
 const run=async generationId=>(await read()).find(row=>row.id===generationId)
 const solve=async()=>{await app.call(`/api/dashboard/projects/${p}/conversations/${id}`,{token:owner,method:'PUT',body:{resolved:true},status:200});return (await v.transcript()).resolution}
 const rate=(resolutionId,value)=>app.call(`/api/conversations/${id}/widget-events`,{token:v.token,body:{action:'rateResolution',data:{resolutionId,value,comment:'Private cycle feedback'}},status:200})
 assert.equal((await run(firstRun.id)).customerOutcome.cycle,null)
 assert.match((await run(firstRun.id)).customerOutcome.reason,/No recorded resolution/)
 const first=await solve();await rate(first.id,-1)
 const negative=(await run(firstRun.id)).customerOutcome.cycle
 assert.equal(negative.id,first.id);assert.equal(negative.attribution,'ai');assert.equal(negative.reopenedAt,null)
 assert.deepEqual(negative.rating,{scale:'thumbs',value:-1,revision:1})
 // Correction is a new revision of this cycle, not new provenance or a changed join.
 await rate(first.id,1);assert.deepEqual((await run(firstRun.id)).customerOutcome.cycle.rating,{scale:'thumbs',value:1,revision:2})
 await rate(first.id,-1)
 assert.equal((await app.first('SELECT COUNT(*) n FROM csat_response_history WHERE resolution_id=?',first.id)).n,3)
 ai.respond=()=>'Here is the corrected refund answer.'
 await v.say('That did not work. Please check again.');await a.run()
 const all=await read(),secondRun=all.find(row=>row.id!==firstRun.id&&row.committedAnswer)
 assert.ok(secondRun);assert.equal(secondRun.customerOutcome.cycle,null)
 const reopened=(await run(firstRun.id)).customerOutcome.cycle
 assert.ok(reopened.reopenedAt);assert.equal(reopened.rating.value,-1);assert.equal(reopened.rating.revision,3)
 await v.say('Can you also clarify the timing?');await a.run()
 const sharedRun=(await read()).find(row=>row.id!==firstRun.id&&row.id!==secondRun.id&&row.committedAnswer)
 assert.ok(sharedRun)
 // A human contribution shares the second cycle without assigning it to another generation.
 const current=await v.transcript()
 await app.call(`/api/conversations/${id}/messages`,{token:owner,body:{localId:crypto.randomUUID(),content:'I checked this with our team.',authoring:{kind:'human'},expectedRevision:current.revision,expectedLastMessageId:current.lastMessageId},status:200})
 await app.call(`/api/outcomes/projects/${p}/settings`,{token:owner,method:'PUT',body:{enabled:false,widgetEnabled:true,scale:'five',delayMinutes:0,expiresDays:14,locale:'en'},status:200})
 const second=await solve();assert.notEqual(second.id,first.id);await rate(second.id,5)
 assert.equal((await run(firstRun.id)).customerOutcome.cycle.id,first.id)
 assert.equal((await run(firstRun.id)).customerOutcome.cycle.rating.value,-1)
 const next=(await run(secondRun.id)).customerOutcome.cycle
 assert.equal(next.id,second.id);assert.deepEqual(next.rating,{scale:'five',value:5,revision:1});assert.equal(next.attribution,'human')
 assert.deepEqual((await run(sharedRun.id)).customerOutcome.cycle,next)
 const outsider=await app.seedWorkspace('cycle-outsider')
 for(const [token,status] of [[v.token,403],[outsider.tokens.owner,403],[undefined,401]]){
  const denied=await app.call(path,{token,status});assert.doesNotMatch(JSON.stringify(denied.data),/customerOutcome|rating|resolution_id/)
 }
 await app.db.prepare('DELETE FROM memberships WHERE user_id=? AND project_id=?').bind(a.workspace.users.operator,p).run()
 const revoked=await app.call(path,{token:a.workspace.tokens.operator,status:401});assert.doesNotMatch(JSON.stringify(revoked.data),/customerOutcome|rating/)
 const serial=JSON.stringify(await read());assert.doesNotMatch(serial,/Private cycle feedback|corrected refund answer|checked this/)
 // Ambiguous retained boundaries are never resolved by picking the latest cycle.
 await app.db.prepare("INSERT INTO conversation_resolutions SELECT 'ambiguous-cycle',project_id,conversation_id,contact_id,99,resolved_at,resolved_revision,cycle_start_revision,outcome,evidence_json,reopened_at FROM conversation_resolutions WHERE id=?").bind(first.id).run()
 assert.equal((await run(firstRun.id)).customerOutcome.cycle,null)
 assert.match((await run(firstRun.id)).customerOutcome.reason,/unambiguous/)
 await app.db.prepare("DELETE FROM conversation_resolutions WHERE id='ambiguous-cycle'").run()
 // Removing retained provenance cannot be repaired by matching local ids or message text.
 await app.db.prepare('DELETE FROM message_authorship WHERE message_id=?').bind(secondRun.committedAnswer.id).run()
 assert.equal((await run(secondRun.id)).customerOutcome.cycle,null)
 assert.match((await run(secondRun.id)).customerOutcome.reason,/No retained committed authorship/)
 await app.call(`/api/management/projects/${p}/contacts/${v.contactId}/erase`,{token:owner,body:{},status:200})
 assert.equal((await run(firstRun.id)).customerOutcome.cycle,null)
 assert.match((await run(firstRun.id)).customerOutcome.reason,/erased/)
 assert.ok((await read()).every(row=>row.customerOutcome.cycle===null))
}
