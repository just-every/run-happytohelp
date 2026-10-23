import assert from 'node:assert/strict'

export async function ticketLifecycle(f){
 const {app,w,id,ok,call,get,patch,visitor}=f
 const definitions=[
  {name:'Order number',type:'text',value:'TO-48213'},
  {name:'Pairs',type:'number',value:2,validation:{min:1,max:100}},
  {name:'Refund amount',type:'decimal',value:129.95,validation:{min:0}},
  {name:'Needed by',type:'date',value:'2026-10-24'},
  {name:'Reason',type:'dropdown',options:['Damaged','Wrong size'],value:'Damaged'},
  {name:'Products',type:'multiselect',options:['Boots','Packs','Tents'],value:['Boots','Packs']},
  {name:'Expedite',type:'checkbox',value:true},
  {name:'Tracking reference',type:'regex',validation:{pattern:'^[A-Z]{2}-[0-9]{5}$'},value:'TO-48213'},
 ]
 f.fields=[]
 for(const {value,...definition} of definitions){const field=await ok('/ticket-fields',definition);f.fields.push({...field,value})}
 f.privateField=await ok('/ticket-fields',{name:'Private return address',type:'text',read_roles:['owner'],write_roles:['owner']})
 f.group=await ok('/ticket-groups',{name:'Returns',members:[w.users.owner,w.users.operator]})
 const invalidGroup=await call('/ticket-groups',{name:'Foreign group',members:[f.foreign.users.owner]});assert.equal(invalidGroup.status,400)
 assert.equal((await call('/ticket-fields',{name:'Unauthorized',type:'text'},'operator')).status,403)
 const custom=await ok('/ticket-statuses',{name:'Waiting for shipping label',category:'pending'})
 let ticket=await patch(id,{subject:'Replacement boots for Dana',priority:'urgent',channel:'email',group_id:f.group.id,agent_id:w.users.operator,fields:{...Object.fromEntries(f.fields.map(x=>[x.id,x.value])),[f.privateField.id]:'Dana private return address'}})
 assert.equal(ticket.brand_id,w.projectId);assert.equal(ticket.requester_id,visitor.contactId);assert.equal(ticket.submitter_id,visitor.contactId)
 assert.deepEqual(ticket.fields,Object.fromEntries([...f.fields.map(x=>[x.id,x.value]),[f.privateField.id,'Dana private return address']]))
 for(const [field,bad] of f.fields.map((field,index)=>[field,[42,1.5,'129.95','2026-02-30','Unknown',['Boots','Boots'],'true','no pattern'][index]])){
  assert.equal((await call(`/conversations/${id}/ticket`,{fields:{[field.id]:bad}},'owner','PATCH')).status,400,field.type)
 }
 const operator=(await call(`/conversations/${id}/ticket`,undefined,'operator')).data.data
 assert.equal(operator.fields[f.privateField.id],undefined);assert.ok(!JSON.stringify(operator.history).includes('Dana private return address'))
 assert.equal((await call(`/conversations/${id}/ticket`,{fields:{[f.privateField.id]:'forbidden'}},'operator','PATCH')).status,403)
 for(const status of ['open',custom.id,'on_hold','solved']){
  await patch(id,{status_id:status})
  const internal=await get(id),visible=await app.ok(`/api/conversations/${id}`,{token:visitor.token})
  assert.equal(internal.status_id,status);assert.equal(visible.status_id,status==='solved'?'solved':'open')
  assert.ok(!JSON.stringify(visible).includes('Waiting for shipping label'))
  const response=await app.ok(`/api/conversations/${id}/messages`,{token:visitor.token,body:{localId:`reply-${status}`,content:'Thanks, please proceed with the replacement.',expectedRevision:internal.revision}})
  assert.equal(response.accepted,true)
  assert.equal((await get(id)).status_category,'open')
 }
 ticket=await patch(id,{status_id:'solved'})
 assert.ok(ticket.resolved_at);assert.ok(ticket.history.some(h=>h.actor_id===visitor.contactId&&h.source==='customer_reply'))
 const cycles=await app.sql('SELECT * FROM conversation_resolutions WHERE conversation_id=? ORDER BY ordinal',id)
 assert.equal(cycles.length,2);assert.ok(cycles[0].reopened_at);assert.equal(cycles[1].reopened_at,null)
 await patch(id,{status_id:'closed'})
 assert.equal((await call(`/conversations/${id}/ticket`,{status_id:'open'},'owner','PATCH')).status,409)
 const followup=await app.ok(`/api/conversations/${id}/messages`,{token:visitor.token,body:{localId:'closed-reply',content:'A final question',expectedRevision:(await get(id)).revision}})
 assert.equal(followup.accepted,true);assert.notEqual(followup.followupConversationId,id)
 const carried=await get(followup.followupConversationId)
 assert.equal(carried.priority,ticket.priority);assert.equal(carried.requester_id,visitor.contactId)
 assert.deepEqual(carried.fields,ticket.fields)
 assert.equal((await ok(`/conversations/${carried.id}/workflows`)).followup_of,id)
 await patch(carried.id,{status_id:'closed'})
 assert.equal((await get(id)).status_category,'closed')
 // A required field is required to solve, alike on every door; tags, assignment and other edits never wait on it.
 const required=await ok('/ticket-fields',{name:'Return reason code',type:'text',required:true}),unsolved=await f.create(90)
 const tag=await ok(`/conversations/${unsolved}/tags`,{name:'Awaiting reason'})
 await ok(`/conversations/${unsolved}/tags/${tag.id}`,undefined,'owner','DELETE')
 await ok(`/conversations/${unsolved}`,{agent_id:w.users.operator},'owner','PUT')
 await patch(unsolved,{priority:'high',status_id:'pending'})
 const api=await app.ok(`/api/management/projects/${w.projectId}/connections/tokens`,{token:w.tokens.owner,body:{name:'Lifecycle',scopes:['conversations:read','conversations:write']}})
 const doors={
  ticket:()=>call(`/conversations/${unsolved}/ticket`,{status_id:'solved'},'owner','PATCH'),
  close:()=>call(`/conversations/${unsolved}/ticket`,{status_id:'closed'},'owner','PATCH'),
  legacy:()=>call(`/conversations/${unsolved}`,{resolved:true},'owner','PUT'),
  api:()=>app.call('/api/v1/conversations/'+unsolved,{method:'PATCH',token:api.token,body:{status_id:'solved'}}),
  apiResolve:()=>app.call(`/api/v1/conversations/${unsolved}/resolve`,{token:api.token,body:{}}),
  reply:async()=>app.call(`/api/conversations/${unsolved}/messages`,{token:w.tokens.owner,body:{localId:'solve-without-reason',content:'Your replacement is on its way.',expectedRevision:(await get(unsolved)).revision,resolve:true}}),
  bulk:async()=>{const result=await ok('/tickets/bulk/apply',{tickets:[{id:unsolved,expected_version:(await get(unsolved)).ticket_version}],changes:{status_id:'solved'}});return {status:result.results[0].status==='invalid'?400:200,data:result.results[0]}},
 }
 for(const [door,attempt] of Object.entries(doors)){const refused=await attempt();assert.equal(refused.status,400,door);assert.match(JSON.stringify(refused.data),/Return reason code: Required to solve/,door)}
 assert.equal((await get(unsolved)).status_category,'pending')
 assert.equal((await call(`/conversations/${unsolved}/ticket`,{fields:{[required.id]:''}},'owner','PATCH')).status,400)
 await patch(unsolved,{fields:{[required.id]:'DAMAGED-SEAM'}})
 const solved=await app.ok(`/api/conversations/${unsolved}/messages`,{token:w.tokens.owner,body:{localId:'solve-with-reason',content:'Your replacement is on its way.',expectedRevision:(await get(unsolved)).revision,resolve:true}})
 assert.equal(solved.accepted,true);assert.equal((await get(unsolved)).status_category,'solved')
 assert.equal((await call(`/ticket-fields/${required.id}`,undefined,'owner','DELETE')).status,400,'a used definition cannot delete the solved ticket value')
 await ok(`/ticket-fields/${required.id}`,{required:false},'owner','PATCH')
 assert.equal((await get(unsolved)).fields[required.id],'DAMAGED-SEAM','making the field optional preserves its historical value')
 f.retainedField=required
 const log=await app.sql("SELECT * FROM audit_events WHERE project_id=? AND action='ticket.updated'",w.projectId)
 assert.ok(log.length>0)
}
