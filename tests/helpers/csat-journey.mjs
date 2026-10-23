import assert from 'node:assert/strict'
import {createHmac,randomUUID} from 'node:crypto'
import {mailApp} from './email/app.mjs'

// Real application, scheduler and providers; only the paid mail-provider edge is faked.
export async function csatJourney({progress=()=>{},inspectSurvey=async()=>{}}={}){
 progress("Starting real application")
 const secret='synthetic-fixture-csat-gateway-signing-secret',m=await mailApp({bindings:{INBOUND_EMAIL_TOKEN:secret}}),{app,mail}=m
 try{
  progress("Application ready")
  const a=await app.seedWorkspace('csat'),foreign=await app.seedWorkspace('csat-foreign'),endpoint=`/api/outcomes/projects/${a.projectId}`,owner={token:a.tokens.owner},settings={enabled:true,scale:'five',delayMinutes:0,expiresDays:14,locale:'en'}
  await app.db.prepare("INSERT INTO email_settings VALUES(?,'Support','sender@example.com','csat-inbound@example.com',1,1)").bind(a.projectId).run()
  for(const token of [undefined,'short']){
   await app.configure({INBOUND_EMAIL_TOKEN:token})
   const refused=await app.call(endpoint+'/settings',{...owner,method:'PUT',body:settings})
   assert.equal(refused.status,503);assert.match(JSON.stringify(refused.data),/INBOUND_EMAIL_TOKEN/)
   assert.equal((await app.ok(endpoint+'/settings',owner)).enabled,false,'a refused enable leaves surveys disabled')
   await app.ok(endpoint+'/settings',{...owner,method:'PUT',body:{...settings,enabled:false}})
  }
  await app.configure({INBOUND_EMAIL_TOKEN:secret})
  await app.ok(endpoint+'/settings',{...owner,method:'PUT',body:settings})
  assert.equal((await app.call(endpoint+'/settings',{token:foreign.tokens.owner})).status,403)
  assert.equal((await app.call(endpoint+'/settings',{token:a.tokens.operator,method:'PUT',body:settings})).status,403)
  const inbound=async(from,headers={})=>app.ok('/api/integrations/email/inbound',{headers:{Authorization:'Bearer '+secret},body:{messageId:randomUUID()+'@example.com',to:'csat-inbound@example.com',from,subject:'Support question',text:'Please help me',headers}})
  const solve=async id=>{await app.ok(`/api/dashboard/projects/${a.projectId}/conversations/${id}`,{...owner,method:'PUT',body:{resolved:true}});return app.first('SELECT * FROM conversation_resolutions WHERE conversation_id=? ORDER BY ordinal DESC LIMIT 1',id)}
  const surveys=()=>mail.sent.filter(entry=>entry.headers['idempotency-key']?.startsWith('csat:'))
  const invitation=resolution=>surveys().find(entry=>entry.headers['idempotency-key']==='csat:'+resolution.surveyId)
  const surveyRow=resolution=>app.first('SELECT * FROM csat_surveys WHERE resolution_id=?',resolution.id)
  const link=entry=>new URL(entry.body.text.match(/https:\/\/app\.example\/api\/outcomes\/surveys\/\S+/)[0]).pathname
  progress("Settings and scope checked")
  const first=await inbound('person@example.com'),firstId=first.conversationId||first.conversation_id
  assert.ok(firstId,JSON.stringify(first))
  const resolution=await solve(firstId)
  // Losing signing configuration skips invitations without stalling lost-ack outbox replay.
  const replayMessage=await app.first('SELECT id FROM messages WHERE conversation_id=? ORDER BY revision DESC LIMIT 1',firstId)
  const resetOutbox=()=>app.db.prepare('UPDATE conversation_outbox SET delivered_at=NULL WHERE message_id=?').bind(replayMessage.id).run()
  const outboxPending=async()=>(await app.first('SELECT COUNT(*) n FROM conversation_outbox WHERE message_id=? AND delivered_at IS NULL',replayMessage.id)).n
  for(const token of [undefined,'short']){
   await app.configure({INBOUND_EMAIL_TOKEN:token});await resetOutbox();await app.scheduled()
   assert.equal((await surveyRow(resolution)).state,'pending');assert.equal(surveys().length,0)
   assert.equal(await outboxPending(),0,'missing signing never holds back the outbox')
  }
  await app.configure({INBOUND_EMAIL_TOKEN:secret});await resetOutbox()
  // A database error in the survey poll is logged and the same cron tick still recovers mail.
  await app.scheduled({'x-test-before-statement':'SELECT * FROM unavailable_survey_fixture','x-test-statement':'SELECT r.project_id,r.conversation_id FROM conversation_resolutions'})
  assert.equal(await outboxPending(),0,'a survey failure never aborts scheduled recovery')
  assert.equal((await surveyRow(resolution)).state,'pending');assert.equal(surveys().length,0)
  await Promise.all([app.scheduled(),app.scheduled()])
  progress("First native cycle dispatched")
  const row=await surveyRow(resolution);assert.ok(row);assert.equal(row.state,'sent')
  const sent=invitation({surveyId:row.id});assert.ok(sent);assert.deepEqual(sent.body.to,['person@example.com']);assert.equal(surveys().filter(entry=>entry.headers['idempotency-key']==='csat:'+row.id).length,1)
  const legacyPayload=JSON.stringify(['csat-v1',row.id,row.project_id,row.resolution_id,row.contact_id,row.recipient,row.expires_at,row.token_revision])
  const legacyPath='/api/outcomes/surveys/'+row.id+'.'+row.token_revision+'.'+createHmac('sha256',secret).update(legacyPayload).digest('hex')
  assert.equal((await app.request(legacyPath)).status,200,'links issued before response surfaces remain valid')
  const path=link(sent),form=await app.request(path),html=await form.text()
  assert.match(path,/\.email\./)
  assert.equal(form.status,200);assert.match(html,/<html lang="en"/);assert.equal(form.headers.get('referrer-policy'),'same-origin')
  await inspectSurvey({app,path,name:'signed-survey'})
  assert.equal((await app.call(path.slice(0,-1)+(path.endsWith('0')?'1':'0'))).status,404)
  assert.equal((await app.call(path,{headers:{Origin:'https://foreign.example'},body:{score:1}})).status,403)
  assert.equal((await app.call(path,{body:{score:5,recovery:'inferred'}})).status,400)
  const submissions=await Promise.all([1,2].map(()=>app.request(path,{body:{score:2,recovery:'not_recovered',reason:'clarity',comment:'=Private feedback <script>bad()</script>'}})))
  assert.equal(submissions.filter(response=>response.status===200).length,1,'concurrent uses record exactly one response')
  assert.ok(submissions.some(response=>[409,410].includes(response.status)))
  const submit=submissions.find(response=>response.status===200)
  const thanks=await submit.text(),edit=thanks.match(/href="(\/api\/outcomes\/surveys\/[^"/]+)"/)[1]
  assert.notEqual(edit,path);assert.equal((await app.call(path,{body:{score:5}})).status,410)
  const usedPage=await app.request(path,{headers:{Accept:'text/html'}});assert.equal(usedPage.status,410);assert.match(usedPage.headers.get('content-type'),/text\/html/);assert.match(await usedPage.text(),/<main[ >]/)
  const editForm=await app.request(edit);assert.match(await editForm.text(),/&lt;script&gt;/)
  let results=await app.ok(endpoint+'/results?lowScore=true',owner)
  assert.equal(results.results[0].response.recovery,'not_recovered');assert.equal((await app.first('SELECT status_category FROM conversations WHERE id=?',firstId)).status_category,'solved','negative recovery feedback never changes ticket status');assert.equal(results.summary.rated,1);assert.equal(results.summary.lowScore,1);assert.equal(results.results[0].response.reason,'clarity');assert.equal(results.results[0].response.score,2);assert.equal(results.results[0].response.channel,'email');assert.equal(results.results[0].response.invitationChannel,'email')
  const csv=await app.request(endpoint+'/results?format=csv',owner);assert.equal(csv.status,200);assert.match(await csv.text(),/"'=Private feedback/)
  assert.equal((await app.request(edit,{raw:true,headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'score=5&reason=outcome&comment=Solved&recovery=recovered'})).status,200)
  results=await app.ok(endpoint+'/results',owner);assert.equal(results.results[0].response.recovery,'recovered');assert.equal(results.summary.positive,1);assert.equal(results.results[0].response.revision,2)
  assert.equal((await app.first('SELECT COUNT(*) n FROM csat_response_history WHERE resolution_id=?',resolution.id)).n,2)
  await app.ok(`/api/dashboard/projects/${a.projectId}/conversations/${firstId}`,{...owner,method:'PUT',body:{resolved:false}})
  assert.equal((await app.call(edit)).status,410)
  const day=86400000,date=at=>new Date(at).toISOString().slice(0,10),team=await app.ok(`/api/dashboard/projects/${a.projectId}/reports/team?period=custom&start=${date(Date.now()-day)}&end=${date(Date.now()+day)}`,owner)
  assert.deepEqual(team.breakdowns.channel.find(row=>row.id==='email').recovery,{recovered:0,notRecovered:0,answered:0,unknown:1,rate:null},'a previous cycle cannot establish current recovery')
  progress("First response, rerating and reopening checked")
  // A new native email begins the next cycle, preserving the earlier response.
  const followup=await inbound('person@example.com');assert.equal(followup.conversationId||followup.conversation_id,firstId)
  const next=await solve(firstId);assert.notEqual(next.id,resolution.id);await app.scheduled()
  const nextRow=await surveyRow(next),nextPath=link(invitation({surveyId:nextRow.id}))
  assert.equal((await app.request(nextPath+'/optout')).status,200)
  assert.equal((await app.first('SELECT COUNT(*) n FROM csat_optouts WHERE project_id=?',a.projectId)).n,0,'mail scanners do not opt customers out')
  assert.equal((await app.request(nextPath+'/optout',{body:{}})).status,200)
  assert.equal((await app.call(nextPath,{body:{score:1}})).status,410)
  await app.ok(`/api/dashboard/projects/${a.projectId}/conversations/${firstId}`,{...owner,method:'PUT',body:{resolved:false}})
  await inbound('person@example.com');const opted=await solve(firstId);await app.scheduled();assert.equal(await surveyRow(opted),null)
  progress("Optout checked")
  // Native automatic mail never earns an invitation.
  const machine=await inbound('robot@example.com',{'Auto-Submitted':'auto-replied'}),machineResolution=await solve(machine.conversationId||machine.conversation_id)
  await app.scheduled();assert.equal(await surveyRow(machineResolution),null)
  // Editing a canonical address cannot lend past inbound proof to a new mailbox.
  const changed=await inbound('original-address@example.com'),changedResolution=await solve(changed.conversationId||changed.conversation_id)
  await app.ok(`/api/management/projects/${a.projectId}/contacts/${changedResolution.contact_id}`,{...owner,method:'PUT',body:{email:'unproven-new-address@example.com'}})
  await app.scheduled();assert.equal(await surveyRow(changedResolution),null)
  // Neither a typed unsigned widget address nor imported history qualifies.
  const unsigned=await app.ok('/api/identity/widget/session',{body:{widgetKey:a.widgetKey,email:'unsigned@example.com'}})
  const uc=await app.ok('/api/conversations',{token:unsigned.token,body:{projectId:a.projectId}})
  await app.ok(`/api/conversations/${uc.id}/messages`,{token:unsigned.token,body:{localId:randomUUID(),content:'A widget question',expectedRevision:0}})
  const ur=await solve(uc.id);await app.scheduled();assert.equal(await surveyRow(ur),null)
  progress("Automatic and unsigned identities excluded")
  // The configured widget scale and signed email share one latest response per cycle.
  const signedEmail='signed@example.com',project=await app.first('SELECT verification_secret FROM projects WHERE id=?',a.projectId),signed=await app.ok('/api/identity/widget/session',{body:{widgetKey:a.widgetKey,identifier:signedEmail,email:signedEmail,contact_hash:createHmac('sha256',project.verification_secret).update(signedEmail).digest('hex')}})
  const wc=await app.ok('/api/conversations',{token:signed.token,body:{projectId:a.projectId}})
  await app.ok(`/api/conversations/${wc.id}/messages`,{token:signed.token,body:{localId:randomUUID(),content:'Signed question',expectedRevision:0}})
  const wr=await solve(wc.id);await app.scheduled();assert.ok(await surveyRow(wr))
  await app.ok(`/api/conversations/${wc.id}/widget-events`,{token:signed.token,body:{action:'rateResolution',data:{resolutionId:wr.id,score:2,comment:'Widget feedback'}}})
  assert.deepEqual(await app.first('SELECT channel,scale,score FROM csat_responses WHERE resolution_id=?',wr.id),{channel:'widget',scale:'five',score:2})
  await app.ok(endpoint+`/surveys/${(await surveyRow(wr)).id}/revoke`,{...owner,body:{}})
  assert.equal((await app.call(link(invitation({surveyId:(await surveyRow(wr)).id})))) .status,410)
  progress("Signed widget, cycle rating and revoke checked")
  // Delay is a durable due time, with the cycle invalidated before execution.
  await app.ok(endpoint+'/settings',{...owner,method:'PUT',body:{...settings,delayMinutes:60,locale:'fr'}})
  const delayed=await inbound('delayed@example.com'),dr=await solve(delayed.conversationId||delayed.conversation_id);await app.scheduled()
  const ds=await surveyRow(dr);assert.equal(ds.state,'pending');assert.equal(ds.locale,'fr');assert.ok(ds.due_at>Date.now())
  await app.ok(`/api/dashboard/projects/${a.projectId}/conversations/${dr.conversation_id}`,{...owner,method:'PUT',body:{resolved:false}})
  await app.scheduled();assert.equal((await surveyRow(dr)).state,'cancelled')
  await app.ok(endpoint+'/settings',{...owner,method:'PUT',body:settings})
  const legacy=await inbound('legacy@example.com'),lr=await solve(legacy.conversationId||legacy.conversation_id)
  await app.db.prepare('INSERT INTO reporting_legacy_conversations VALUES(?,?,?)').bind(a.projectId,lr.conversation_id,'legacy-fixture').run();await app.scheduled();assert.equal(await surveyRow(lr),null)
  progress("Delay, reopen and legacy exclusion checked")
  // A provider loss is durable uncertainty, never another invitation on replay.
  const unknown=await inbound('uncertain@example.com'),xr=await solve(unknown.conversationId||unknown.conversation_id)
  mail.respond=entry=>entry.headers['idempotency-key']?.startsWith('csat:')?new Response('unavailable',{status:503}):undefined
  await app.scheduled();assert.equal((await surveyRow(xr)).state,'uncertain');const attempts=surveys().length
  mail.respond=null;await app.scheduled();assert.equal(surveys().length,attempts)
  progress("Unknown send replay fenced")
  // Signed links expire, and contact erasure removes reason and comment everywhere.
  const expired=await inbound('expired@example.com'),er=await solve(expired.conversationId||expired.conversation_id);await app.scheduled()
  const es=await surveyRow(er),ep=link(invitation({surveyId:es.id}));await app.db.prepare('UPDATE csat_surveys SET expires_at=1 WHERE id=?').bind(es.id).run();assert.ok([404,410].includes((await app.call(ep)).status))
  await app.ok(`/api/management/projects/${a.projectId}/contacts/${resolution.contact_id}/erase`,{...owner,body:{}})
  assert.equal((await app.first("SELECT COUNT(*) n FROM csat_responses WHERE contact_id=? AND (comment<>'' OR reason<>'' OR recovery<>'unknown')",resolution.contact_id)).n,0)
  assert.equal((await app.first("SELECT COUNT(*) n FROM csat_response_history WHERE contact_id=? AND (comment<>'' OR reason<>'' OR recovery<>'unknown')",resolution.contact_id)).n,0)
  assert.equal((await app.first("SELECT COUNT(*) n FROM csat_surveys WHERE contact_id=? AND recipient<>''",resolution.contact_id)).n,0)
  const paged=await app.ok(endpoint+'/results?limit=1',owner);assert.ok(paged.nextCursor);const secondPage=await app.ok(endpoint+'/results?limit=1&cursor='+encodeURIComponent(paged.nextCursor),owner);assert.notEqual(secondPage.results[0].resolutionId,paged.results[0].resolutionId)
  progress("Expiry, erasure and pagination checked")
  // A morning of due replies and eligible surveys shares one cron invocation.
  // Every later consumer must still get its turn; work deferred by admission
  // stays pending and completes on the following ticks without duplicate sends.
  const due=Date.now()+3600000,surveyCycles=[],replySchedules=[]
  for(let index=0;index<30;index++){
   const question=await inbound(`morning-survey-${index}@example.com`)
   const cycle=await solve(question.conversationId||question.conversation_id);surveyCycles.push(cycle)
   const reply=await inbound(`morning-reply-${index}@example.com`),id=reply.conversationId||reply.conversation_id
   const ticket=(await app.ok(`/api/dashboard/projects/${a.projectId}/conversations/${id}/ticket`,owner)).data
   const schedule=await app.ok(`/api/dashboard/projects/${a.projectId}/workflow-schedules`,{...owner,body:{conversation_id:id,kind:'reply',due_at:due,timezone:'UTC',body:'Your replacement ships today.',owner_id:a.users.owner,expected_revision:ticket.revision,expected_last_message_id:ticket.last_message_id,expected_ticket_version:ticket.ticket_version}})
   replySchedules.push(schedule.data.id)
  }
  for(let minute=0;minute<4;minute++){
   await app.db.prepare("INSERT OR REPLACE INTO abuse_counters VALUES('morning-prune',0,1,1)").run()
   await app.scheduled(undefined,{after:86400000+minute*60000})
   assert.equal(await app.first("SELECT key FROM abuse_counters WHERE key='morning-prune'"),null,'pruning runs after every loaded tick')
  }
  for(const cycle of surveyCycles){const survey=await surveyRow(cycle);assert.equal(survey.state,'sent');assert.equal(surveys().filter(entry=>entry.headers['idempotency-key']==='csat:'+survey.id).length,1)}
  for(const id of replySchedules){assert.equal((await app.first('SELECT state FROM workflow_schedules WHERE id=?',id)).state,'sent');assert.equal((await app.first('SELECT count(*) n FROM messages WHERE local_id=?',`schedule:${id}`)).n,1)}
  // An integration poll failure must not skip outbox/job recovery or pruning.
  await app.db.prepare("INSERT OR REPLACE INTO abuse_counters VALUES('integration-failure-prune',0,1,1)").run()
  await app.scheduled({'x-test-before-statement':'SELECT * FROM unavailable_integration_fixture','x-test-statement':'SELECT project_id FROM native_integration_dispatch_cursor'})
  assert.equal(await app.first("SELECT key FROM abuse_counters WHERE key='integration-failure-prune'"),null)

 }finally{await m.close()}
}
