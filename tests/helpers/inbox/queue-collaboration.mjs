import assert from 'node:assert/strict'

// Complete QUEUE-003 in the existing desk journey through its authenticated
// HTTP and socket doors. No collaboration state is inserted or read with SQL.
export async function queueCollaboration(f,{owner,customer}){
 const {app,w,foreign,id,ok,call,visitor}=f
 const inbox=async(role='operator')=>(await app.ok(`/api/management/projects/${w.projectId}/notification-inbox`,{token:w.tokens[role]})).data
 const transcript=()=>app.ok(`/api/conversations/${id}/messages`,{token:visitor.token})
 const before=await transcript(),customerFrames=customer.frames.length
 await ok(`/conversations/${id}/followers`,{user_ids:[]},'owner','PUT')
 const beforeFollowers=(await inbox()).filter(row=>row.kind==='follower'&&row.conversation_id===id).length
 const follower=await ok(`/conversations/${id}/followers`,{user_ids:[w.users.operator]},'owner','PUT')
 assert.deepEqual(follower.followers.map(row=>row.id),[w.users.operator])
 assert.equal((await ok(`/conversations/${id}/collaboration`,undefined,'operator')).following,true)
 assert.equal((await inbox()).filter(row=>row.conversation_id===id&&row.kind==='follower').length,beforeFollowers+1,'the added follower receives their own notification')
 assert.equal((await app.call(`/api/management/projects/${w.projectId}/notification-inbox`,{token:visitor.token})).status,403)
 assert.equal((await app.call(f.base+`/conversations/${id}/collaboration`,{token:visitor.token})).status,403)

 const beforeMentions=(await inbox()).filter(row=>row.kind==='mention').length
 const note=await ok(`/conversations/${id}/notes`,{content:`Private @[Operator](user:${w.users.operator}) review`,mention_ids:[w.users.operator]})
 assert.ok((await ok(`/conversations/${id}/buckets`,undefined,'operator')).flatMap(bucket=>bucket.events).some(row=>row.id===note.id&&row.content===note.content),'the teammate reloads the private note')
 assert.equal((await inbox()).filter(row=>row.kind==='mention'&&row.conversation_id===id).length,beforeMentions+1)
 assert.ok(!(await inbox('admin')).some(row=>row.conversation_id===id&&row.kind==='mention'),'unmentioned teammates receive no mention')
 const denied=await call(`/conversations/${id}/notes`,{content:`Foreign @[Owner](user:${foreign.users.owner}) secret`,mention_ids:[foreign.users.owner]})
 assert.equal(denied.status,403)
 const foreignInbox=(await app.ok(`/api/management/projects/${foreign.projectId}/notification-inbox`,{token:foreign.tokens.owner})).data
 assert.ok(!foreignInbox.some(row=>row.conversation_id===id),'a foreign mention creates no notification')
 assert.equal((await call(`/conversations/${id}/followers`,{user_ids:[foreign.users.owner]},'owner','PUT')).status,403)
 assert.deepEqual((await ok(`/conversations/${id}/collaboration`)).followers.map(row=>row.id),[w.users.operator],'refused foreign follower leaves the saved audience intact')

 const followerNotices=(await inbox()).filter(row=>row.kind==='follower'&&row.conversation_id===id).length
 await ok(`/conversations/${id}/notes`,{content:'Private follower-only update'})
 assert.equal((await inbox()).filter(row=>row.kind==='follower'&&row.conversation_id===id).length,followerNotices+1,'a subsequent ticket update reaches the follower without a mention')

 const views=[]
 for(const visibility of ['personal','shared']){
  const role=visibility==='personal'?'operator':'owner'
  const input={name:`Collaboration ${visibility}`,visibility,filters:[],sort:[]}
  const view=await ok('/ticket-views',input,role);views.push(view)
  assert.equal((await ok(`/ticket-views/${view.id}`,undefined,role)).name,input.name,'a fresh route read reloads the saved view')
 }
 assert.equal((await call(`/ticket-views/${views[0].id}`,undefined,'owner')).status,404)
 assert.ok(!(await ok('/ticket-views',undefined,'owner')).some(view=>view.id===views[0].id))
 assert.equal((await ok(`/ticket-views/${views[1].id}`,undefined,'operator')).visibility,'shared')
 assert.equal((await call(`/ticket-views/${views[1].id}`,{name:'Unauthorized edit',visibility:'shared',filters:[],sort:[],expected_version:views[1].version},'operator','PUT')).status,403)

 for(const visibility of ['personal','shared']){
  const role=visibility==='personal'?'operator':'owner'
  const reply=await ok('/macros',{title:`Collaboration ${visibility} reply`,content:`Saved ${visibility} replacement reply`,scope:{visibility}},role)
  const reloaded=await ok(`/macros/${reply.id}`,undefined,role)
  assert.equal(reloaded.content,reply.content);assert.equal(reloaded.scope.visibility,visibility)
  if(visibility==='personal')assert.equal((await call(`/macros/${reply.id}`,undefined,'owner')).status,404)
  else{
   assert.equal((await ok(`/macros/${reply.id}`,undefined,'operator')).content,reply.content)
   assert.equal((await call(`/macros/${reply.id}`,{content:'Unauthorized edit',expected_version:reply.version},'operator','PUT')).status,403)
  }
 }
 // Await an operator activity as a delivery barrier before checking the customer
 // stream: follower identities, private notes and drafts never enter that stream.
 await app.until(()=>owner.frames.some(frame=>frame.type==='activity'&&frame.kind==='note'))
 customer.ws.send(JSON.stringify({type:'ping'}))
 await app.until(()=>customer.frames.some(frame=>frame.type==='pong'))
 assert.deepEqual(await transcript(),before,'private collaboration never changes the visitor transcript')
 assert.ok(!customer.frames.slice(customerFrames).some(frame=>frame.type==='activity'||frame.type==='presence'),'the customer receives no follower or note update')
 assert.ok(!JSON.stringify(customer.frames).includes('Private draft content'))
 assert.ok(!JSON.stringify(await transcript()).includes(note.content))
}
