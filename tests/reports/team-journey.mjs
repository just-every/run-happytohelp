import assert from 'node:assert/strict'
import {assistantApp} from '../helpers/ai/app.mjs'
import {openaiToolCall} from '../helpers/openai-stream.mjs'
import {startApp} from '../journeys/kit/app.mjs'
import {seedReportFixture,reportDates,reportStart,reportEnd,insert} from '../helpers/reports-team-fixture.mjs'

export async function teamReportsJourney(){
 await publicCohort()
 const sent=[]
 const app=await startApp({captureQueue:true,bindings:{EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'fixture-key',EMAIL_FROM:'support@example.test'},outbound:async(request,entry)=>{assert.equal(new URL(request.url).hostname,'api.resend.com');sent.push(JSON.parse(entry.body));return Response.json({id:'report-mail-'+sent.length})}})
 try{
  const w=await app.seedWorkspace('team-reports'),p=w.projectId,base=`/api/dashboard/projects/${p}`
  const fixture=await seedReportFixture(app.db,p)
  await seedBreakdownEvidence(app,p,fixture)
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
  assertBreakdowns(report,fixture,company.id,accountTickets)
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
  for(const [dimension,property,labels] of [['form','byForm',{returns:'Returns',delivery:'Delivery',null:'No form'}],['intent','byIntent',{refund:'refund',tracking:'tracking',null:'Unknown intent'}]]){
   const expected=new Map()
   for(const session of fixture.timerRows){
    const ticket=fixture.tickets.find(t=>t.id===session.conversation_id),id=ticket[dimension]
    const row=expected.get(id)??{id,label:labels[id],duration_ms:0,sessions:0}
    row.duration_ms+=session.ended_at-session.started_at;row.sessions++;expected.set(id,row)
   }
   const ordered=rows=>rows.slice().sort((a,b)=>String(a.id).localeCompare(String(b.id)))
   assert.deepEqual(ordered(report.handleTime[property]),ordered([...expected.values()]),dimension+' durations, session counts and unattributed work')
   assert.equal(report.handleTime[property].reduce((n,r)=>n+r.duration_ms,0),totalMs,dimension+' reconciles all handle time')
  }
  const filtered=await get(`&teamId=${p}-team-1&brandId=ridgeline-us`)
  assert.equal(filtered.denominators.cohort,raw.filter(t=>t.group_id===`${p}-team-1`&&t.brand_id==='ridgeline-us').length)
  await app.db.prepare('INSERT INTO reporting_legacy_conversations VALUES(?,?,?)').bind(p,fixture.tickets[3].id,'fixture-legacy').run()
  assert.equal((await get()).denominators.cohort,raw.length-1)
  assert.equal((await get('&includeImported=true')).denominators.imported,1)
  assert.equal((await get('&includeImported=true')).denominators.cohort,raw.length)
  // Older import defaults could append an unattributed legacy status row. It
  // does not prove a native resolution cycle, even when its categories differ.
  await app.db.prepare("INSERT INTO ticket_history(id,project_id,conversation_id,actor_id,actor_type,source,at,changes_json) VALUES(?,?,?,NULL,'system','legacy',?,?)").bind('legacy-import-initialization',p,fixture.tickets[3].id,fixture.tickets[3].created_at,JSON.stringify({status_category:{from:'new',to:'solved'}})).run()
  const withLegacyInitialization=await get('&includeImported=true')
  assert.equal(withLegacyInitialization.reopens.imported_history_unknown,1)
  assert.equal(withLegacyInitialization.reopens.denominator,report.reopens.denominator,'unattributed legacy initialization cannot increase the known-resolution denominator')
  assert.equal(withLegacyInitialization.breakdowns.channel.find(row=>row.id===fixture.tickets[3].channel).reopens.historyUnknown,1)
  await app.db.prepare("INSERT INTO ticket_history(id,project_id,conversation_id,actor_id,actor_type,source,at,changes_json) VALUES(?,?,?,NULL,'system','legacy',?,?)").bind('legacy-import-unattributed-reopen',p,fixture.tickets[3].id,fixture.tickets[3].created_at+1,JSON.stringify({status_category:{from:'solved',to:'open'}})).run()
  const uncertainHistory=await get('&includeImported=true')
  assert.equal(uncertainHistory.reopens.imported_history_unknown,1)
  assert.equal(uncertainHistory.reopens.denominator,report.reopens.denominator)
  assert.equal(uncertainHistory.reopens.reopened,report.reopens.reopened,'unknown history is excluded from both halves of the known-history rate')
  assert.equal(uncertainHistory.reopens.events,report.reopens.events+1,'the raw recorded event remains inspectable')
  assert.equal(uncertainHistory.breakdowns.channel.find(row=>row.id===fixture.tickets[3].channel).reopens.reopened,report.breakdowns.channel.find(row=>row.id===fixture.tickets[3].channel).reopens.reopened)


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
  for(const dimension of Object.keys(expected.breakdowns))for(let i=0;i<expected.breakdowns[dimension].length;i++){
   const row=expected.breakdowns[dimension][i]
   for(const path of ['tickets','firstResponse.count','firstResponse.median','firstResolution.count','csat.positive','csat.rated','ai.handedOff','ai.failed','ai.uncertain','sla.resolution.denominator','reopens.denominator','reopens.reopened']){const value=path.split('.').reduce((value,key)=>value[key],row);assert.ok(csv.includes(`"breakdowns.${dimension}.${i}.${path}","${value===null?'null':value}"`),'scheduled CSV includes '+dimension+' '+path)}
  }
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


// Historical observation timestamps cannot be produced by today's clock. The
// independent fixture records known durations, cycles and provider attempts;
// every reduction and scheduled export is read through the public report door.
async function seedBreakdownEvidence(app,p,fixture){
 const statements=[]
 for(const [i,t] of fixture.tickets.entries()){
  const response=(i%4+1)*1000,resolved=t.wasResolved?(i%5+1)*60000:null
  statements.push(insert('messages',{id:t.id+'-answer',project_id:p,conversation_id:t.id,local_id:t.id+'-answer',actor_id:t.assigned_to,actor_role:'operator',content:'Historical answer',revision:2,created_at:t.created_at+response}))
  statements.push(insert('conversation_tracking',{conversation_id:t.id,project_id:p,initial_history_complete:1,cycle_history_complete:1,cycle_start_at:t.created_at,first_resolved_at:resolved===null?null:t.created_at+resolved}))
  if(t.wasResolved){
   const outcome=i%8===0?'ai':i%4===0?'human':'unknown',rating=i%8===0?1:-1
   statements.push(insert('conversation_resolutions',{id:t.id+'-cycle',project_id:p,conversation_id:t.id,contact_id:t.contact_id,ordinal:1,resolved_at:t.created_at+resolved,resolved_revision:2,cycle_start_revision:0,outcome,evidence_json:'{}',reopened_at:t.reopened?t.created_at+resolved+1000:null}))
   if(i%4===0)statements.push(insert('conversation_ratings',{resolution_id:t.id+'-cycle',value:rating,comment:'',updated_at:t.created_at+resolved+100,revision:1}))
  }
  if(i%9===0)statements.push(insert('conversation_handoffs',{id:t.id+'-handoff',project_id:p,conversation_id:t.id,agent_id:t.assigned_to,revision:2,created_at:t.created_at+1000,cycle_epoch:0}))
  if(i%7===0)for(const state of ['failed','uncertain'])statements.push(insert('ai_generations',{id:t.id+'-'+state,project_id:p,conversation_id:t.id,state,source_revision:1,actor_json:'{}',model:'synthetic-happytohelp-1',ai_id:'synthetic-happytohelp-2',ai_profile_json:'{}',created_at:new Date(t.created_at).toISOString(),updated_at:new Date(t.created_at).toISOString()}))
 }
 for(let i=0;i<statements.length;i+=80)await app.db.batch(statements.slice(i,i+80).map(sql=>app.db.prepare(sql)))
}
function assertBreakdowns(report,fixture,companyId,accountTickets){
 const oracle=values=>{const sorted=values.sort((a,b)=>a-b),n=sorted.length;return {count:n,median:n?(sorted[Math.floor((n-1)/2)]+sorted[Math.floor(n/2)])/2:null,p90:n?sorted[Math.ceil(.9*n)-1]:null}}
 for(const [dimension,column] of [['agent','assigned_to'],['team','group_id'],['channel','channel'],['brand','brand_id'],['tag',null],['account',null]])for(const row of report.breakdowns[dimension]){
  const indices=fixture.tickets.flatMap((t,i)=>(dimension==='account'?(row.id===companyId?accountTickets.includes(t):!accountTickets.includes(t)):dimension==='tag'?row.id===`${t.project_id}-tag-${['billing','delivery','login'][i%3]}`:t[column]===row.id)?[i]:[])
  assert.equal(row.tickets,indices.length,dimension+' complete ticket count')
  assert.deepEqual(row.firstResponse,oracle(indices.map(i=>(i%4+1)*1000)),dimension+' first responses')
  assert.deepEqual(row.firstResolution,oracle(indices.filter(i=>fixture.tickets[i].wasResolved).map(i=>(i%5+1)*60000)),dimension+' first resolutions')
  const wasResolved=indices.filter(i=>fixture.tickets[i].wasResolved).length,reopened=indices.filter(i=>fixture.tickets[i].reopened).length
  assert.deepEqual(row.reopens,{resolved:wasResolved,denominator:wasResolved,reopened,events:reopened,historyUnknown:0,rate:wasResolved?reopened/wasResolved:null},dimension+' reopen numerator and denominator')
  const workload=report.workload[dimension].find(candidate=>candidate.id===row.id),ages=indices.filter(i=>!['solved','closed'].includes(fixture.tickets[i].status_category)).map(i=>report.generatedAt-fixture.tickets[i].created_at)
  assert.equal(workload.oldest_age_ms,ages.length?Math.max(0,...ages):null,dimension+' oldest backlog age')
  assert.deepEqual(workload.ageBuckets.map(bucket=>bucket.count),[ages.filter(ms=>ms<86400000).length,ages.filter(ms=>ms>=86400000&&ms<259200000).length,ages.filter(ms=>ms>=259200000&&ms<604800000).length,ages.filter(ms=>ms>=604800000&&ms<2592000000).length,ages.filter(ms=>ms>=2592000000).length],dimension+' backlog age buckets')
  const rated=indices.filter(i=>i%4===0).length,positive=indices.filter(i=>i%8===0).length
  assert.deepEqual(row.csat,{rated,positive,rate:rated?positive/rated:null},dimension+' latest-cycle CSAT')
  assert.equal(row.ai.handedOff,0,'historical generic assignments do not establish AI causality');assert.equal(row.ai.closed,positive);assert.equal(row.ai.assignmentHandoffs,indices.filter(i=>i%9===0).length)
  assert.equal(row.ai.failed,indices.filter(i=>i%7===0).length);assert.equal(row.ai.uncertain,row.ai.failed)
  assert.equal(row.ai.outcomeUnknown,indices.filter(i=>!['solved','closed'].includes(fixture.tickets[i].status_category)).length)
  for(const metric of ['first_response','next_response','resolution']){
   const clocks=indices.flatMap(i=>JSON.parse(fixture.slaRows[i].state_json).clocks).filter(c=>c.metric===metric),denominator=clocks.length,breached=clocks.filter(c=>c.breached).length,met=denominator-breached
   assert.deepEqual(row.sla[metric],{met,breached,pending:0,denominator,rate:denominator?met/denominator:null},dimension+' SLA '+metric)
  }
 }
}


// The historical fixture above qualifies distributions. This independent cohort
// creates its business evidence through public doors; only the provider edge and
// the initial signed-in workspace are fixtures. No report rows are seeded.
export async function publicCohort(){
 const a=await assistantApp({bindings:{OPENAI_API_KEY:'synthetic-happytohelp-1',H2H_LOCAL:'true',EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'synthetic-happytohelp-2',EMAIL_FROM:'support@example.test',INBOUND_EMAIL_TOKEN:'synthetic-happytohelp-3'}})
 const {app,p,ai,owner,workspace:w}=a,sent=[],base=`/api/dashboard/projects/${p}`
 ai.network=async request=>{const host=new URL(request.url).hostname;if(host==='cloudflare-dns.com')return Response.json({Status:0,Answer:[{type:15,data:'10 mx.example.test.'}]});assert.equal(host,'api.resend.com');sent.push(await request.json());return Response.json({id:crypto.randomUUID()})}
 const door=(path,body,method)=>app.ok(base+path,{token:owner,...(body===undefined?{}:{body}),...(method?{method}:{})})
 const ticket=async id=>(await door(`/conversations/${id}/ticket`)).data
 const status=async(id,status_id)=>{const t=await ticket(id);return door(`/conversations/${id}/ticket`,{status_id,expected_version:t.ticket_version},'PATCH')}
 const transcript=(id,token=owner)=>app.ok(`/api/conversations/${id}/messages`,{token})
 const humanReply=async(id,content)=>{const current=await transcript(id);return app.ok(`/api/conversations/${id}/messages`,{token:owner,body:{localId:crypto.randomUUID(),content,expectedRevision:current.revision,expectedLastMessageId:current.lastMessageId,authoring:{kind:'human'}}})}
 try{
  const calendar=(await door('/workflow-calendars',{name:'Always open',timezone:'UTC',weekly:[0,1,2,3,4,5,6].map(day=>({day,start:'00:00',end:'24:00'})),holidays:'none',closures:[]})).data
  await door('/sla-policies',{name:'One minute',calendar_id:calendar.id,position:1,conditions:{},first_response_minutes:1,next_response_minutes:1,resolution_minutes:1,pause_on_hold:false,approaching_minutes:0,backup_user_ids:[]})
  const answered=await a.visitor('AI answered');await answered.say('Where is my parcel?');ai.respond=()=> 'It ships tomorrow.';await app.drainJobs()
  assert.equal((await answered.transcript()).messages.filter(m=>m.actor_role==='ai').length,1)
  await status(answered.conversationId,'solved')
  const resolution=(await answered.transcript()).resolution;assert.equal(resolution.outcome,'ai')
  await app.ok(`/api/conversations/${answered.conversationId}/widget-events`,{token:answered.token,body:{action:'rateResolution',data:{resolutionId:resolution.id,value:1,recovery:'recovered'}}})
  ai.respond=()=>openaiToolCall('switch_agent',{agent_id:'human'},'cohort-handoff')
  const handed=await a.visitor('Human requested');await handed.say('I need a person');await app.drainJobs()
  assert.ok((await ticket(handed.conversationId)).assigned_to)
  await humanReply(handed.conversationId,'I arranged the replacement.');await status(handed.conversationId,'solved')
  const firstHandResolution=(await handed.transcript()).resolution
  await status(handed.conversationId,'open');await handed.say('One more question');await humanReply(handed.conversationId,'The replacement is tracked.');await status(handed.conversationId,'solved')
  assert.equal((await handed.transcript()).resolution.ordinal,2)
  await app.ok(`/api/management/projects/${p}/ai`,{token:owner,method:'PUT',body:{default_visitor_ai_id:'-',default_verified_user_ai_id:'-'}})
  await app.ok(`/api/management/projects/${p}/email-settings`,{token:owner,method:'PUT',body:{email_from_name:'Support',email_from_address:'support@example.test',inbound_address:'inbound@example.test',is_enabled:true}})
  const email=await app.ok('/api/integrations/email/inbound',{headers:{Authorization:'Bearer synthetic-happytohelp-3'},body:{messageId:'public-cohort-email',to:'inbound@example.test',from:'public-cohort@customer.example.test',text:'My parcel arrived damaged.'}})
  const emailId=email.conversationId,group=(await door('/ticket-groups',{name:'Cohort team',members:[w.users.operator,w.users.admin]})).data
  const emailTicket=await ticket(emailId);await door(`/conversations/${emailId}/ticket`,{group_id:group.id,expected_version:emailTicket.ticket_version},'PATCH')
  await door(`/conversations/${emailId}`,{ai_id:null,agent_id:w.users.operator},'PUT');await door(`/conversations/${emailId}`,{agent_id:w.users.admin},'PUT')
  await humanReply(emailId,'We have arranged a replacement.');await status(emailId,'solved')
  const unanswered=await a.visitor('Waiting');await unanswered.say('Please check my invoice.');await app.drainJobs()
  const company=(await door('/companies',{name:'Explicit cohort account'})).company
  for(const contact of [answered.contactId,handed.contactId])await door(`/companies/${company.id}/members/${contact}`,{},'PUT')
  await door(`/conversations/${handed.conversationId}/tags`,{name:'Cohort follow-up'})
  await door('/workflow-clock',{now:Date.now()+120000})
  const day=86400000,date=at=>new Date(at).toISOString().slice(0,10),url=`/reports/team?period=custom&start=${date(Date.now()-day)}&end=${date(Date.now()+2*day)}`
  const report=await door(url),all=[answered.conversationId,handed.conversationId,emailId,unanswered.conversationId]
  assert.equal(report.denominators.cohort,4);assert.equal(report.backlog.total,1)
  assert.equal(report.reopens.denominator,3);assert.equal(report.reopens.reopened,1);assert.equal(report.reopens.events,1)
  const widgets=report.breakdowns.channel.find(r=>r.id==='widget'),mail=report.breakdowns.channel.find(r=>r.id==='email')
  assert.deepEqual(widgets.recovery,{recovered:1,notRecovered:0,answered:1,unknown:2,rate:1});assert.deepEqual(mail.recovery,{recovered:0,notRecovered:0,answered:0,unknown:1,rate:null});assert.equal(widgets.tickets,3);assert.equal(mail.tickets,1);assert.equal(mail.csat.rated,0)
  assert.equal(widgets.csat.rated,1);assert.equal(widgets.csat.positive,1);assert.equal(widgets.ai.closed,1);assert.equal(widgets.ai.handedOff,1);assert.equal(mail.ai.handedOff,0,'ordinary human assignment is not an AI transfer')
  assert.ok(widgets.ai.outcomeUnknown>=1,'an unanswered request is never a verified AI resolution')
  assert.equal(widgets.reopens.denominator,2);assert.equal(widgets.reopens.reopened,1)
  assert.ok(widgets.sla.first_response.breached>=1,'the public local-clock door breaches the unanswered request')
  const response=[],resolved=[]
  for(const id of all){const t=await ticket(id),messages=(await transcript(id)).messages,q=messages.find(m=>m.actor_role==='contact'),reply=messages.find(m=>q&&m.revision>q.revision&&!['contact','system'].includes(m.actor_role));if(reply)response.push(reply.created_at-q.created_at)
   const r=id===handed.conversationId?firstHandResolution:(await transcript(id)).resolution;if(r)resolved.push(Date.parse(r.resolvedAt)-t.created_at)
  }
  const distribution=values=>{const s=values.sort((a,b)=>a-b);return {count:s.length,median:s.length%2?s[(s.length-1)/2]:(s[s.length/2-1]+s[s.length/2])/2,p90:s[Math.ceil(s.length*.9)-1]}}
  const native=report.breakdowns.brand.find(r=>r.id===p);assert.deepEqual(native.firstResponse,distribution(response));assert.deepEqual(native.firstResolution,distribution(resolved))
  assert.equal(report.breakdowns.team.find(r=>r.id===group.id).tickets,1)
  assert.equal(report.breakdowns.agent.find(r=>r.id===w.users.admin).tickets,1)
  assert.equal(report.breakdowns.account.find(r=>r.id===company.id).tickets,2)
  assert.equal(report.breakdowns.tag.find(r=>r.label==='Cohort follow-up').reopens.reopened,1)
  const importedAt=new Date(Date.now()-3600000).toISOString(),imports=`/api/move-in/projects/${p}/imports`,source=[
   {user:{id:71,role:'end-user',name:'Imported customer',email:'imported-cohort@customer.example.test',created_at:importedAt}},
   {ticket:{id:72,requester_id:71,subject:'Imported solved request',status:'solved',via:{channel:'email'},created_at:importedAt,updated_at:importedAt,comments:[{id:73,author_id:71,body:'Historical question',public:true,created_at:importedAt}]}}]
  const callsBeforeImport=ai.calls.length,uploaded=await app.ok(imports+'?vendor=zendesk',{token:owner,raw:true,headers:{'X-Import-Filename':'report-cohort.jsonl','Content-Type':'application/octet-stream'},body:source.map(JSON.stringify).join('\n')})
  await app.drainJobs();const ready=(await app.ok(imports+'/'+uploaded.data.id,{token:owner})).data;assert.equal(ready.state,'ready');assert.equal(ready.plan.counts.rejected,0)
  await app.ok(imports+'/'+ready.id+'/apply',{token:owner,body:{fingerprint:ready.plan.fingerprint}});await app.drainJobs();assert.equal(ai.calls.length,callsBeforeImport,'import never starts assistant work')
  assert.equal((await door(url)).denominators.cohort,4,'imported history stays excluded by default')
  const included=await door(url+'&includeImported=true');assert.equal(included.denominators.cohort,5);assert.equal(included.denominators.imported,1);assert.equal(included.reopens.imported_history_unknown,1);assert.equal(included.reopens.denominator,3)
  const importedId=included.workload.channel.find(r=>r.id==='email');assert.equal(importedId.incoming,2)
  const importedTicket=ready.plan.decisions.find(item=>item.kind==='ticket').targets.find(item=>item.kind==='conversation').id
  const prior=await ticket(importedTicket);await door(`/conversations/${importedTicket}/ticket`,{priority:'high',expected_version:prior.ticket_version},'PATCH')
  assert.equal((await door(url+'&includeImported=true')).reopens.imported_history_unknown,1,'an ordinary field edit cannot invent missing lifecycle history')
  await status(importedTicket,'open');const observed=await door(url+'&includeImported=true');assert.equal(observed.reopens.denominator,4);assert.equal(observed.reopens.reopened,2);assert.equal(observed.reopens.imported_history_unknown,0)
  const csv=await app.call(base+url+'&format=summary.csv',{token:owner,status:200});assert.ok(csv.data.includes('"denominators.cohort","4"'))
  const schedule=await door('/report-schedules',{name:'Daily public cohort',frequency:'daily',hour:0,recipients:[w.users.owner,w.users.admin],includeImported:true})
  const scheduledAt=Date.now(),scheduleStart=date(scheduledAt),scheduleEnd=date(scheduledAt+day)
  const created=await Promise.all([...all,importedTicket].map(async id=>({id,at:(await ticket(id)).created_at})))
  const scheduledCohort=created.filter(row=>row.at>=Date.parse(scheduleStart)&&row.at<Date.parse(scheduleEnd)).map(row=>row.id)
  const scheduledReopens=scheduledCohort.filter(id=>id===handed.conversationId||id===importedTicket).length
  // Advance only the delivery-window fixture; every ticket, assignment, rating,
  // native lifecycle event and schedule was admitted through its public route.
  await app.db.prepare('UPDATE report_schedules SET window_date=?,next_run_at=? WHERE id=?').bind(scheduleEnd,scheduledAt-1,schedule.id).run()
  await app.ok(`/api/management/projects/${p}/agents/${w.users.admin}`,{token:owner,method:'PUT',body:{role:'collaborator'}})
  await app.scheduled();const queued=await app.takeJobs(),delivery=queued.find(job=>job.type==='reports.schedule');assert.ok(delivery);for(let pass=0;pass<3;pass++)await app.runJobs([delivery])
  const reports=sent.filter(mail=>mail.attachments?.some(file=>file.filename.startsWith('team-report-')));assert.equal(reports.length,1);assert.deepEqual(reports[0].to,['owner-ai@example.test'],'a revoked recipient receives no private report')
  const delivered=Buffer.from(reports[0].attachments[0].content,'base64').toString('utf8')
  // The daily report has its own calendar window. A one-hour-old import may
  // belong to yesterday even though the wider interactive cohort contains it.
  const mailedReport=await door(`/reports/team?period=custom&start=${scheduleStart}&end=${scheduleEnd}&includeImported=true`)
  for(const dimension of ['agent','team','channel','brand','account','tag'])for(const [index,row] of mailedReport.breakdowns[dimension].entries())for(const [metric,value] of Object.entries(row.recovery))assert.ok(delivered.includes(`"breakdowns.${dimension}.${index}.recovery.${metric}","${value===null?'null':value}"`),'scheduled recovery '+dimension+' '+metric)
  for(const [key,value] of [['denominators.cohort',scheduledCohort.length],['denominators.imported',Number(scheduledCohort.includes(importedTicket))],['backlog.total',2],['reopens.denominator',scheduledCohort.filter(id=>id!==unanswered.conversationId).length],['reopens.reopened',scheduledReopens],['reopens.events',scheduledReopens]])assert.ok(delivered.includes(`"${key}","${value}"`),'scheduled public cohort '+key)
  console.log(JSON.stringify({proof:'public-door multichannel report cohort',tickets:5,nativeTickets:4,importedTickets:1,nativeChannels:['widget','email'],firstResponse:native.firstResponse,firstResolution:native.firstResolution,reopens:report.reopens,providerBoundary:'network-edge fixture; no live delivery'}))
 }finally{await a.close()}
}
