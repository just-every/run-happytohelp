import assert from 'node:assert/strict'
// Extends the existing public-door SLA proof without another registration.
export async function slaSlackFlow(f,original,calendar){
 const {app,w,other,ok,call,create,clock,patch,slack,initial}=f
 const path=`/api/management/projects/${w.projectId}/connections/slack`
 const config={name:'Synthetic SLA channel',mode:'incoming-webhook',events:[],url:'https://hooks.slack.com/services/synthetic-hh-1/synthetic-hh-2/synthetic-hh-3'}
 assert.equal((await app.call(path,{token:w.tokens.operator,body:config})).status,403)
 const target=await app.ok(path,{token:w.tokens.owner,body:config})
 const foreign=await app.ok(`/api/management/projects/${other.projectId}/connections/slack`,{token:other.tokens.owner,body:config})
 assert.equal((await call(`/sla-policies/${original.id}`,{slack_destination_id:foreign.id},'PATCH')).status,400)
 await ok(`/sla-policies/${original.id}`,{active:false},'PATCH')
 const policy=await ok('/sla-policies',{name:'Slack commitments',calendar_id:calendar.id,position:0,conditions:{},first_response_minutes:120,approaching_minutes:30,unattended_minutes:180,backup_user_ids:[w.users.admin],slack_destination_id:target.id})
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
 await ok(`/sla-policies/${policy.id}`,{backup_user_ids:[]},'PATCH')
 const prior=slack.requests.length;await settle()
 assert.equal((await alerts(revoked)).find(a=>a.kind==='approaching').slack_state,'cancelled')
 assert.equal(slack.requests.length,prior)
 await patch(revoked,{status_id:'solved'})
 await ok(`/sla-policies/${policy.id}`,{active:false},'PATCH')
 await ok(`/sla-policies/${original.id}`,{active:true},'PATCH');await clock(initial)
}
