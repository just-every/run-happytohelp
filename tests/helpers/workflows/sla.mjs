import assert from 'node:assert/strict'
export async function slaFlow(f){
 const {app,w,ok,call,create,get,patch,clock,send,initial}=f
 const calendar=await ok('/workflow-calendars',{name:'New York support',timezone:'America/New_York',weekly:[1,2,3,4,5].map(day=>({day,start:'09:00',end:'17:00'})),holidays:'us_federal',closures:[]})
 f.calendar=calendar
 const pacific=await ok('/workflow-calendars',{name:'Pacific weekend support',timezone:'America/Los_Angeles',weekly:[{day:0,start:'00:00',end:'04:00'}],holidays:'none',closures:[]})
 assert.equal((await call('/workflow-calendars',{name:'Bad timezone',timezone:'New_York',weekly:[{day:1,start:'09:00',end:'17:00'}]})).status,400)
 const policy=await ok('/sla-policies',{name:'Priority order support',calendar_id:calendar.id,position:1,conditions:{priorities:['normal'],plans:[],channels:['widget'],brands:[w.projectId]},first_response_minutes:120,next_response_minutes:60,resolution_minutes:480,pause_on_hold:true,approaching_minutes:30,unattended_minutes:180,backup_user_ids:[w.users.admin]})
 f.policy=policy
 const empty=await app.ok('/api/conversations',{token:w.tokens.owner,body:{projectId:w.projectId,contactId:f.customer.contactId}})
 const team=await ok('/ticket-groups',{name:'Replacement service commitments',members:[w.users.owner,w.users.operator,w.users.admin]})
 await patch(empty.id,{group_id:team.id})
 await clock(initial+30*60000);await app.scheduled()
 assert.deepEqual((await ok(`/conversations/${empty.id}/sla`)).clocks,[],'Opening an empty widget never starts a service commitment')
 assert.deepEqual((await ok(`/conversations/${empty.id}/sla`)).alerts,[])
 await clock(initial)
 const id=await create();f.slaId=id
 await patch(id,{group_id:team.id})
 // The original schema permits an empty condition object. A stored policy
 // using that default still matches, without requiring a settings rewrite.
 await app.db.prepare("UPDATE sla_policies SET conditions_json='{}' WHERE project_id=? AND id=?").bind(w.projectId,policy.id).run()
 assert.equal((await ok(`/conversations/${id}/sla`)).policy.id,policy.id,'legacy empty conditions retain match-any behavior')
 await ok(`/sla-policies/${policy.id}`,{conditions:policy.conditions},'PATCH')
 let sla=await ok(`/conversations/${id}/sla`)
 assert.equal(sla.clocks.find(c=>c.metric==='first_response').due_at,Date.parse('2026-11-27T15:00:00Z'),'Thanksgiving consumes no business time')
 const queue=await ok('/conversations?view=open');assert.equal(queue.find(ticket=>ticket.id===id).workflow_sla.due_at,Date.parse('2026-11-27T15:00:00Z'),'the inbox shows the hand-calculated holiday due time')
 await clock('2026-11-26T20:00:00Z');await app.scheduled()
 sla=await ok(`/conversations/${id}/sla`);assert.equal(sla.clocks.find(c=>c.metric==='first_response').breached,false)
 await clock('2026-11-27T14:45:00Z');await app.scheduled()
 sla=await ok(`/conversations/${id}/sla`)
 const approaching=sla.alerts.find(a=>a.kind==='approaching'&&a.metric==='first_response');assert.ok(approaching)
 const acknowledged=await ok(`/sla-alerts/${encodeURIComponent(approaching.id)}/ack`,{},'PATCH');assert.equal(acknowledged.state,'acknowledged')
 await app.configure({H2H_WORKFLOW_NOW:String(Date.parse('2026-11-27T15:01:00Z'))});await app.scheduled()
 sla=await ok(`/conversations/${id}/sla`);assert.ok(sla.alerts.some(a=>a.kind==='breach'&&a.metric==='first_response'));assert.equal(sla.alerts.find(a=>a.id===approaching.id).state,'acknowledged')
 const backup=sla.alerts.find(a=>a.kind==='breach'&&a.metric==='first_response'&&a.recipient_id===w.users.admin);assert.ok(backup,'a breach names the configured current backup')
 const report=await ok('/reports/team?period=custom&start=2026-01-01&end=2027-01-01&teamId='+team.id);assert.equal(report.sla.first_response.breached,1);assert.equal(report.sla.first_response.total,1);assert.equal(report.sla.resolution.pending,1);assert.equal(report.backlog.total,1,'the service team sees its live request, excluding its empty widget and the rest of the shared queue')
 const count=sla.alerts.length;await app.scheduled();assert.equal((await ok(`/conversations/${id}/sla`)).alerts.length,count)
 await clock('2026-11-27T17:01:00Z');await app.scheduled();await app.scheduled()
 sla=await ok(`/conversations/${id}/sla`)
 assert.ok(sla.alerts.some(a=>a.kind==='unattended'&&a.recipient_id===w.users.admin),'an unattended ticket escalates to its named backup too')
 const notices=async()=>(await app.ok(`/api/management/projects/${w.projectId}/notification-inbox`,{token:w.tokens.admin})).data.filter(n=>n.conversation_id===id).map(n=>n.id).sort()
 const delivered=await notices();assert.ok(delivered.length>0,'the backup can read its SLA notice in its own inbox')
 await app.configure({});await app.scheduled();assert.deepEqual(await notices(),delivered,'restart does not duplicate the backup inbox notice')
 await send(id,'We are arranging the replacement.',w.tokens.operator)
 await patch(id,{status_id:'pending'});await clock((await get(id)).updated_at);sla=await ok(`/conversations/${id}/sla`)
 const remaining=sla.clocks.find(c=>c.metric==='resolution'&&!c.completed_at).remaining_minutes
 await clock('2026-11-30T15:00:00Z');await app.scheduled();sla=await ok(`/conversations/${id}/sla`)
 assert.equal((await ok('/conversations?view=open')).find(ticket=>ticket.id===id).workflow_sla.pause_reason,'pending','the queue explains the paused commitment')
 assert.equal(sla.pause_reason,'pending');assert.equal(sla.clocks.find(c=>c.metric==='resolution'&&!c.completed_at).remaining_minutes,remaining)
 await send(id);sla=await ok(`/conversations/${id}/sla`);assert.equal(sla.pause_reason,null);assert.ok(sla.clocks.some(c=>c.metric==='next_response'&&!c.completed_at))
 await patch(id,{status_id:'on_hold'});await clock('2026-11-30T17:00:00Z');assert.equal((await ok(`/conversations/${id}/sla`)).pause_reason,'on_hold')
 // The opposite On-hold policy must keep spending business time too; merely
 // testing the paused choice would not prove the lead's configurable choice.
 const held=(await ok(`/conversations/${id}/sla`)).clocks.find(c=>c.metric==='resolution'&&!c.completed_at)
 await ok(`/sla-policies/${policy.id}`,{pause_on_hold:false},'PATCH')
 const running=await ok(`/conversations/${id}/sla`)
 assert.equal(running.pause_reason,null)
 assert.ok(running.clocks.find(c=>c.metric==='resolution'&&!c.completed_at).remaining_minutes<held.remaining_minutes,'On-hold consumes business minutes when the policy does not pause')
 await ok(`/sla-policies/${policy.id}`,{pause_on_hold:true},'PATCH')
 // Solving ends the old clocks. A real customer reply creates a new next
 // response cycle with one business hour from Monday 12:30 New York time.
 const previousCycle=Math.max(...(await ok(`/conversations/${id}/sla`)).clocks.filter(c=>c.metric==='next_response').map(c=>c.cycle))
 await patch(id,{status_id:'solved'})
 await clock('2026-11-30T17:30:00Z');await send(id,'The replacement also needs attention.')
 const reopened=await ok(`/conversations/${id}/sla`),next=reopened.clocks.find(c=>c.metric==='next_response'&&!c.completed_at)
 assert.equal((await get(id)).status_category,'open');assert.equal(next.cycle,previousCycle+1)
 assert.equal(next.due_at,Date.parse('2026-11-30T18:30:00Z'),'reopen starts the next-response clock at the new request')
 await app.configure({});assert.equal((await ok(`/conversations/${id}/sla`)).clocks.find(c=>c.metric==='next_response'&&!c.completed_at).due_at,next.due_at)
 // A separate policy and Sunday window exercise both copies of the fall-back hour.
 await ok(`/sla-policies/${policy.id}`,{active:false},'PATCH')
 const weekendPolicy=await ok('/sla-policies',{name:'Weekend response',calendar_id:pacific.id,position:0,conditions:{},first_response_minutes:180,next_response_minutes:null,resolution_minutes:null,pause_on_hold:false,approaching_minutes:15,backup_user_ids:[]})
 await clock('2026-11-01T07:00:00Z');const dst=await create('Sunday support request')
 assert.equal((await ok(`/conversations/${dst}/sla`)).clocks[0].due_at,Date.parse('2026-11-01T10:00:00Z'),'three real business hours include the repeated fall-back hour')
 await ok(`/sla-policies/${weekendPolicy.id}`,{active:false},'PATCH')
 await clock(initial)
 assert.equal((await call(`/sla-policies/${policy.id}`,{active:true},'PATCH','operator')).status,403)
 // SLA policy selection is scoped by plan, priority, channel and brand.
 await ok(`/sla-policies/${policy.id}`,{active:true,conditions:{plans:['enterprise'],priorities:['urgent'],channels:['email'],brands:[w.projectId]}},'PATCH')
 await patch(id,{priority:'urgent',channel:'email'});await app.db.prepare("UPDATE contacts SET metadata_json=json_set(metadata_json,'$.plan','enterprise') WHERE id=?").bind(f.customer.contactId).run()
 assert.equal((await ok(`/conversations/${id}/sla`)).policy.id,policy.id)
}
