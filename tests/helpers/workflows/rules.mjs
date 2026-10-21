import assert from 'node:assert/strict'
export async function rulesFlow(f){
 const {app,w,ok,call,create,get,patch,clock,publish,initial}=f
 const tag=await ok(`/conversations/${f.slaId}/tags`,{name:'Refund review'})
 const definition={name:'Refund review and escalation',kind:'event',position:5,event_kind:'customer_reply',conditions:{all:[{field:'subject',op:'contains',value:'refund'}]},actions:[{type:'tags',add:[tag.id]},{type:'priority',priority:'high'},{type:'notify',kind:'assignee',recipient_id:w.users.owner}]}
 const {rule}=await ok('/workflow-rules',definition)
 // Fixtures are storage history, then all preview effects go through the public sandbox.
 const now=initial-3600000
 await app.db.batch(Array.from({length:205},(_,i)=>app.db.prepare("INSERT INTO conversations(id,project_id,contact_id,created_at,updated_at,subject) VALUES(?,?,?,?,?,?)").bind(`historical-refund-${i}`,w.projectId,f.customer.contactId,now-i,now-i,`Refund on order TO-${49000+i}`)))
 await app.db.batch(Array.from({length:205},(_,i)=>[
  app.db.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at) VALUES(?,?,?,?,?,'contact',?,1,?)").bind(`historical-message-${i}`,w.projectId,`historical-refund-${i}`,`history-${i}`,f.customer.contactId,`Please refund order TO-${49000+i}.`,now-i+1),
  app.db.prepare("UPDATE conversations SET revision=1,last_message_id=?,status_id='open',status_category='open',updated_at=? WHERE id=?").bind(`historical-message-${i}`,now-i+1,`historical-refund-${i}`)
 ]).flat())
 const before=await app.first('SELECT count(*) n FROM workflow_action_receipts'),notifications=await app.first('SELECT count(*) n FROM workflow_notifications'),requests=app.requests.length
 const preview=await ok(`/workflow-rules/${rule.id}/preview`,{})
 assert.ok(new Set(preview.results.map(r=>r.conversation_id)).size>=200);assert.ok(preview.matched>=200);assert.equal(preview.side_effects,false)
 assert.deepEqual(await app.first('SELECT count(*) n FROM workflow_action_receipts'),before);assert.deepEqual(await app.first('SELECT count(*) n FROM workflow_notifications'),notifications);assert.equal(app.requests.length,requests)
 await app.db.prepare("UPDATE conversations SET status_id='closed',status_category='closed',resolved_at=?,updated_at=? WHERE id LIKE 'historical-refund-%' AND project_id=?").bind(now,now,w.projectId).run()
 await ok(`/workflow-rules/${rule.id}/publish`,{})
 const id=await create('Please refund my order TO-50000.');assert.equal((await get(id)).priority,'high');assert.ok((await get(id)).tags.some(t=>t.id===tag.id))
 const receipts=await app.first('SELECT count(*) n FROM workflow_action_receipts WHERE conversation_id=?',id);await app.scheduled();assert.deepEqual(await app.first('SELECT count(*) n FROM workflow_action_receipts WHERE conversation_id=?',id),receipts)
 const original=(await ok('/workflow-rules')).rules.find(r=>r.id===rule.id)
 await ok(`/workflow-rules/${rule.id}`,{actions:[{type:'priority',priority:'urgent'}]},'PATCH');assert.deepEqual((await ok('/workflow-rules')).rules.find(r=>r.id===rule.id).published,original.published)
 await ok(`/workflow-rules/${rule.id}/pause`,{});assert.equal((await get(await create('Refund another order'))).priority,'normal')
 await ok(`/workflow-rules/${rule.id}/cancel`,{});assert.equal((await call(`/workflow-rules/${rule.id}/publish`,{})).status,409)
 assert.equal((await call('/workflow-rules',{name:'Unsafe repeat',kind:'time',conditions:{all:[{field:'status_category',op:'eq',value:'pending'}]},time:{field:'pending_at',hours:48,repeat_hours:48},actions:[{type:'notify',kind:'customer_update'}]})).status,400)
 await timeAutomationFlow(f)
 // Publishing and cron execution share the same set-based reference limits.
 for(const [label,tagCount,fieldCount] of [['eight',8,0],['large',100,50]]){
  const id=await create(`Queued reference ${label}`),tagIds=Array.from({length:tagCount},(_,i)=>`cron-${label}-${i}`),values={}
  await app.db.batch(tagIds.map(tag=>app.db.prepare('INSERT INTO workspace_tags(id,project_id,name,normalized_name) VALUES(?,?,?,?)').bind(tag,w.projectId,tag,tag)))
  for(let i=0;i<fieldCount;i++){const field=await ok('/ticket-fields',{name:`Cron field ${i}`,type:'text'});values[field.id]=`Order detail ${i}`}
  const queued=await publish({name:`Queued reference ${label}`,kind:'event',event_kind:'customer_reply',position:2,conditions:{all:[{field:'subject',op:'eq',value:`Queued reference ${label}`}]},actions:[{type:'tags',add:tagIds},...(fieldCount?[{type:'fields',values},{type:'note',content:'Queued order details applied'}]:[])]})
  const ticket=await get(id),message=`queued-${label}`
  await app.db.batch([
   app.db.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at) VALUES(?,?,?,?,?,'contact','Here are my order details',?,?)").bind(message,w.projectId,id,message,f.customer.contactId,ticket.revision+1,initial+1),
   app.db.prepare("UPDATE conversations SET revision=revision+1,last_message_id=?,updated_at=?,ticket_source='customer_reply' WHERE id=?").bind(message,initial+1,id)
  ])
  await clock(initial+60000);await app.scheduled();await app.scheduled()
  const runs=(await ok(`/workflow-runs?conversation_id=${id}`)).runs.filter(run=>run.rule_id===queued.id)
  assert.equal(runs.length,1);assert.equal(runs[0].state,'complete',runs[0].reason);assert.equal(runs[0].cursor,fieldCount?3:1)
  const applied=await get(id);if(fieldCount)assert.equal((await app.first("SELECT count(*) n FROM conversation_notes WHERE conversation_id=? AND content LIKE '%Queued order details applied%'",id)).n,1);assert.deepEqual(applied.tags.map(t=>t.id).sort(),tagIds.sort());for(const [field,value] of Object.entries(values))assert.equal(applied.fields[field],value)
  await app.scheduled();assert.equal((await ok(`/workflow-runs?conversation_id=${id}`)).runs.filter(run=>run.rule_id===queued.id).length,1)
  await ok(`/workflow-rules/${queued.id}/pause`,{});await clock(initial)
 }
 await clock(initial)
}

