import assert from 'node:assert/strict'
// Extends the existing public-door SLA proof without another registration.
export async function slaSlackFlow(f,original,calendar){
 const {app,w,other,ok,call,clock,patch,slack,initial}=f
 // Earlier queue routing remains published in this shared workspace. The lead
 // pauses automatic assignment while reviewing unassigned backup escalations;
 // otherwise a routed assignee earns a separate, still-authorized Slack alert.
 const routing=(await ok('/workflow-rules')).rules.filter(rule=>rule.kind==='routing'&&rule.state==='published')
 for(const rule of routing)await ok(`/workflow-rules/${rule.id}/pause`,{})
 const path=`/api/management/projects/${w.projectId}/connections/slack`
 const config={name:'Synthetic SLA channel',mode:'incoming-webhook',events:[],url:'https://hooks.slack.com/services/synthetic-hh-1/synthetic-hh-2/synthetic-hh-3'}
 assert.equal((await app.call(path,{token:w.tokens.operator,body:config})).status,403)
 const target=await app.ok(path,{token:w.tokens.admin,body:config})
 assert.equal(slack.requests.length,0,'saving a connection never implies test-post consent')
 const foreign=await app.ok(`/api/management/projects/${other.projectId}/connections/slack`,{token:other.tokens.owner,body:config})
 assert.equal((await call(`/sla-policies/${original.id}`,{slack_destination_id:foreign.id},'PATCH')).status,400)
 assert.equal((await call(`/sla-policies/${original.id}`,{slack_destination_id:target.id},'PATCH','operator')).status,403)
 await ok(`/sla-policies/${original.id}`,{active:false},'PATCH')
 // This shared inbox already contains other customers' commitments. Explicitly
 // choose which tickets the lead consents to escalate to this Slack channel.
 const field=await ok('/ticket-fields',{name:'Escalation destination',type:'text'})
 const policy=await ok('/sla-policies',{name:'Slack commitments',calendar_id:calendar.id,position:0,conditions:{fields:{[field.id]:'Slack backup'}},first_response_minutes:120,approaching_minutes:30,unattended_minutes:180,backup_user_ids:[w.users.admin],slack_destination_id:target.id})
 const create=async content=>{
  const id=await f.create(content)
  const ticket=await patch(id,{assigned_to:null,fields:{[field.id]:'Slack backup'}})
  assert.equal(ticket.assigned_to,null,'backup escalation starts in the unassigned queue')
  return id
 }
 assert.equal(JSON.parse((await app.first("SELECT detail_json FROM audit_events WHERE target_id=? AND action='sla-policies.post'",policy.id)).detail_json).slack_destination_id,target.id,'outbound consent records the selected destination in the audit')
 const start=Date.parse('2026-11-27T14:00:00Z')
 const alerts=async id=>(await ok(`/conversations/${id}/sla`)).alerts.filter(a=>a.recipient_id===w.users.admin)
 const settle=async()=>{for(let i=0;i<4;i++)await app.scheduled()}
 await clock(start)
 const id=await create('Private customer text must never leave in Slack.');await patch(id,{agent_id:w.users.admin})
 await clock(start+90*60000)
 let rows=await alerts(id);assert.equal(rows.find(a=>a.kind==='approaching').slack_state,'pending')
 await settle();rows=await alerts(id)
 assert.equal(rows.find(a=>a.kind==='approaching').slack_state,'accepted','approaching alert reaches the named backup')
 assert.equal(slack.requests.length,1,JSON.stringify({requests:slack.requests,rows}))
 assert.ok(!JSON.stringify(slack.requests).includes('Private customer'))
 assert.equal(slack.requests[0].mrkdwn,false)
 await clock(start+121*60000);slack.responses.push({status:400,body:'invalid_payload'});await settle()
 rows=await alerts(id);assert.equal(rows.find(a=>a.kind==='breach').slack_state,'failed','documented refusal is terminal')
 await clock(start+181*60000);slack.responses.push({lost:true});await settle()
 rows=await alerts(id);assert.equal(rows.find(a=>a.kind==='unattended').slack_state,'uncertain')
 const count=slack.requests.length
 await app.configure({});await settle();assert.equal(slack.requests.length,count,'restart never replays accepted, refused or unknown effects')
 const breach=rows.find(a=>a.kind==='breach')
 assert.equal((await ok(`/sla-alerts/${encodeURIComponent(breach.id)}/ack`,{},'PATCH','admin')).state,'acknowledged')
 await patch(id,{status_id:'solved'})
 // Only 429 with an explicit delay permits a bounded retry; the saved clock
 // drives every boundary, independently of the VM's wall clock.
 await clock(start);const retryId=await create();await patch(retryId,{agent_id:w.users.admin})
 await clock(start+90*60000);await alerts(retryId)
 slack.responses.push(...Array.from({length:5},()=>({status:429,body:'rate_limited',headers:{'Retry-After':'120'}})))
 await app.scheduled()
 let retry=(await alerts(retryId)).find(a=>a.kind==='approaching')
 assert.equal(retry.slack_state,'pending');assert.equal(retry.slack_attempts,1);assert.equal(retry.slack_next_attempt_at,start+92*60000)
 const before=slack.requests.length;await app.scheduled();assert.equal(slack.requests.length,before,'no send before the provider cooldown')
 // Pin the saved next-at for each retry. Later breach alerts are acknowledged
 // through their public door so the retry test retains one pending effect.
 for(let attempt=2;attempt<=5;attempt++){
  await clock(retry.slack_next_attempt_at)
  for(const row of await alerts(retryId))if(row.kind!=='approaching'&&row.state==='open')await ok(`/sla-alerts/${encodeURIComponent(row.id)}/ack`,{},'PATCH')
  await settle();retry=(await alerts(retryId)).find(a=>a.kind==='approaching')
  assert.equal(retry.slack_attempts,attempt)
 }
 assert.equal(retry.slack_state,'failed');assert.equal(retry.slack_next_attempt_at,null)
 await patch(retryId,{status_id:'solved'})
 // Current policy backup authority, not an old alert snapshot, controls sending.
 await clock(start);const revoked=await create();await clock(start+90*60000);await alerts(revoked)
 const pending=(await ok(`/conversations/${revoked}/sla`)).alerts.filter(alert=>alert.slack_state==='pending')
 assert.deepEqual(pending.map(alert=>alert.recipient_id),[w.users.admin],'the revoked backup owns the only pending Slack effect')
 await ok(`/sla-policies/${policy.id}`,{backup_user_ids:[]},'PATCH')
 const prior=slack.requests.length;await settle()
 assert.equal((await alerts(revoked)).find(a=>a.kind==='approaching').slack_state,'cancelled')
 assert.equal(slack.requests.length,prior)
 await patch(revoked,{status_id:'solved'})
 // Missing consent creates no Slack effect; revocation fences a queued effect.
 await ok(`/sla-policies/${policy.id}`,{backup_user_ids:[w.users.admin],slack_destination_id:null},'PATCH')
 await clock(start);const noConsent=await create();await clock(start+90*60000)
 assert.equal((await alerts(noConsent)).find(a=>a.kind==='approaching').slack_state,'not_configured')
 await settle();assert.equal(slack.requests.length,prior)
 await patch(noConsent,{status_id:'solved'})
 await ok(`/sla-policies/${policy.id}`,{slack_destination_id:target.id},'PATCH')
 await clock(start);const revokedConsent=await create();await clock(start+90*60000);await alerts(revokedConsent)
 await ok(`/sla-policies/${policy.id}`,{slack_destination_id:null},'PATCH')
 await settle();assert.equal(slack.requests.length,prior)
 assert.equal((await alerts(revokedConsent)).find(a=>a.kind==='approaching').slack_state,'cancelled')
 await patch(revokedConsent,{status_id:'solved'})
 await ok(`/sla-policies/${policy.id}`,{slack_destination_id:target.id},'PATCH')
 // A role change at the installation boundary revokes the destination's authority.
 await clock(start);const installerRevoked=await create();await clock(start+90*60000);await alerts(installerRevoked)
 await app.db.prepare("UPDATE memberships SET role='operator' WHERE project_id=? AND user_id=?").bind(w.projectId,w.users.admin).run()
 await settle();assert.equal(slack.requests.length,prior)
 assert.equal((await alerts(installerRevoked)).find(a=>a.kind==='approaching').slack_state,'cancelled')
 await app.db.prepare("UPDATE memberships SET role='admin' WHERE project_id=? AND user_id=?").bind(w.projectId,w.users.admin).run()
 await patch(installerRevoked,{status_id:'solved'})
 // An acknowledged pending alert never crosses the provider boundary.
 await ok(`/sla-policies/${policy.id}`,{backup_user_ids:[w.users.admin]},'PATCH')
 await clock(start);const ackId=await create();await clock(start+90*60000)
 const ack=(await alerts(ackId)).find(a=>a.kind==='approaching')
 await ok(`/sla-alerts/${encodeURIComponent(ack.id)}/ack`,{},'PATCH','admin')
 const ackCount=slack.requests.length;await settle()
 assert.equal(slack.requests.length,ackCount)
 assert.equal((await alerts(ackId)).find(a=>a.id===ack.id).slack_state,'cancelled')
 await patch(ackId,{status_id:'solved'})
 // A persisted claim with no outcome is a process-boundary fixture: restart
 // recovers it as unknown, without attempting to reconstruct the external effect.
 await clock(start);const interrupted=await create();await clock(start+90*60000)
 const claim=(await alerts(interrupted)).find(a=>a.kind==='approaching')
 await app.db.prepare("UPDATE sla_alerts SET slack_state='sending',slack_started_at=? WHERE id=?").bind(start-3600001,claim.id).run()
 await app.configure({});await settle()
 assert.equal((await alerts(interrupted)).find(a=>a.id===claim.id).slack_state,'uncertain')
 assert.equal(slack.requests.length,ackCount)
 await patch(interrupted,{status_id:'solved'})
 // Disabling the frozen destination fences already-pending alerts too.
 await clock(start);const disabled=await create();await clock(start+90*60000);await alerts(disabled)
 await app.ok(path+'/'+target.id,{token:w.tokens.owner,method:'DELETE'})
 await settle();assert.equal(slack.requests.length,ackCount)
 assert.equal((await alerts(disabled)).find(a=>a.kind==='approaching').slack_state,'cancelled')
 await patch(disabled,{status_id:'solved'})
 await ok(`/sla-policies/${policy.id}`,{active:false,slack_destination_id:null},'PATCH')
 await ok(`/sla-policies/${original.id}`,{active:true},'PATCH');await clock(initial)
 const testTarget=await app.ok(path,{token:w.tokens.owner,body:config})
 const testCount=slack.requests.length
 assert.equal((await app.call(path+'/'+testTarget.id+'/test',{token:w.tokens.operator,body:{}})).status,403)
 assert.equal((await app.call(`/api/management/projects/${other.projectId}/connections/slack/${testTarget.id}/test`,{token:other.tokens.owner,body:{}})).status,404)
 assert.equal(slack.requests.length,testCount)
 await app.ok(path+'/'+testTarget.id+'/test',{token:w.tokens.owner,body:{}})
 assert.equal(slack.requests.length,testCount+1,'only the explicit owner test action posts a test')
 for(const rule of routing)await ok(`/workflow-rules/${rule.id}/publish`,{})
}
