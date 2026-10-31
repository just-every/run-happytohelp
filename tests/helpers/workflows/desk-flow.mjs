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

 // Snooze wakes on a real response. A scheduled reply cancels when its frontier
 // changes, and the replacement schedule sends once across executor restart.
 const due=initial+3600000
 const snooze=await ok('/workflow-schedules',{conversation_id:id,kind:'snooze',due_at:due,timezone:'UTC',owner_id:w.users.owner})
 assert.ok((await ok('/conversations?snoozed=only')).some(ticket=>ticket.id===id))
 await send(id,'Please use my original delivery address.')
 assert.equal((await ok(`/conversations/${id}/workflows`)).schedules.find(row=>row.id===snooze.id).state,'woken')
 const schedule=async()=>{const current=await get(id);return ok('/workflow-schedules',{conversation_id:id,kind:'reply',due_at:due,timezone:'UTC',body:'Your replacement is on its way.',owner_id:w.users.owner,expected_revision:current.revision,expected_last_message_id:current.last_message_id,expected_ticket_version:current.ticket_version})}
 const cancelled=await schedule();await send(id,'Please check the delivery date.')
 assert.equal((await ok(`/conversations/${id}/workflows`)).schedules.find(row=>row.id===cancelled.id).state,'cancelled')
 const planned=await schedule();await clock(due);await app.scheduled();await app.configure({});await app.scheduled()
 assert.equal((await ok(`/conversations/${id}/workflows`)).schedules.find(row=>row.id===planned.id).state,'sent')
 assert.equal((await app.first('SELECT count(*) n FROM messages WHERE local_id=?',`schedule:${planned.id}`)).n,1)

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
