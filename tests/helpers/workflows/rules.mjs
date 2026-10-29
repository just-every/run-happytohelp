import assert from 'node:assert/strict'
import {createHmac} from 'node:crypto'

export async function timeAutomationFlow(f){
 const {app,w,ok,call,create,get,patch,clock,send,initial}=f
 await app.ok(`/api/management/projects/${w.projectId}/settings`,{token:w.tokens.owner,method:'PUT',body:{timezone:'America/New_York'}})
 const calendar=await ok('/workflow-calendars',{name:'Workspace weekday support',timezone:'America/New_York',weekly:[1,2,3,4,5].map(day=>({day,start:'09:00',end:'17:00'})),holidays:'none',closures:[]})
 const start=Date.parse('2026-10-23T20:00:00Z'),nudgeAt=Date.parse('2026-11-02T21:00:00Z'),solveAt=Date.parse('2026-11-10T21:00:00Z'),closeAt=solveAt+4*86400000
 await clock(start-60000)
 const pending=await create('Return label for Ridgeline boots'),reset=await create('Customer answered about the carrier')
 await clock(start);await patch(pending,{status_id:'pending'});await patch(reset,{status_id:'pending'})
 // Assert the product's ready templates independently, rather than letting a
 // changed template silently change both setup and the expected outcome.
 const templates=(await ok('/workflow-rules')).templates,rules=[]
 const expected=[
  {name:'Pending 48h nudge',kind:'time',position:10,conditions:{all:[{field:'status_category',op:'eq',value:'pending'}],any:[]},time:{field:'pending_at',hours:48},actions:[{type:'notify',kind:'customer_update',message:'We are waiting for your reply. Please let us know if you still need help.'}]},
  {name:'Pending 96h solve',kind:'time',position:20,conditions:{all:[{field:'status_category',op:'eq',value:'pending'}],any:[]},time:{field:'pending_at',hours:96},actions:[{type:'status',status_id:'solved'}]},
  {name:'Solved 4d close',kind:'time',position:30,conditions:{all:[{field:'status_category',op:'eq',value:'solved'}],any:[]},time:{field:'solved_at',hours:96},actions:[{type:'status',status_id:'closed'}]},
 ]
 assert.deepEqual(templates,expected,'settings offer the 48h nudge, 96h solve and four-day close')
 for(const template of templates){
  const definition={...template,...(template.time.field==='pending_at'?{time:{...template.time,calendar_id:calendar.id}}:{})}
  if(template.name==='Pending 48h nudge')definition.actions=[{type:'priority',priority:'high'},{type:'note',content:'Pending return label follow-up'},...template.actions]
  assert.equal((await call('/workflow-rules',definition,undefined,'operator')).status,403,'an operator cannot author lead settings')
  const {rule}=await ok('/workflow-rules',definition),before=await get(pending),requests=app.requests.length
  assert.equal(rule.state,'draft');assert.equal(rule.owner_id,w.users.owner);assert.equal(rule.version,0)
  assert.deepEqual(rule.draft,definition,'creating settings retains the complete definition')
  const preview=await ok(`/workflow-rules/${rule.id}/preview`,{})
  assert.equal(preview.side_effects,false);assert.deepEqual(await get(pending),before);assert.equal(app.requests.length,requests)
  const published=(await ok(`/workflow-rules/${rule.id}/publish`,{})).rule
  assert.equal(published.state,'published');assert.equal(published.version,1)
  assert.deepEqual(published.published,definition,'publication retains the selected hours, business calendar, condition and actions')
  rules.push(published)
 }
 await app.configure({})
 const saved=(await ok('/workflow-rules')).rules
 for(const rule of rules){
  const read=saved.find(row=>row.id===rule.id)
  assert.ok(read);assert.equal(read.state,'published');assert.equal(read.owner_id,w.users.owner)
  assert.deepEqual(read.draft,rule.draft);assert.deepEqual(read.published,rule.published,'settings survive Worker restart')
  assert.deepEqual(read.versions.map(v=>({version:v.version,published_by:v.published_by,definition:v.definition})),[{version:1,published_by:w.users.owner,definition:rule.published}])
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
 // Keep the unavailable-mail outcome above, then exercise the same published
 // nudge with a separately proven customer and a provider-only network fake.
 await app.configure({EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'synthetic-automation-mail',EMAIL_FROM:'support@example.test'})
 const email='automation-customer@example.test',secret=(await app.first('SELECT verification_secret FROM projects WHERE id=?',w.projectId)).verification_secret
 const customer=await app.ok('/api/identity/widget/session',{body:{widgetKey:w.widgetKey,identifier:email,email,contact_hash:createHmac('sha256',secret).update(email).digest('hex')},headers:{Origin:w.allowedOrigin}})
 await clock(start-60000)
 const ticket=await app.ok('/api/conversations',{token:customer.token,body:{projectId:w.projectId}})
 await send(ticket.id,'Please check my return label.',customer.token)
 await clock(start)
 await patch(ticket.id,{fields:(await get(pending)).fields,status_id:'pending'})
 const notices=()=>app.requests.filter(row=>new URL(row.url).hostname==='api.resend.com'&&JSON.parse(row.body).text==='We are waiting for your reply. Please let us know if you still need help.')
 const beforeNotices=notices().length
 await clock(nudgeAt)
 const beforePreview=await get(ticket.id),beforeRuns=await runs(ticket.id),requests=app.requests.length
 const preview=await ok(`/workflow-rules/${nudge.id}/preview`,{})
 assert.equal(preview.results.find(row=>row.conversation_id===ticket.id).matched,true)
 assert.equal(preview.side_effects,false);assert.deepEqual(await get(ticket.id),beforePreview);assert.deepEqual(await runs(ticket.id),beforeRuns);assert.equal(app.requests.length,requests,'a matching preview never sends')
 await app.scheduled();await app.configure({});await clock(nudgeAt+3600000);await app.scheduled()
 const delivered=(await runs(ticket.id)).filter(run=>run.rule_id===nudge.id)
 assert.equal(delivered.length,1);assert.equal(delivered[0].state,'complete',delivered[0].reason);assert.equal(delivered[0].cursor,3)
 assert.equal(notices().length-beforeNotices,1,'exactly one nudge reaches the mail provider across restart')
 assert.deepEqual(JSON.parse(notices().at(-1).body).to,[email])
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
 const audit=await app.ok(`/api/management/projects/${w.projectId}/audit?limit=200&actor=${encodeURIComponent(`automation ${solve.name}`)}`,{token:w.tokens.owner})
 assert.ok(audit.data.some(row=>row.target_id===pending&&row.actor_id===`automation ${solve.name}`))
 f.closedId=pending
 for(const rule of rules)await ok(`/workflow-rules/${rule.id}/pause`,{})
 await clock(initial)
 console.log('AUTOMATION-002: 48/96 business hours, four-day close, weekend/DST, interrupted cursor restart, reset, repeat refusal and automation actors passed')
}
