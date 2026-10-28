import assert from 'node:assert/strict'
import {assistantApp} from '../helpers/ai/app.mjs'
import {openaiToolCall} from '../helpers/openai-stream.mjs'

// The historical fixture above qualifies distributions. This independent cohort
// creates its business evidence through public doors; only the provider edge and
// the initial signed-in workspace are fixtures. No report rows are seeded.
export async function supportOutcomesJourney(){
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
  assert.equal(firstHandResolution.outcome,'human')
  const rate=(resolutionId,value,comment,token=handed.token,status=200)=>app.call(`/api/conversations/${handed.conversationId}/widget-events`,{token,body:{action:'rateResolution',data:{resolutionId,value,comment}},status})
  await rate(firstHandResolution.id,1,'Initial feedback')
  await rate(firstHandResolution.id,-1,'Please explain further')
  const changed=(await handed.transcript()).resolution.rating
  assert.equal(changed.revision,2);assert.equal(changed.comment,'Please explain further');assert.equal(changed.recovery,'unknown')
  await rate(firstHandResolution.id,0,'Invalid value',handed.token,400)
  await rate(firstHandResolution.id,1,'x'.repeat(1001),handed.token,400)
  await rate(firstHandResolution.id,1,'Foreign visitor',answered.token,404)
  await rate(firstHandResolution.id,1,'Operator cannot rate',owner,403)
  await app.ok(`/api/outcomes/projects/${p}/settings`,{token:owner,method:'PUT',body:{enabled:false,widgetEnabled:true,scale:'five',locale:'es',delayMinutes:0,expiresDays:1}})
  assert.equal((await handed.transcript()).resolution.survey.scale,'thumbs','a settings edit does not reinterpret an existing cycle')
  await status(handed.conversationId,'open');await handed.say('One more question');await humanReply(handed.conversationId,'The replacement is tracked.');await status(handed.conversationId,'solved')
  const secondHandResolution=(await handed.transcript()).resolution
  assert.equal(secondHandResolution.ordinal,2);assert.equal(secondHandResolution.rating,null)
  assert.equal(secondHandResolution.survey.scale,'five');assert.equal(secondHandResolution.survey.locale,'es')
  await rate(firstHandResolution.id,1,'Old cycle',handed.token,409)
  const retained=(await door(`/conversations/${handed.conversationId}`)).data.resolutionHistory
  assert.deepEqual(retained.map(row=>[row.id,row.ordinal,row.rating.value,row.rating.comment,row.rating.revision]),[[firstHandResolution.id,1,-1,'Please explain further',2]])
  assert.ok(retained[0].reopenedAt)
  assert.equal('resolutionHistory' in await handed.transcript(),false,'only operators receive prior-cycle feedback')
  await app.ok(`/api/management/projects/${p}/ai`,{token:owner,method:'PUT',body:{default_visitor_ai_id:'-',default_verified_user_ai_id:'-'}})
  await app.ok(`/api/management/projects/${p}/email-settings`,{token:owner,method:'PUT',body:{email_from_name:'Support',email_from_address:'support@example.test',inbound_address:'inbound@example.test',is_enabled:true}})
  const email=await app.ok('/api/integrations/email/inbound',{headers:{Authorization:'Bearer synthetic-happytohelp-3'},body:{messageId:'public-cohort-email',to:'inbound@example.test',from:'public-cohort@customer.example.test',text:'My parcel arrived damaged.'}})
  const emailId=email.conversationId,group=(await door('/ticket-groups',{name:'Cohort team',members:[w.users.operator,w.users.admin]})).data
  const emailTicket=await ticket(emailId);await door(`/conversations/${emailId}/ticket`,{group_id:group.id,expected_version:emailTicket.ticket_version},'PATCH')
  await door(`/conversations/${emailId}`,{ai_id:null,agent_id:w.users.operator},'PUT');await door(`/conversations/${emailId}`,{agent_id:w.users.admin},'PUT')
  const timer=`/conversations/${emailId}/timer`
  const operatorTimer=(await door(timer+'/start',{})).running
  assert.ok(operatorTimer)
  await door(timer+'/stop',{})
  await door(timer+'/adjust',{sessionId:operatorTimer,durationMs:900000,reason:'Included the phone follow-up'})
  assert.equal((await door(timer)).totalMs,900000)
  await humanReply(emailId,'We have arranged a replacement.');await status(emailId,'solved')
  const unanswered=await a.visitor('Waiting');await unanswered.say('Please check my invoice.');await app.drainJobs()
  const company=(await door('/companies',{name:'Explicit cohort account'})).company
  for(const contact of [answered.contactId,handed.contactId])await door(`/companies/${company.id}/members/${contact}`,{},'PUT')
  await door(`/conversations/${handed.conversationId}/tags`,{name:'Cohort follow-up'})
  await door('/workflow-clock',{now:Date.now()+120000})
  const day=86400000,date=at=>new Date(at).toISOString().slice(0,10),url=`/reports/team?period=custom&start=${date(Date.now()-day)}&end=${date(Date.now()+2*day)}`
  const report=await door(url),all=[answered.conversationId,handed.conversationId,emailId,unanswered.conversationId]
  assert.equal(report.denominators.cohort,4);assert.equal(report.backlog.total,1)
  assert.equal(report.handleTime.total_ms,900000)
  assert.equal(report.handleTime.byAgent.find(row=>row.id===w.users.owner).duration_ms,900000)
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
  // Follow-up work stays in these same tickets: the latest customer feedback is
  // independent of prior-cycle satisfaction, and erasure removes both histories.
  const fiveRate=score=>app.call(`/api/conversations/${handed.conversationId}/widget-events`,{token:handed.token,body:{action:'rateResolution',data:{resolutionId:secondHandResolution.id,score,comment:'x'.repeat(1000)}}})
  assert.equal((await fiveRate(5)).status,200)
  assert.equal((await handed.transcript()).resolution.rating.comment.length,1000)
  await app.ok(`/api/conversations/${handed.conversationId}/widget-events`,{token:handed.token,body:{action:'optOutResolutionSurveys',data:{resolutionId:secondHandResolution.id}}})
  assert.equal((await handed.transcript()).resolution.survey.optedOut,true)
  assert.equal((await fiveRate(4)).status,409)
  await app.db.prepare('UPDATE sessions SET expires_at=1 WHERE contact_id=?').bind(handed.contactId).run()
  assert.equal((await fiveRate(4)).status,401)
  await app.ok(`/api/management/projects/${p}/contacts/${handed.contactId}/erase`,{token:owner,body:{}})
  const erased=(await door(`/conversations/${handed.conversationId}`)).data
  assert.equal(erased.resolution.rating.comment,'')
  assert.ok(erased.resolutionHistory.every(row=>row.rating.comment===''))
  assert.equal((await app.first("SELECT COUNT(*) n FROM conversation_rating_history WHERE resolution_id IN (?,?) AND comment<>''",firstHandResolution.id,secondHandResolution.id)).n,0)
  const peer=(await answered.transcript()).resolution
  assert.equal(peer.rating.value,1);assert.equal(peer.rating.recovery,'recovered')
  await status(unanswered.conversationId,'solved')
  assert.equal((await unanswered.transcript()).resolution.outcome,'unknown','closing without visible answer evidence stays unknown')
  await status(unanswered.conversationId,'open');await unanswered.say('Can you explain the invoice?')
  await app.ok(`/api/management/projects/${p}/ai`,{token:owner,method:'PUT',body:{default_visitor_ai_id:'ai',default_verified_user_ai_id:'ai'}})
  ai.respond=body=>body.text?.format?.name==='agent_suggestion_alternatives'?{alternatives:[],missing_information:[]}:({user_goal:'Clarify the invoice',responses:[{button:'Clarify',icon:'circle-question-mark',response:'The invoice lists the replacement.',use_when:'',evidence_ids:[JSON.stringify(body).match(/message:[0-9a-f-]{36}/)[0]]}],missing_information:[]})
  const suggestion=await a.action(unanswered.conversationId,'agentAssist',{options:{request_id:crypto.randomUUID()}})
  assert.equal(suggestion.status,202)
  await app.drainJobs()
  const current=await unanswered.transcript(),command={localId:crypto.randomUUID(),content:'An edited explanation of your replacement invoice.',expectedRevision:current.revision,expectedLastMessageId:current.lastMessageId,authoring:{kind:'ai',generationId:suggestion.data.id,selection:0},resolve:true}
  const sentAnswer=await app.ok(`/api/conversations/${unanswered.conversationId}/messages`,{token:owner,body:command})
  assert.equal(sentAnswer.accepted,true)
  assert.equal((await unanswered.transcript()).resolution.outcome,'assisted')
  const replay=await app.ok(`/api/conversations/${unanswered.conversationId}/messages`,{token:owner,body:{...command,authoring:{kind:'human'}}})
  assert.equal(replay.duplicate,true);assert.equal(replay.message.id,sentAnswer.message.id)
  assert.equal((await unanswered.transcript()).resolution.outcome,'assisted','replay cannot relabel the admitted answer')
  await app.call(base+url,{token:handed.token,status:401})

 }finally{await a.close()}
}
