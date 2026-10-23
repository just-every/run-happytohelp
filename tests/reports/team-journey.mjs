import assert from 'node:assert/strict'
import {startApp} from '../journeys/kit/app.mjs'
import {seedReportFixture,reportDates,reportStart,reportEnd} from '../helpers/reports-team-fixture.mjs'

export async function teamReportsJourney(){
 const sent=[]
 const app=await startApp({captureQueue:true,bindings:{EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'fixture-key',EMAIL_FROM:'support@example.test'},outbound:async(request,entry)=>{assert.equal(new URL(request.url).hostname,'api.resend.com');sent.push(JSON.parse(entry.body));return Response.json({id:'report-mail-'+sent.length})}})
 try{
  const w=await app.seedWorkspace('team-reports'),p=w.projectId,base=`/api/dashboard/projects/${p}`
  const fixture=await seedReportFixture(app.db,p)
  const query=new URLSearchParams({period:'custom',...reportDates});query.delete('timezone')
  const url=`${base}/reports/team?${query}`
  const get=async suffix=>app.ok(url+(suffix||''),{token:w.tokens.owner})
  const company=(await app.ok(`/api/dashboard/projects/${p}/companies`,{token:w.tokens.owner,body:{name:'Ridgeline account'}})).company
  const accountTickets=fixture.tickets.slice(0,3)
  for(const t of accountTickets)await app.ok(`/api/dashboard/projects/${p}/companies/${company.id}/members/${t.contact_id}`,{token:w.tokens.owner,method:'PUT',body:{}})
  const report=await get()
  const accountRows=report.workload.account
  const linked=accountRows.find(row=>row.id===company.id)
  assert.equal(linked.incoming,accountTickets.length)
  assert.equal(linked.resolved,accountTickets.filter(t=>['solved','closed'].includes(t.status_category)).length)
  assert.equal(accountRows.reduce((n,row)=>n+row.incoming,0),fixture.tickets.length)
  assert.equal(accountRows.find(row=>row.id===null).label,'No account')
  assert.equal(report.denominators.cohort,fixture.tickets.length)
  assert.equal(report.range.startAt,reportStart);assert.equal(report.range.endAt,reportEnd)
  const raw=await app.sql('SELECT c.*,EXISTS(SELECT 1 FROM ticket_history h WHERE h.conversation_id=c.id AND json_extract(h.changes_json,\'$.status_category.from\')=\'solved\' AND json_extract(h.changes_json,\'$.status_category.to\')=\'open\') reopened FROM conversations c WHERE c.project_id=?',p)
  for(const [group,column] of [['agent','assigned_to'],['team','group_id'],['channel','channel'],['brand','brand_id']]){
   for(const row of report.workload[group]){const tickets=raw.filter(t=>t[column]===row.id);assert.equal(row.incoming,tickets.length,`${group} incoming`);assert.equal(row.resolved,tickets.filter(t=>['solved','closed'].includes(t.status_category)).length,`${group} resolved`);assert.equal(row.backlog,tickets.filter(t=>!['solved','closed'].includes(t.status_category)).length,`${group} backlog`)}
   assert.equal(report.workload[group].reduce((n,r)=>n+r.incoming,0),raw.length)
  }
  for(const row of report.workload.tag){const n=await app.first('SELECT count(*) n FROM conversation_tags WHERE project_id=? AND tag_id=?',p,row.id);assert.equal(row.incoming,n.n)}
  assert.equal(report.backlog.total,raw.filter(t=>!['solved','closed'].includes(t.status_category)).length)
  assert.equal(report.backlog.buckets.reduce((n,r)=>n+r.count,0),report.backlog.total)
  const age=raw.filter(t=>!['solved','closed'].includes(t.status_category)).map(t=>report.generatedAt-t.created_at)
  assert.deepEqual(report.backlog.buckets.map(b=>b.count),[age.filter(x=>x<86400000).length,age.filter(x=>x>=86400000&&x<259200000).length,age.filter(x=>x>=259200000&&x<604800000).length,age.filter(x=>x>=604800000&&x<2592000000).length,age.filter(x=>x>=2592000000).length])
  for(const metric of ['first_response','next_response','resolution']){const clocks=fixture.slaRows.flatMap(s=>JSON.parse(s.state_json).clocks).filter(c=>c.metric===metric),breached=clocks.filter(c=>c.breached).length;assert.deepEqual(report.sla[metric],{met:clocks.length-breached,breached,pending:0,total:clocks.length,denominator:clocks.length,rate:(clocks.length-breached)/clocks.length})}
  assert.equal(report.reopens.reopened,raw.filter(t=>t.reopened).length)
  assert.equal(report.reopens.rate,fixture.tickets.filter(t=>t.reopened).length/fixture.tickets.filter(t=>t.wasResolved).length)
  const totalMs=fixture.timerRows.reduce((n,t)=>n+t.ended_at-t.started_at,0)
  assert.equal(report.handleTime.total_ms,totalMs)
  assert.equal(report.handleTime.byAgent.reduce((n,r)=>n+r.duration_ms,0),totalMs)
  const filtered=await get(`&teamId=${p}-team-1&brandId=ridgeline-us`)
  assert.equal(filtered.denominators.cohort,raw.filter(t=>t.group_id===`${p}-team-1`&&t.brand_id==='ridgeline-us').length)
  await app.db.prepare('INSERT INTO reporting_legacy_conversations VALUES(?,?,?)').bind(p,fixture.tickets[3].id,'fixture-legacy').run()
  assert.equal((await get()).denominators.cohort,raw.length-1)
  assert.equal((await get('&includeImported=true')).denominators.imported,1)
  assert.equal((await get('&includeImported=true')).denominators.cohort,raw.length)
  const exported=await app.call(url+'&format=summary.csv',{token:w.tokens.owner,status:200})
  assert.ok(exported.data.includes('"denominators.cohort","425"'))
  assert.ok(exported.data.includes(`"handleTime.total_ms","${totalMs-fixture.timerRows.find(t=>t.conversation_id===fixture.tickets[3].id).ended_at+fixture.timerRows.find(t=>t.conversation_id===fixture.tickets[3].id).started_at}"`))
  await app.db.prepare("INSERT INTO member_roles(project_id,user_id,role_key,assigned_at) VALUES(?,?,'collaborator',1)").bind(p,w.users.operator).run()
  await app.call(url,{token:w.tokens.operator,status:403});await app.call(`${base}/conversations/${fixture.tickets[1].id}/timer`,{token:w.tokens.operator,status:403})
  const timerPath=`${base}/conversations/${fixture.tickets[1].id}/timer`
  const running=await app.ok(timerPath+'/start',{token:w.tokens.owner,body:{}})
  assert.ok(running.running)
  await app.ok(timerPath+'/stop',{token:w.tokens.owner,body:{}})
  await app.ok(timerPath+'/adjust',{token:w.tokens.owner,body:{sessionId:running.running,durationMs:900000,reason:'Included the phone follow-up'}})
  assert.equal((await app.ok(timerPath,{token:w.tokens.owner})).totalMs,900000)
  await app.ok(timerPath+'/start',{token:w.tokens.owner,body:{}})
  const ticket=(await app.ok(`${base}/conversations/${fixture.tickets[1].id}/ticket`,{token:w.tokens.owner})).data
  await app.ok(`${base}/conversations/${ticket.id}/ticket`,{token:w.tokens.owner,method:'PATCH',body:{status_id:'solved',expected_version:ticket.ticket_version}})
  assert.equal((await app.ok(timerPath,{token:w.tokens.owner})).running,null)
  const schedule=await app.ok(base+'/report-schedules',{token:w.tokens.owner,body:{name:'Weekly team report',frequency:'weekly',hour:9,weekday:1,recipients:[w.users.owner,w.users.admin],includeImported:true}})
  const now=Date.now()
  await app.db.prepare('UPDATE report_schedules SET window_date=?,next_run_at=? WHERE id=?').bind('2026-10-20',now-1000,schedule.id).run()
  await app.db.prepare("INSERT INTO member_roles(project_id,user_id,role_key,assigned_at) VALUES(?,?,'collaborator',1)").bind(p,w.users.admin).run()
  // The cron-to-queue door owns discovery; the queue owns the complete export.
  await app.scheduled()
  const queued=await app.takeJobs();assert.ok(queued.some(job=>job.type==='reports.schedule'),'cron hands scheduled exports to their own invocation')
  await app.runJobs([queued.find(job=>job.type==='reports.schedule')])
  await app.runJobs([{type:'reports.schedule',id:'scheduled-reports',projectId:'installation'}])
  await app.runJobs([{type:'reports.schedule',id:'scheduled-reports',projectId:'installation'}])
  const reportMail=sent.filter(mail=>mail.attachments?.some(file=>file.filename.startsWith('team-report-')))
  assert.equal(reportMail.length,1)
  assert.deepEqual(reportMail[0].to,[`owner-team-reports@example.test`])
  assert.ok(!reportMail.some(m=>m.to.some(email=>email.endsWith('@customer.example.test'))))
  const csv=Buffer.from(reportMail[0].attachments[0].content,'base64').toString('utf8')
  const expected=await app.ok(`${base}/reports/team?period=custom&start=2026-10-13&end=2026-10-20&includeImported=true`,{token:w.tokens.owner})
  assert.ok(csv.includes(`"denominators.cohort","${expected.denominators.cohort}"`))
  for(const dimension of ['agent','team','channel','brand','tag','account'])for(let i=0;i<expected.workload[dimension].length;i++)for(const key of ['incoming','resolved','backlog'])assert.ok(csv.includes(`"workload.${dimension}.${i}.${key}","${expected.workload[dimension][i][key]}"`))
  for(const metric of ['first_response','next_response','resolution'])for(const key of ['met','breached','pending','total','denominator','rate'])assert.ok(csv.includes(`\"sla.${metric}.${key}\",\"${expected.sla[metric][key]===null?'null':expected.sla[metric][key]}\"`))
  for(const key of ['resolved','denominator','reopened','events','rate'])assert.ok(csv.includes(`\"reopens.${key}\",\"${expected.reopens[key]===null?'null':expected.reopens[key]}\"`))
  for(const key of ['total_ms','session_count'])assert.ok(csv.includes(`\"handleTime.${key}\",\"${expected.handleTime[key]}\"`))
  const deliveries=await app.sql('SELECT state FROM report_schedule_deliveries WHERE schedule_id=?',schedule.id)
  assert.deepEqual(deliveries.map(r=>r.state).sort(),['sent','skipped'])
  const erasedContact=fixture.tickets[1].contact_id
  await app.ok(`/api/management/projects/${p}/contacts/${erasedContact}/erase`,{token:w.tokens.owner,body:{}})
  assert.equal((await app.first('SELECT count(*) n FROM ticket_handle_sessions WHERE conversation_id=?',ticket.id)).n,0)
  assert.ok((await app.first("SELECT count(*) n FROM audit_events WHERE project_id=? AND action LIKE 'reports.schedule.%'",p)).n>=3)
  const custody=await timerCustody(app)
  console.log(JSON.stringify({proof:'R10 team reconciliation',custody,tickets:raw.length,workload:report.workload,backlog:report.backlog,sla:report.sla,reopens:report.reopens,handleTimeMs:totalMs,scheduledMail:reportMail.length,deliveryStates:deliveries.map(r=>r.state)}))
 }finally{await app.close()}
}

