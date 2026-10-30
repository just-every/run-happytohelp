import assert from 'node:assert/strict'
import {mailApp,recipients} from '../email/app.mjs'
import {notificationTriggersJourney} from '../r4/notifications.mjs'
import {workflowNotices,workflowGroupNotices} from '../email/workflow-notices.mjs'

// Native routes over persistent D1. Only the mail provider is faked; faults end
// an invocation after a real durable write, then a new Worker owns the same data.
export async function durableAutomationOutcomes(){
 const initial=Date.now(),m=await mailApp({bindings:{H2H_LOCAL:'true',H2H_WORKFLOW_NOW:String(initial)}}),{app,mail,operator}=m
 try{
  // Re-run the previously cited assertions, rather than inheriting a done claim.
  await notificationTriggersJourney(m);await workflowNotices(m);await workflowGroupNotices(m)
  const base='/api/dashboard/projects/p',management='/api/management/projects/p'
  const req=(path,body,method)=>app.ok(base+path,{headers:operator,body,method})
  const get=async id=>(await req(`/conversations/${id}/ticket`)).data
  const notices=marker=>mail.sent.filter(entry=>entry.body.text?.startsWith(marker))
  const incoming=async(key,from,cc=[])=>{
   const response=await m.gateway({messageId:key,to:'inbound@example.com',from,cc,subject:key,text:'Please review this refund.'})
   assert.equal(response.status,201);await app.scheduled()
   return (await m.claim(key)).conversation_id
  }
  const publish=async(name,actions)=>{
   const {rule}=await req('/workflow-rules',{name,kind:'event',event_kind:'changed',conditions:{all:[{field:'subject',op:'eq',value:name},{field:'priority',op:'eq',value:'high'}]},actions})
   return (await req(`/workflow-rules/${rule.id}/publish`,{})).rule
  }
  const runs=async(id,rule)=>(await req(`/workflow-runs?conversation_id=${id}`)).runs.filter(run=>run.rule_id===rule.id)
  const notify=marker=>[{type:'notify',kind:'assignee',message:marker+' assignee {{ticket.id}}'},{type:'notify',kind:'customer_update',message:marker+' customer {{ticket.id}}'},{type:'priority',priority:'urgent'}]
  let clock=initial
  const reset=async()=>{clock+=180000;await app.configure({H2H_WORKFLOW_NOW:String(clock)});await app.scheduled();await app.scheduled()}

  // A merged source's customer never acquires target notification authority.
  // A header-only CC and other current/following people are not this action's audience.
  const id=await incoming('Automation audience','audience-requester@example.com',['other-customer@example.net','unproven@example.net'])
  const merged=await incoming('Merged refund','merged-customer@example.com')
  await app.db.batch([app.db.prepare("INSERT INTO users VALUES('revoked','revoked@example.com','Revoked',1)"),app.db.prepare("INSERT INTO memberships VALUES('p','revoked','operator')")])
  await req(`/conversations/${id}/followers`,{user_ids:['op','watch','quiet','revoked']},'PUT')
  await app.ok(management+'/agents/revoked',{headers:operator,method:'DELETE'})
  await req(`/conversations/${id}/merge`,{source_id:merged,source_version:(await get(merged)).ticket_version,target_version:(await get(id)).ticket_version})
  await req(`/conversations/${id}/ticket`,{agent_id:'op'},'PATCH')
  const audience=await publish('Automation audience',notify('Audience proof'))
  await req(`/conversations/${id}/ticket`,{priority:'high'},'PATCH')
  assert.equal((await runs(id,audience))[0].state,'complete')
  assert.deepEqual(notices('Audience proof').map(entry=>recipients(entry.body)),[['op@example.com'],['audience-requester@example.com']])
  for(const address of ['watch@example.com','quiet@example.com','other-customer@example.net','unproven@example.net','merged-customer@example.com','revoked@example.com']){
   assert.equal(notices('Audience proof').filter(entry=>recipients(entry.body).includes(address)).length,0,address+' receives no automation action')
  }
  assert.equal((await get(id)).priority,'urgent')
  await reset()
  assert.equal((await runs(id,audience)).length,1)
  assert.deepEqual(notices('Audience proof').flatMap(entry=>recipients(entry.body)),['op@example.com','audience-requester@example.com'])
  await req(`/workflow-rules/${audience.id}/pause`,{})

  // Interrupt after the provider accepted and its durable delivery row committed,
  // but before the workflow could store its outcome or advance its action cursor.
  const interrupted=await incoming('Interrupted automation','restart-requester@example.com')
  await req(`/conversations/${interrupted}/ticket`,{agent_id:'op'},'PATCH')
  const restartRule=await publish('Interrupted automation',notify('Restart proof'))
  const failed=await app.call(base+`/conversations/${interrupted}/ticket`,{headers:{...operator,'x-test-fault':'db-interrupt','x-test-statement':'UPDATE email_deliveries SET state=\\?,provider_id='},method:'PATCH',body:{priority:'high'}})
  assert.equal(failed.status,503)
  assert.equal(notices('Restart proof assignee').length,1,'provider accepted once before process exit')
  assert.equal(notices('Restart proof customer').length,0)
  const stopped=(await runs(interrupted,restartRule))[0]
  assert.equal(stopped.cursor,0);assert.equal(stopped.state,'running')
  const calls=mail.attempts
  await reset()
  const terminal=(await runs(interrupted,restartRule))[0]
  assert.equal(terminal.state,'uncertain');assert.match(terminal.reason,/unknown|uncertain/i)
  assert.equal(terminal.version,1);assert.equal(terminal.rule_name,'Interrupted automation')
  assert.equal((await get(interrupted)).priority,'high','uncertainty stops later local and external actions')
  const receipt=await app.first('SELECT state FROM workflow_notifications WHERE id=?',stopped.id+':action:0')
  assert.equal(receipt.state,'uncertain','the interrupted action receipt is terminal too')
  assert.equal(mail.attempts,calls,'restart and repeated scheduling cannot retry an interrupted send')
  assert.equal(notices('Restart proof customer').length,0)
  await req(`/workflow-rules/${restartRule.id}/pause`,{})

  // Stop after action one and its cursor commit, then pause through the public
  // settings command before the next customer-facing effect can be admitted.
  const paused=await incoming('Paused automation','pause-requester@example.com')
  await req(`/conversations/${paused}/ticket`,{agent_id:'op'},'PATCH')
  const pauseRule=await publish('Paused automation',notify('Pause proof'))
  assert.equal((await app.call(base+`/conversations/${paused}/ticket`,{headers:{...operator,'x-test-fault':'db-interrupt','x-test-statement':'UPDATE workflow_runs SET cursor=max'},method:'PATCH',body:{priority:'high'}})).status,503)
  const first=(await runs(paused,pauseRule))[0]
  assert.equal(first.cursor,1);assert.equal(first.state,'running')
  assert.equal(notices('Pause proof assignee').length,1);assert.equal(notices('Pause proof customer').length,0)
  assert.equal((await req(`/workflow-rules/${pauseRule.id}/pause`,{})).rule.state,'paused')
  const attempts=mail.attempts
  await reset()
  const cancelled=(await runs(paused,pauseRule))[0]
  assert.equal(cancelled.state,'cancelled');assert.match(cancelled.reason,/paused before the next side effect/i)
  assert.equal((await get(paused)).priority,'high');assert.equal(mail.attempts,attempts)
  assert.equal(notices('Pause proof assignee').length,1);assert.equal(notices('Pause proof customer').length,0)
 }finally{await m.close()}
}
