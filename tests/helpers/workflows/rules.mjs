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
 const templates=(await ok('/workflow-rules')).templates
 const nudge=await publish(templates.find(r=>r.name==='Pending 48h nudge')),solve=await publish(templates.find(r=>r.name==='Pending 96h solve'))
 const pending=await create('Still waiting for the return label');await patch(pending,{status_id:'pending'})
 await clock(initial+48*3600000+1000);await app.scheduled()
 let runs=(await ok(`/workflow-runs?conversation_id=${pending}`)).runs
 assert.equal(runs.filter(r=>r.rule_id===nudge.id).length,1)
 // A notice that cannot be delivered ends at once, visibly, and never waits in the resume set.
 assert.equal(runs.find(r=>r.rule_id===nudge.id).state,'not_delivered');assert.ok(runs.find(r=>r.rule_id===nudge.id).reason)
 await app.configure({H2H_WORKFLOW_NOW:String(initial+49*3600000)});await app.scheduled();runs=(await ok(`/workflow-runs?conversation_id=${pending}`)).runs;assert.equal(runs.filter(r=>r.rule_id===nudge.id).length,1)
 await clock(initial+96*3600000+2000);await app.scheduled();assert.equal((await get(pending)).status_category,'solved')
 await clock(initial+192*3600000+4000);await app.scheduled();assert.equal((await get(pending)).status_category,'closed')
 assert.ok((await get(pending)).history.some(h=>h.actor_id?.includes('automation')))
 f.closedId=pending
 await ok(`/workflow-rules/${solve.id}/pause`,{});await ok(`/workflow-rules/${nudge.id}/pause`,{})
 await clock(initial)
}