// The same hourly scheduler that production calls owns all effects. Only the
// existing runtime clock and storage-interruption edge are controlled here.
export async function timeAutomationFlow(f){
 const {app,w,ok,call,create,get,patch,clock,send,initial}=f
 await app.ok(`/api/management/projects/${w.projectId}/settings`,{token:w.tokens.owner,method:'PUT',body:{timezone:'America/New_York'}})
 const calendar=await ok('/workflow-calendars',{name:'Workspace weekday support',timezone:'America/New_York',weekly:[1,2,3,4,5].map(day=>({day,start:'09:00',end:'17:00'})),holidays:'none',closures:[]})
 const start=Date.parse('2026-10-23T20:00:00Z'),nudgeAt=Date.parse('2026-11-02T21:00:00Z'),solveAt=Date.parse('2026-11-10T21:00:00Z'),closeAt=solveAt+4*86400000
 await clock(start-60000)
 const pending=await create('Return label for Ridgeline boots'),reset=await create('Customer answered about the carrier')
 await clock(start);await patch(pending,{status_id:'pending'});await patch(reset,{status_id:'pending'})
 const templates=(await ok('/workflow-rules')).templates,rules=[]
 for(const template of templates){
  const definition={...template,...(template.time.field==='pending_at'?{time:{...template.time,calendar_id:calendar.id}}:{})}
  if(template.name==='Pending 48h nudge')definition.actions=[{type:'priority',priority:'high'},{type:'note',content:'Pending return label follow-up'},...template.actions]
  const {rule}=await ok('/workflow-rules',definition),before=await get(pending),requests=app.requests.length
  const preview=await ok(`/workflow-rules/${rule.id}/preview`,{})
  assert.equal(preview.side_effects,false);assert.deepEqual(await get(pending),before);assert.equal(app.requests.length,requests)
  rules.push((await ok(`/workflow-rules/${rule.id}/publish`,{})).rule)
 }
 const [nudge,solve,close]=rules,runs=async id=>(await ok(`/workflow-runs?conversation_id=${id}`)).runs.filter(run=>rules.some(rule=>rule.id===run.rule_id))
 // Creation and publication both reject an unsafe repeat. A stored invalid draft
 // represents a previously authored rule, not an alternate application path.
 const unsafe={name:'Unsafe repeated pending notice',kind:'time',position:0,conditions:{all:[{field:'status_category',op:'eq',value:'pending'}],any:[]},time:{field:'pending_at',hours:48,repeat_hours:48},actions:[{type:'notify',kind:'customer_update'}]}
 assert.equal((await call('/workflow-rules',unsafe)).status,400)
 const {rule:draft}=await ok('/workflow-rules',{...unsafe,time:{field:'pending_at',hours:48}})
 await app.db.prepare('UPDATE workflow_rules SET draft_json=? WHERE id=?').bind(JSON.stringify(unsafe),draft.id).run()
 assert.equal((await call(`/workflow-rules/${draft.id}/publish`,{})).status,400)
 for(const at of ['2026-10-24T20:00:00Z','2026-10-26T13:00:00Z','2026-11-01T05:00:00Z','2026-11-01T06:00:00Z','2026-11-02T20:00:00Z']){
  await clock(at);await app.scheduled();assert.deepEqual(await runs(pending),[],'no nudge before 48 workspace business hours, through weekend and DST fold')
 }
 await send(reset,'The return label arrived.');assert.equal((await get(reset)).status_category,'open')
 await clock(nudgeAt)
 // Stop after the first action and its durable cursor commit, before the note or
 // notification. Dispose/recreate the Worker, losing all in-memory wakeups.
 const stopped=await app.call('/_test/scheduled',{body:{after:0},headers:{'x-test-fault':'db-interrupt','x-test-statement':'UPDATE workflow_runs SET cursor=max'}})
 assert.equal(stopped.status,500,'the interrupted invocation cannot finish its remaining consumers')
 const interrupted=(await runs(pending)).find(run=>run.rule_id===nudge.id)
 assert.ok(interrupted);assert.equal(interrupted.cursor,1);assert.equal(interrupted.state,'running');assert.equal((await get(pending)).priority,'high')
 await app.configure({});assert.deepEqual(await app.takeJobs(),[])
 await clock(nudgeAt+3600000);await app.scheduled()
 let completed=(await runs(pending)).filter(run=>run.rule_id===nudge.id)
 assert.equal(completed.length,1);assert.equal(completed[0].state,'not_delivered');assert.ok(completed[0].reason);assert.equal(completed[0].cursor,2)
 const nudgeHistory=(await get(pending)).history.filter(h=>h.actor_id===`automation ${nudge.name}`)
 assert.equal(nudgeHistory.filter(h=>h.changes.priority).length,1);assert.equal(nudgeHistory.filter(h=>h.changes.notes).length,1)
 assert.ok(nudgeHistory.every(h=>h.source==='automation'))
 await app.scheduled();assert.equal((await runs(pending)).filter(run=>run.rule_id===nudge.id).length,1)
 await clock(solveAt-3600000);await app.scheduled();assert.equal((await get(pending)).status_category,'pending')
 await clock(solveAt);await app.scheduled();assert.equal((await get(pending)).status_category,'solved')
 await clock(closeAt-3600000);await app.scheduled();assert.equal((await get(pending)).status_category,'solved')
 await clock(closeAt);await app.scheduled();assert.equal((await get(pending)).status_category,'closed')
 await app.configure({});await app.scheduled()
 const final=await get(pending),finalRuns=await runs(pending)
 for(const rule of [solve,close]){
  assert.equal(finalRuns.filter(run=>run.rule_id===rule.id&&run.state==='complete').length,1)
  const changes=final.history.filter(h=>h.actor_id===`automation ${rule.name}`&&h.changes.status_id)
  assert.equal(changes.length,1);assert.equal(changes[0].source,'automation')
 }
 assert.deepEqual(await runs(reset),[],'a customer reply cancels the old Pending eligibility episode')
 assert.equal((await get(reset)).status_category,'open')
 const audit=await app.ok(`/api/management/projects/${w.projectId}/audit?limit=200`,{token:w.tokens.owner})
 assert.ok(audit.data.some(row=>row.target_id===pending&&row.actor_id===`automation ${solve.name}`))
 f.closedId=pending
 for(const rule of rules)await ok(`/workflow-rules/${rule.id}/pause`,{})
 await clock(initial)
 console.log('AUTOMATION-002: 48/96 business hours, four-day close, weekend/DST, interrupted cursor restart, reset, repeat refusal and automation actors passed')
}
