import assert from 'node:assert/strict'

// Continue a queue macro's saved draft into human Send on the same ticket.
// Mixed bulk authority and saved-view composition are owned by ticketQueue.
export async function macroDraftLifecycle(f,macro,id){
 const {app,w,ok,call,get,visitor}=f
 const draft=await ok(`/conversations/${id}/macro-draft`)
 const upload=await app.ok(`/api/conversations/${id}/media`,{token:w.tokens.owner,raw:true,headers:{'Content-Type':'text/plain','X-Filename':'return-label.txt'},body:'Replacement label for order TO-48213'})
 const attached=await ok('/macros',{title:'Attach a replacement label',content:macro.content,actions:{reply_type:'public',attachments:[upload.id],followers:[w.users.owner,w.users.operator]}})
 const selection=async()=>[{id,expected_version:(await get(id)).ticket_version}]
 const applied=(await ok(`/macros/${attached.id}/apply`,{version:attached.version,tickets:await selection(),command_id:'attach-return-label'})).results[0]
 assert.equal(applied.status,'applied');assert.equal(applied.draft.media_ids.length,1)
 const edited=applied.draft.content+' The return label is attached.'
 const sent=await app.ok(`/api/conversations/${id}/messages`,{token:w.tokens.owner,body:{localId:'reviewed-macro-reply',content:edited,mediaIds:applied.draft.media_ids,expectedRevision:(await get(id)).revision}})
 assert.equal(sent.accepted,true)
 const transcript=await app.ok(`/api/conversations/${id}/messages`,{token:visitor.token})
 assert.equal(transcript.messages.at(-1).content,edited);assert.equal(transcript.messages.at(-1).media.length,1)
 assert.ok(!transcript.messages.at(-1).content.includes('{{'))
 const followers=await ok(`/conversations/${id}/followers`)
 assert.ok(followers.followers.some(member=>member.id===w.users.operator))

 const next=await ok(`/macros/${macro.id}`,{expected_version:macro.version,title:'Reviewed replacement label',content:'Hello {{requester.first_name | there}}, ticket {{ticket.id}}.',actions:{priority:'urgent'},scope:macro.scope},'owner','PUT')
 const versions=await ok(`/macros/${macro.id}/versions`)
 assert.ok(versions.some(version=>version.version===macro.version&&version.content===macro.content))
 assert.ok(versions.some(version=>version.version===next.version))
 assert.equal((await call(`/macros/${macro.id}`,{expected_version:macro.version,title:'Stale update'},'owner','PUT')).status,409)
 assert.equal((await ok(`/macros/${macro.id}/apply`,{version:macro.version,tickets:await selection(),command_id:'stale-macro'})).results[0].status,'stale')
 assert.ok((await ok('/macros?search=Reviewed')).some(row=>row.id===macro.id))

 // Missing customer names use the explicit fallback; missing fields remain
 // visibly unresolved and block a send until the operator edits the draft.
 const unnamed=await app.ok('/api/identity/widget/session',{body:{widgetKey:w.widgetKey},headers:{Origin:w.allowedOrigin}})
 const empty=await app.ok('/api/conversations',{token:unnamed.token,body:{projectId:w.projectId}})
 const absent=await ok('/macros',{title:'Fallback and required review',content:'Hello {{requester.first_name | there}}, {{ticket.custom.missing}}',scope:{visibility:'shared',roles:['owner'],groups:[],brands:[w.projectId]}})
 const select=[{id:empty.id,expected_version:(await get(empty.id)).ticket_version}]
 assert.equal((await call(`/macros/${absent.id}/apply`,{version:absent.version,tickets:select,command_id:'operator-denied'},'operator')).data.data.results[0].status,'forbidden')
 const result=(await ok(`/macros/${absent.id}/apply`,{version:absent.version,tickets:select,command_id:'fallback-label'})).results[0]
 assert.match(result.draft.content,/Hello there,/);assert.deepEqual(result.draft.unresolved,['ticket.custom.missing'])
 const blocked=await app.call(`/api/conversations/${empty.id}/messages`,{token:w.tokens.owner,body:{localId:'unresolved-macro',content:result.draft.content,expectedRevision:0}})
 assert.equal(blocked.status,422);assert.equal(blocked.data.code,'unresolved_placeholders')
 const note=await ok('/macros',{title:'Private review',content:'Private return review for {{ticket.id}}',actions:{reply_type:'note'}})
 const internal=(await ok(`/macros/${note.id}/apply`,{version:note.version,tickets:await selection(),command_id:'private-macro-review'})).results[0].draft
 await ok(`/conversations/${id}/notes`,{content:internal.content})
 assert.ok(!(await app.ok(`/api/conversations/${id}/messages`,{token:visitor.token})).messages.some(message=>message.content===internal.content))
 // A stale or foreign discard can never remove another operator's draft.
 assert.equal((await ok(`/conversations/${id}/macro-draft?usage_id=not-this-use`,undefined,'owner','DELETE')).discarded,false)
 assert.equal((await ok(`/conversations/${id}/macro-draft?usage_id=${result.usage_id}`,undefined,'operator','DELETE')).discarded,false)
 assert.ok(draft.content.includes('Dana'))
}
