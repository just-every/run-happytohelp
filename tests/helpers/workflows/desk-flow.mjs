import assert from 'node:assert/strict'
import {createHmac} from 'node:crypto'
import {timeAutomationFlow} from './rules.mjs'
import {queueRoutingProof} from '../inbox/queue-routing.mjs'

export async function deskWorkflows(desk,{initial,id,field,group}){
 const {app,w,visitor,get,patch}=desk,base=desk.base
 const call=(path,body,method,role='owner',headers={})=>app.call(base+path,{token:w.tokens[role],body,method,headers})
 const ok=async(...args)=>{const response=await call(...args);assert.ok(response.status>=200&&response.status<300,JSON.stringify(response.data));return response.data.data??response.data}
 const send=async(ticket,content='The replacement has not arrived.',token=visitor.token)=>{const current=await get(ticket);return app.ok(`/api/conversations/${ticket}/messages`,{token,body:{localId:crypto.randomUUID(),content,expectedRevision:current.revision,expectedLastMessageId:current.last_message_id}})}
 const create=async(content='Please arrange a replacement.')=>{const ticket=await app.ok('/api/conversations',{token:w.tokens.owner,body:{projectId:w.projectId,contactId:visitor.contactId}});await send(ticket.id,content);await patch(ticket.id,{fields:{[field.id]:'RMA-WORKFLOW'}});return ticket.id}
 const clock=async value=>app.configure({H2H_WORKFLOW_NOW:String(typeof value==='number'?value:Date.parse(value))})
 const publish=async definition=>{const {rule}=await ok('/workflow-rules',definition);return (await ok(`/workflow-rules/${rule.id}/publish`,{})).rule}
 const f={app,w,other:desk.foreign,customer:visitor,initial,call,ok,get,patch,send,create,clock,publish}

 // The same replacement enters a named team. Two concurrent arrivals are split
 // between its available people; an unavailable teammate never wins overflow.
 await ok('/routing-operators',{operators:[{user_id:w.users.owner,available:false,capacity:100,skills:[]},{user_id:w.users.admin,available:true,capacity:100,skills:[]},{user_id:w.users.operator,available:true,capacity:100,skills:[]}]},'PUT')
 const team=await ok('/ticket-groups',{name:'Shipping',members:[w.users.admin,w.users.operator]})
 const route=await publish({name:'Replacement dispatch',kind:'routing',position:0,conditions:{all:[]},actions:[],routing:{strategy:'round_robin',group_id:team.id,skills:[]}})
 const arrivals=await Promise.all([create('First replacement dispatch'),create('Second replacement dispatch')])
 assert.deepEqual((await Promise.all(arrivals.map(async ticket=>(await get(ticket)).assigned_to))).sort(),[w.users.admin,w.users.operator].sort())
 assert.equal((await ok(`/conversations/${arrivals[0]}/routing`)).decision.rule_id,route.id)
 await ok('/routing-operators',{operators:[{user_id:w.users.admin,available:false,capacity:100,skills:[]},{user_id:w.users.operator,available:true,capacity:0,skills:[]}]},'PUT')
 await clock(initial+60000)
 const overflow=await create('Replacement awaiting capacity');assert.equal((await get(overflow)).assigned_to,null);assert.equal((await get(overflow)).group_id,team.id)
 await queueRoutingProof(f,{group,team,route,arrivals,overflow})
 await ok(`/workflow-rules/${route.id}/pause`,{})

 const calendar=await ok('/workflow-calendars',{name:'Returns weekdays',timezone:'America/New_York',weekly:[1,2,3,4,5].map(day=>({day,start:'09:00',end:'17:00'})),holidays:'none',closures:[]})
 const policy=await ok('/sla-policies',{name:'Replacement commitment',calendar_id:calendar.id,conditions:{},first_response_minutes:120,resolution_minutes:480,pause_on_hold:true})
 await patch(id,{status_id:'on_hold'})
 assert.equal((await ok(`/conversations/${id}/sla`)).pause_reason,'on_hold')
 assert.equal((await app.ok(`/api/conversations/${id}`,{token:visitor.token})).status_id,'open','the customer never sees an internal hold')
 await patch(id,{status_id:'open'})
 await ok(`/sla-policies/${policy.id}`,{active:false},'PATCH')

 await scheduleFlow(f,id)

 // A versioned event rule previews without sending, then signs its real effect.
 // Unknown provider outcomes stop later actions and survive restart and pause.
 for(const [mode,state] of [['ok','complete'],['reject','failed'],['lost','uncertain']]){
  const destination=await app.ok(`/api/management/projects/${w.projectId}/connections/webhooks`,{token:w.tokens.owner,body:{name:'Returns '+mode,url:'https://hooks.example.com/'+mode,events:['conversation.rated']}})
  const {rule}=await ok('/workflow-rules',{name:'Replacement '+mode,kind:'event',event_kind:'customer_reply',conditions:{all:[{field:'subject',op:'contains',value:'Replacement for order'}]},actions:[{type:'webhook',destination_id:destination.id},{type:'priority',priority:'high'}]})
  const before=app.requests.length,preview=await ok(`/workflow-rules/${rule.id}/preview`,{})
  assert.equal(preview.side_effects,false);assert.equal(app.requests.length,before)
  await ok(`/workflow-rules/${rule.id}/publish`,{});await patch(id,{priority:'normal'})
  await send(id,'Please check the replacement status.')
  const run=(await ok(`/workflow-runs?conversation_id=${id}`)).runs.find(row=>row.rule_id===rule.id)
  assert.equal(run.state,state,run.reason);assert.equal((await get(id)).priority,mode==='ok'?'high':'normal')
  const request=app.requests.filter(row=>new URL(row.url).hostname==='hooks.example.com').at(-1),headers=request.headers
  const signed=JSON.stringify(['integrations.webhook.v1',w.projectId,destination.id,'workflow.action',headers['webhook-id'],headers['webhook-timestamp'],request.body])
  assert.equal(headers['webhook-signature'],'v1='+createHmac('sha256',Buffer.from(destination.secret,'hex')).update(signed).digest('hex'))
  const requests=app.requests.filter(row=>new URL(row.url).hostname==='hooks.example.com').length
  await app.configure({});await app.scheduled();assert.equal(app.requests.filter(row=>new URL(row.url).hostname==='hooks.example.com').length,requests)
  await ok(`/workflow-rules/${rule.id}/pause`,{});await send(id,'One more replacement update?')
  assert.equal(app.requests.filter(row=>new URL(row.url).hostname==='hooks.example.com').length,requests)
 }
 await clock(initial)
 await timeAutomationFlow(f)
}

