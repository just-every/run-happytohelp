import assert from 'node:assert/strict'
// Another delivery path within the existing ticket lifecycle sanity journey.
export async function slaTeamsFlow(f,original,calendar){
 const {app,w,other,ok,call,create,clock,patch,teams,initial}=f
 const path=`/api/escalations/projects/${w.projectId}/connections`
 const config={provider:'teams',target:'11111111-1111-4111-8111-111111111111/'+['19:synthetic-channel','thread.tacv2'].join('@'),token:'synthetic-hh-teams'}
 const connect=async()=>{const row=(await app.ok(path,{token:w.tokens.admin,body:config})).data;return (await ok('/sla-teams-destinations')).find(d=>d.id===row.id)}
 assert.equal((await app.call(path,{token:w.tokens.operator,body:config})).status,403)
 let target=await connect()
 assert.equal(teams.requests.length,0,'connecting is not consent to send SLA alerts')
 const foreign=(await app.ok(`/api/escalations/projects/${other.projectId}/connections`,{token:other.tokens.owner,body:config})).data
 assert.equal((await call(`/sla-policies/${original.id}`,{teams_connection_id:foreign.id,teams_connection_version:target.updated_at},'PATCH')).status,400)
 assert.equal((await call(`/sla-policies/${original.id}`,{teams_connection_id:target.id,teams_connection_version:target.updated_at},'PATCH','operator')).status,403)
 await ok(`/sla-policies/${original.id}`,{active:false},'PATCH')
 const policy=await ok('/sla-policies',{name:'Teams commitments',calendar_id:calendar.id,position:0,conditions:{},first_response_minutes:120,approaching_minutes:30,unattended_minutes:180,backup_user_ids:[w.users.admin],teams_connection_id:target.id,teams_connection_version:target.updated_at})
 const start=Date.parse('2026-11-27T14:00:00Z'),alerts=async id=>(await ok(`/conversations/${id}/sla`)).alerts.filter(a=>a.recipient_id===w.users.admin)
 const settle=async()=>{for(let i=0;i<4;i++)await app.scheduled()}
 const pending=async()=>{await clock(start);const id=await create('Private customer message must stay in HappyToHelp.');await clock(start+90*60000);const alert=(await alerts(id)).find(a=>a.kind==='approaching');return {id,alert}}
 let ticket=await pending()
 await settle()
 assert.equal((await alerts(ticket.id)).find(a=>a.kind==='approaching').teams_state,'accepted')
 assert.equal(teams.requests[0].body.contentType,'text')
 assert.ok(teams.requests[0].body.content.includes(ticket.id)&&teams.requests[0].body.content.includes(w.users.admin))
 assert.ok(!JSON.stringify(teams.requests).includes('Private customer'))
 teams.responses.push({status:403});await clock(start+121*60000);await alerts(ticket.id);await settle()
 assert.equal((await alerts(ticket.id)).find(a=>a.kind==='breach').teams_state,'failed')
 teams.responses.push({lost:true});await clock(start+181*60000);await alerts(ticket.id);await settle()
 const uncertain=(await alerts(ticket.id)).find(a=>a.kind==='unattended');assert.equal(uncertain.teams_state,'uncertain')
 let count=teams.requests.length
 await app.configure({});await settle();assert.equal(teams.requests.length,count,'restart never replays a refused or unknown effect')
 await ok(`/sla-alerts/${encodeURIComponent(uncertain.id)}/ack`,{},'PATCH','admin')
 assert.equal((await alerts(ticket.id)).find(a=>a.id===uncertain.id).state,'acknowledged')
 await patch(ticket.id,{status_id:'solved'})
 // A documented provider cooldown resumes once, then preserves the accepted receipt.
 ticket=await pending();teams.responses.push({status:429,headers:{'Retry-After':'120'}});await settle()
 let waiting=(await alerts(ticket.id)).find(a=>a.kind==='approaching');assert.equal(waiting.teams_state,'pending');assert.ok(waiting.teams_next_attempt_at>start+90*60000)
 count=teams.requests.length;await settle();assert.equal(teams.requests.length,count)
 await clock(waiting.teams_next_attempt_at);await settle()
 assert.equal((await alerts(ticket.id)).find(a=>a.id===waiting.id).teams_state,'accepted')
 await patch(ticket.id,{status_id:'solved'})
 // Perpetual rate limiting must finish visibly, rather than becoming an endless send loop.
 ticket=await pending();teams.responses.push(...Array.from({length:8},()=>({status:429,headers:{'Retry-After':'1'}})))
 for(let tick=0;tick<8;tick++){
  await settle();waiting=(await alerts(ticket.id)).find(a=>a.id===ticket.alert.id)
  if(waiting.teams_state!=='pending')break
  for(const row of await alerts(ticket.id))if(row.id!==waiting.id&&row.state==='open')await ok(`/sla-alerts/${encodeURIComponent(row.id)}/ack`,{},'PATCH')
  await clock(waiting.teams_next_attempt_at)
 }
 assert.equal(waiting.teams_state,'failed');teams.responses.length=0
 count=teams.requests.length;await settle();assert.equal(teams.requests.length,count)
 await patch(ticket.id,{status_id:'solved'})
 // These are ordinary public changes that must stop a queued external effect.
 for(const reason of ['acknowledged','resolved','backup removed','consent removed','reconnected','installer revoked']){
  ticket=await pending();count=teams.requests.length
  if(reason==='acknowledged')await ok(`/sla-alerts/${encodeURIComponent(ticket.alert.id)}/ack`,{},'PATCH','admin')
  if(reason==='resolved')await patch(ticket.id,{status_id:'solved'})
  if(reason==='backup removed')await ok(`/sla-policies/${policy.id}`,{backup_user_ids:[]},'PATCH')
  if(reason==='consent removed')await ok(`/sla-policies/${policy.id}`,{teams_connection_id:null,teams_connection_version:null},'PATCH')
  if(reason==='reconnected')target=await connect()
  if(reason==='installer revoked')await app.db.prepare("UPDATE memberships SET role='operator' WHERE project_id=? AND user_id=?").bind(w.projectId,w.users.admin).run()
  await settle();assert.equal(teams.requests.length,count,reason+' stops a queued effect')
  assert.equal((await alerts(ticket.id)).find(a=>a.id===ticket.alert.id).teams_state,'cancelled')
  if(reason==='installer revoked')await app.db.prepare("UPDATE memberships SET role='admin' WHERE project_id=? AND user_id=?").bind(w.projectId,w.users.admin).run()
  await patch(ticket.id,{status_id:'solved'})
  await ok(`/sla-policies/${policy.id}`,{backup_user_ids:[w.users.admin],teams_connection_id:target.id,teams_connection_version:target.updated_at},'PATCH')
 }
 // The process boundary can lose its response after a durable claim.
 ticket=await pending();count=teams.requests.length
 await app.db.prepare("UPDATE sla_alerts SET teams_state='sending',teams_started_at=? WHERE id=?").bind(start-3600001,ticket.alert.id).run()
 await app.configure({});await settle()
 assert.equal((await alerts(ticket.id)).find(a=>a.id===ticket.alert.id).teams_state,'uncertain')
 assert.equal(teams.requests.length,count)
 await patch(ticket.id,{status_id:'solved'})
 await ok(`/sla-policies/${policy.id}`,{active:false,teams_connection_id:null,teams_connection_version:null},'PATCH')
 await ok(`/sla-policies/${original.id}`,{active:true},'PATCH');await clock(initial)
}