// A member who loses ticket access stops accruing handle time: a lead stops a teammate's timer by naming it,
// and downgrading or removing a member ends their running timers, so the team report's handle time freezes.
// A lead's Stop on their own timer never ends a teammate's.
async function timerCustody(app){
 const w=await app.seedWorkspace('timer-custody'),p=w.projectId,base=`/api/dashboard/projects/${p}`
 const ticket=async name=>{const visitor=await app.ok('/api/identity/widget/session',{body:{widgetKey:w.widgetKey,name,email:`${name}@customer.example.test`},headers:{Origin:w.allowedOrigin}}),created=await app.ok('/api/conversations',{body:{projectId:p,contactId:visitor.contactId},token:visitor.token});await app.ok(`/api/conversations/${created.id}/messages`,{body:{localId:name,content:'Where is my parcel?',expectedRevision:0},token:visitor.token});return `${base}/conversations/${created.id}/timer`}
 const day=86400000,today=Date.parse(new Date().toISOString().slice(0,10)),date=at=>new Date(at).toISOString().slice(0,10)
 const handled=async userId=>(await app.ok(`${base}/reports/team?period=custom&start=${date(today-day)}&end=${date(today+2*day)}`,{token:w.tokens.owner})).handleTime.byAgent.find(row=>row.id===userId)?.duration_ms
 const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))
 const stopRow=sessionId=>app.first("SELECT actor_id,json_extract(changes_json,'$.handle_timer.reason') reason FROM ticket_history WHERE id=?",'timer:stop:'+sessionId)
 const frozen=async(userId,timer)=>{
  const session=await app.first('SELECT id,ended_at FROM ticket_handle_sessions WHERE project_id=? AND user_id=? ORDER BY started_at DESC LIMIT 1',p,userId)
  assert.ok(session.ended_at,'the running timer is ended');assert.deepEqual({...await stopRow(session.id)},{actor_id:userId,reason:'operator'})
  const first=await handled(userId);await pause(2000);const second=await handled(userId)
  assert.ok(first>=0);assert.equal(second,first,'handle time stops growing');await app.call(timer+'/stop',{token:w.tokens.owner,body:{sessionId:session.id},status:409})
  return first
 }
 const [first,second]=[await ticket('custody-one'),await ticket('custody-two')]
 // Concurrent timers: the admin's Stop ends only the admin's own timer; the agent's keeps running and accruing.
 const agentSession=(await app.ok(first+'/start',{token:w.tokens.operator,body:{}})).running,adminSession=(await app.ok(first+'/start',{token:w.tokens.admin,body:{}})).running
 await app.call(first+'/stop',{token:w.tokens.operator,body:{sessionId:adminSession},status:409})
 assert.equal((await app.ok(first+'/stop',{token:w.tokens.admin,body:{}})).running,null)
 assert.equal((await app.ok(first,{token:w.tokens.operator})).running,agentSession,'the agent\'s timer keeps running')
 assert.deepEqual({...await stopRow(adminSession)},{actor_id:w.users.admin,reason:'operator'})
 const growing=[await handled(w.users.operator)];await pause(1500);growing.push(await handled(w.users.operator))
 assert.ok(growing[1]>growing[0],'the agent\'s handle time keeps growing')
 // A lead stops a teammate's timer only by naming it; the stop is recorded as the lead's in history and audit.
 const ownerSession=(await app.ok(first+'/start',{token:w.tokens.owner,body:{}})).running
 assert.equal((await app.ok(first+'/stop',{token:w.tokens.admin,body:{sessionId:agentSession}})).running,null)
 assert.equal((await app.ok(first,{token:w.tokens.operator})).running,null)
 assert.equal((await app.ok(first,{token:w.tokens.owner})).running,ownerSession,'only the named session ends')
 assert.deepEqual({...await stopRow(agentSession)},{actor_id:w.users.admin,reason:'lead'})
 const audit=await app.sql("SELECT action,actor_id,target_type,target_id,detail_json FROM audit_events WHERE project_id=? AND id IN (?,?) ORDER BY id",p,'ticket:timer:stop:'+agentSession,'timer-lead-stop:'+agentSession)
 assert.deepEqual(audit.map(row=>[row.action,row.actor_id,row.target_type,row.target_id]),[['ticket.updated',w.users.admin,'conversation',first.split('/').at(-2)],['ticket.handle_timer.lead_stopped',w.users.admin,'conversation',first.split('/').at(-2)]])
 assert.deepEqual(JSON.parse(audit[1].detail_json),{session_id:agentSession,member_id:w.users.operator})
 // A stop that ends nothing is a conflict, not a success.
 await app.call(first+'/stop',{token:w.tokens.operator,body:{},status:409})
 await app.call(first+'/stop',{token:w.tokens.admin,body:{sessionId:agentSession},status:409})
 await app.ok(first+'/stop',{token:w.tokens.owner,body:{}})
 // Downgraded to collaborator through the role door: the running timer ends with the role change.
 assert.ok((await app.ok(first+'/start',{token:w.tokens.operator,body:{}})).running)
 await app.ok(`/api/management/projects/${p}/agents/${w.users.operator}`,{token:w.tokens.owner,method:'PUT',body:{role:'collaborator'}})
 const downgraded=await frozen(w.users.operator,first)
 // Removed from the workspace: the running timer ends with the membership.
 assert.ok((await app.ok(second+'/start',{token:w.tokens.admin,body:{}})).running)
 await app.ok(`/api/management/projects/${p}/agents/${w.users.admin}`,{token:w.tokens.owner,method:'DELETE'})
 const removed=await frozen(w.users.admin,second)
 return {agentGrowingMs:growing,downgradedMs:downgraded,removedMs:removed}
}
