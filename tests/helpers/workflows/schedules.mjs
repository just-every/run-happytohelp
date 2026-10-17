import assert from 'node:assert/strict'
export async function schedulesFlow(f){
 const {app,w,ok,call,create,get,patch,clock,send,initial}=f
 const id=await create('Please follow up about the replacement'),due=initial+3600000
 const snooze=await ok('/workflow-schedules',{conversation_id:id,kind:'snooze',due_at:due,timezone:'America/New_York',owner_id:w.users.owner})
 assert.ok(!(await ok('/conversations')).some(t=>t.id===id));assert.ok((await ok('/conversations?snoozed=only')).some(t=>t.id===id))
 await send(id);assert.equal((await ok(`/conversations/${id}/workflows`)).schedules.find(s=>s.id===snooze.id).state,'woken');assert.ok((await ok('/conversations')).some(t=>t.id===id))
 const schedule=async(ticketId,body='Your replacement is on its way.')=>{const t=await get(ticketId);return ok('/workflow-schedules',{conversation_id:ticketId,kind:'reply',due_at:due,timezone:'America/New_York',body,owner_id:w.users.owner,expected_revision:t.revision,expected_last_message_id:t.last_message_id,expected_ticket_version:t.ticket_version})}
 const cancel=await schedule(id);await ok(`/workflow-schedules/${cancel.id}`,{body:'A revised shipment update',due_at:due+60000},'PATCH');await ok(`/workflow-schedules/${cancel.id}`,{action:'cancel'},'PATCH')
 assert.equal((await ok(`/conversations/${id}/workflows`)).schedules.find(s=>s.id===cancel.id).state,'cancelled')
 const customerReply=await schedule(id);await send(id,'The new address is different.');assert.equal((await ok(`/conversations/${id}/workflows`)).schedules.find(s=>s.id===customerReply.id).state,'cancelled')
 const reassigned=await schedule(id);await patch(id,{assigned_to:w.users.admin});assert.equal((await ok(`/conversations/${id}/workflows`)).schedules.find(s=>s.id===reassigned.id).state,'cancelled')
 const sent=await schedule(id);await clock(due);await app.scheduled()
 assert.equal((await ok(`/conversations/${id}/workflows`)).schedules.find(s=>s.id===sent.id).state,'sent')
 const messages=await app.sql("SELECT * FROM messages WHERE conversation_id=? AND local_id=?",id,`schedule:${sent.id}`);assert.equal(messages.length,1)
 await app.configure({H2H_WORKFLOW_NOW:String(due+60000)});await app.scheduled();assert.equal((await app.sql('SELECT * FROM messages WHERE local_id=?',`schedule:${sent.id}`)).length,1)
 await clock(initial)
 const uncertainId=await create('Waiting for a committed reply'),uncertain=await schedule(uncertainId)
 // The provider receives the request body but the connection resets. Only the
 // real network boundary is faked; the persisted send is never replayed.
 await app.configure({EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'workflow-provider-edge-key',EMAIL_FROM:'support@example.test'})
 await clock(due)
 await app.scheduled()
 const outcome=(await ok(`/conversations/${uncertainId}/workflows`)).schedules.find(s=>s.id===uncertain.id);assert.equal(outcome.state,'uncertain')
 await app.configure({H2H_WORKFLOW_NOW:String(due+180000)});await app.scheduled()
 assert.equal((await app.sql('SELECT * FROM messages WHERE local_id=?',`schedule:${uncertain.id}`)).length,1)
 assert.equal((await call(`/workflow-schedules/${uncertain.id}`,{body:'Do not replay'},'PATCH')).status,409)
 assert.equal(app.requests.filter(r=>new URL(r.url).hostname==='api.resend.com').length,1)
 await app.configure({EMAIL_PROVIDER:'development',EMAIL_API_KEY:undefined})
 // A dependency snooze wakes once the named ticket is solved.
 await clock(initial)
 const group=await ok('/ticket-groups',{name:'Aftercare',members:Object.values(w.users)});const groupReassigned=await schedule(id);await patch(id,{group_id:group.id});assert.equal((await ok(`/conversations/${id}/workflows`)).schedules.find(s=>s.id===groupReassigned.id).state,'cancelled','Moving the responsible team cancels the old queued reply')
 const dependency=await create('Warehouse confirmation'),dependent=await create('Waiting for warehouse')
 const sleep=await ok('/workflow-schedules',{conversation_id:dependent,kind:'snooze',dependency_id:dependency,timezone:'America/New_York',owner_id:w.users.owner})
 await patch(dependency,{status_id:'solved'});await app.scheduled();assert.equal((await ok(`/conversations/${dependent}/workflows`)).schedules.find(s=>s.id===sleep.id).state,'woken')
 // Closed follow-up carries private fields/CCs without exposing another contact's ticket.
 const closed=await get(f.closedId),reply=await send(closed.id,'The replacement arrived damaged too.')
 assert.ok(reply.followupConversationId);assert.equal((await get(closed.id)).status_category,'closed');assert.equal((await ok(`/conversations/${reply.followupConversationId}/workflows`)).followup_of,closed.id)
 assert.equal((await app.call(`/api/dashboard/projects/${f.other.projectId}/workflow-schedules`,{token:w.tokens.owner,body:{conversation_id:id,kind:'reply',due_at:due+999999,timezone:'UTC',body:'forbidden',owner_id:w.users.owner}})).status,403)
 assert.ok((await app.first("SELECT count(*) n FROM audit_events WHERE project_id=? AND action LIKE 'workflow.schedule.%'",w.projectId)).n>0)
 f.scheduleId=id
}