// QUEUE-004 stays in the replacement journey: all writes and readbacks use the
// native ticket/schedule doors. Only the runtime clock/process and mail edge move.
async function scheduleFlow(f,id){
 const {app,w,customer:visitor,ok,call,get,patch,send,create,clock,initial}=f
 const due=initial+3600000,timezone='America/New_York'
 const rows=async ticket=>(await ok(`/conversations/${ticket}/workflows`)).schedules
 const read=async schedule=>(await rows(schedule.conversation_id)).find(row=>row.id===schedule.id)
 const transcript=ticket=>app.ok(`/api/conversations/${ticket}/messages`,{token:visitor.token})
 const hasActive=async ticket=>(await ok('/conversations')).some(row=>row.id===ticket)
 const schedule=async(ticket=id,changes={})=>{const current=await get(ticket);return ok('/workflow-schedules',{conversation_id:ticket,kind:'reply',due_at:due,timezone,body:'Your replacement is on its way.',owner_id:w.users.owner,expected_revision:current.revision,expected_last_message_id:current.last_message_id,expected_ticket_version:current.ticket_version,...changes})}
 const snooze=await schedule(id,{kind:'snooze',due_at:'2026-11-02T05:00:00-05:00'})
 assert.equal(snooze.due_at,due);assert.equal(snooze.timezone,timezone)
 assert.ok((await ok('/conversations?snoozed=only')).some(ticket=>ticket.id===id))
 assert.equal(await hasActive(id),false,'snoozing removes the ticket from the active queue')
 await send(id,'Please use my original delivery address.')
 assert.equal((await read(snooze)).state,'woken');assert.equal(await hasActive(id),true)
 const cancelled=await schedule();await send(id,'Please check the delivery date.')
 assert.equal((await read(cancelled)).state,'cancelled')

 // Inspect and edit the pending body, exact instant and responsible owner. A
 // restart after the deadline retains overdue ownership before the executor runs.
 const planned=await schedule(),editedDue=due+60000,body='Your replacement ships tomorrow.'
 assert.equal((await read(planned)).body,planned.body)
 assert.equal((await call(`/workflow-schedules/${planned.id}`,{body:'Not my schedule'},'PATCH','operator')).status,403)
 await ok(`/workflow-schedules/${planned.id}`,{body,due_at:editedDue,owner_id:w.users.admin},'PATCH')
 await clock(due);await app.scheduled();assert.equal((await read(planned)).state,'pending','the original send time was replaced')
 await clock(editedDue+60000);await app.configure({})
 const overdue=(await ok(`/workflow-schedules?conversation_id=${id}`)).find(row=>row.id===planned.id)
 assert.equal(overdue.state,'pending');assert.equal(overdue.owner_id,w.users.admin)
 assert.equal(overdue.due_at,editedDue);assert.ok(overdue.due_at<editedDue+60000)
 assert.equal(overdue.timezone,timezone);assert.equal(overdue.body,body)
 assert.deepEqual(await read(planned),overdue,'the ticket and workspace doors retain the same overdue follow-up')
 await app.scheduled();await app.configure({});await app.scheduled()
 assert.equal((await read(planned)).state,'sent')
 assert.equal((await app.first('SELECT count(*) n FROM messages WHERE local_id=?',`schedule:${planned.id}`)).n,1)
 assert.equal((await transcript(id)).messages.filter(message=>message.content===body).length,1)

 // Explicit cancellation, reassignment and a response at the exact due instant
 // all stop queued replies before admission; waking twice cannot publish twice.
 await clock(initial+120000)
 const manual=await schedule(id,{body:'Cancelled replacement answer'});await ok(`/workflow-schedules/${manual.id}`,{action:'cancel'},'PATCH')
 assert.equal((await read(manual)).state,'cancelled');assert.match((await read(manual)).reason,/Cancelled by teammate/)
 const reassigned=await schedule(id,{body:'Reassigned replacement answer'}),previousAssignee=(await get(id)).assigned_to
 const nextAssignee=previousAssignee===w.users.owner?w.users.operator:w.users.owner
 await patch(id,{agent_id:nextAssignee});assert.equal((await get(id)).assigned_to,nextAssignee);assert.notEqual(nextAssignee,previousAssignee)
 const atDue=await create('A customer responds exactly when a follow-up is due.')
 const stopped=await schedule(atDue,{body:'Stale replacement answer'}),sleeping=await schedule(atDue,{kind:'snooze'})
 await clock(due);await send(atDue,'Please wait for my updated address.')
 assert.equal((await read(sleeping)).state,'woken');assert.equal((await read(stopped)).state,'cancelled')
 const woke=await read(sleeping)
 await app.configure({});await app.scheduled();await app.scheduled()
 assert.deepEqual(await read(sleeping),woke,'one customer response wakes the snooze once')
 assert.equal((await read(reassigned)).state,'cancelled');assert.match((await read(reassigned)).reason,/changed|assign/i)
 for(const entry of [manual,reassigned,stopped])assert.ok(!(await transcript(entry.conversation_id)).messages.some(message=>message.content===entry.body),'a stopped schedule never reaches the customer transcript')

 // Dependency-only and timed snoozes survive restart, wake through the executor
 // once, and return to the active queue without a customer reply.
 await clock(initial+120000)
 const dependency=await create('Replacement label awaiting warehouse confirmation')
 const waiting=await schedule(id,{kind:'snooze',due_at:null,dependency_id:dependency})
 await app.configure({});await app.scheduled()
 assert.equal((await read(waiting)).state,'pending');assert.equal((await read(waiting)).dependency_id,dependency)
 assert.equal(await hasActive(id),false)
 await patch(dependency,{status_id:'solved'});await app.scheduled()
 assert.equal((await read(waiting)).state,'woken');assert.equal(await hasActive(id),true)
 const timed=await schedule(id,{kind:'snooze'})
 await clock(due-1);await app.scheduled();assert.equal((await read(timed)).state,'pending')
 await clock(due);await app.scheduled();assert.equal((await read(timed)).state,'woken')
 const settled=[await read(waiting),await read(timed)]
 await app.configure({});await app.scheduled()
 assert.deepEqual([await read(waiting),await read(timed)],settled)
 assert.equal(await hasActive(id),true)

 // Lose the process immediately after its durable sending claim. No in-memory
 // recovery runs, and a new Worker reports uncertainty instead of re-admitting.
 await clock(initial+120000)
 const interrupted=await schedule(id,{body:'Interrupted replacement answer'})
 await clock(due)
 const crash=await app.call('/_test/scheduled',{body:{after:0},headers:{'x-test-fault':'db-interrupt','x-test-statement':"UPDATE workflow_schedules SET state='sending'"}})
 assert.equal(crash.status,500);assert.equal((await read(interrupted)).state,'sending')
 await clock(due+120000);await app.configure({});await app.scheduled()
 assert.equal((await read(interrupted)).state,'uncertain');assert.match((await read(interrupted)).reason,/worker stopped/i)
 await app.configure({});await app.scheduled()
 assert.equal((await read(interrupted)).state,'uncertain')
 assert.ok(!(await transcript(id)).messages.some(message=>message.content===interrupted.body))
 assert.equal((await call(`/workflow-schedules/${interrupted.id}`,{due_at:due+600000},'PATCH')).status,409)

 // Provider acceptance, refusal and a lost response traverse real scheduled
 // message admission and delivery. The network fixture chooses only its answer.
 await app.configure({H2H_LOCAL:'true',EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'synthetic-schedule-mail',EMAIL_FROM:'support@example.test'})
 await app.ok(`/api/management/projects/${w.projectId}/email-settings`,{token:w.tokens.owner,method:'PUT',body:{from_address:'support@example.test',inbound_address:'support@example.test',is_enabled:true}})
 for(const [mode,state] of [['accepted','sent'],['refused','failed'],['lost','uncertain']]){
  await clock(initial+120000)
  const ticket=await create('Scheduled replacement email '+mode),body='Scheduled replacement '+mode
  const entry=await schedule(ticket,{body,owner_id:w.users.admin})
  assert.equal((await read(entry)).state,'pending')
  await app.configure({});await clock(due);await app.scheduled()
  const outcome=await read(entry)
  assert.equal(outcome.state,state,outcome.reason);assert.equal(outcome.owner_id,w.users.admin);assert.equal(outcome.due_at,due)
  if(state!=='sent')assert.ok(outcome.reason,'failed and uncertain outcomes explain the stop')
  assert.equal((await transcript(ticket)).messages.filter(message=>message.content===body).length,1)
  const attempts=()=>app.requests.filter(request=>new URL(request.url).hostname==='api.resend.com'&&JSON.parse(request.body).text?.includes(body))
  assert.equal(attempts().length,1,'one provider attempt per due reply')
  await app.configure({});await app.scheduled();await app.scheduled()
  assert.equal(attempts().length,1,'terminal and ambiguous provider attempts never replay after restart')
  assert.deepEqual(await read(entry),outcome)
  assert.equal((await call(`/workflow-schedules/${entry.id}`,{due_at:due+600000},'PATCH')).status,409)
 }
 await app.configure({H2H_LOCAL:'true',EMAIL_PROVIDER:'development',EMAIL_API_KEY:undefined,EMAIL_FROM:undefined})
 await clock(due)
 console.log('QUEUE-004: timezone/dependency snooze, response wake, edited overdue owner, cancellation/reassignment, once-only send, interrupted claim and provider outcomes survive restart without replay')
}
