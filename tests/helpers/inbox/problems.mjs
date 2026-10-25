import assert from 'node:assert/strict'
import {createHash,createHmac} from 'node:crypto'
import {startApp} from '../../journeys/kit/app.mjs'
import {seedReportFixture} from '../reports-team-fixture.mjs'

export async function problemJourney(){
 const sent=[],invitations=[],issue={id:901,number:17,state:'open',assignee:{login:'Support engineer'},updated_at:'2026-10-23T08:00:00Z'}
 const app=await startApp({captureQueue:true,bindings:{EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'synthetic-happytohelp-1',INTEGRATION_ENCRYPTION_KEY:createHash('sha256').update('synthetic-happytohelp-2').digest('base64'),EMAIL_FROM:'support@example.test',INBOUND_EMAIL_TOKEN:'synthetic-happytohelp-7',APP_ORIGIN:'https://app.example'},outbound:async(request,entry)=>{if(new URL(request.url).hostname==='api.github.com'){assert.match(new URL(request.url).pathname,/^\/repos\/synthetic-owner\/synthetic-repo\/issues(?:\/17)?$/);return Response.json(issue)}assert.equal(new URL(request.url).hostname,'api.resend.com');const body=JSON.parse(entry.body);if(entry.headers['idempotency-key']?.startsWith('csat:')){invitations.push(body);return Response.json({id:'csat-mail-'+invitations.length})}sent.push(body);return body.to.includes('customer2@customer.example.test')?new Response('rejected',{status:422}):Response.json({id:'incident-mail-'+sent.length})}})
 try{
  const w=await app.seedWorkspace('problems'),p=w.projectId,base=`/api/dashboard/projects/${p}`
  const fixture=await seedReportFixture(app.db,p,{count:30})
  // An active outage and 25 independent affected customers, including one opted-out email.
  await app.db.prepare("UPDATE conversations SET resolved_at=NULL,status_category='open',status_id='open' WHERE project_id=?").bind(p).run()
  const problem=fixture.tickets[0].id,incidents=fixture.tickets.slice(1,26).map(t=>t.id),path=id=>`${base}/conversations/${id}/ticket/problem`
  const call=async(id,suffix='',body,method)=>{const data=await app.ok(path(id)+suffix,{token:w.tokens.owner,...(body?{body}:{}),...(method?{method}:{})});return data.data}
  // Incidents keep their own SLA and CSAT invitation: one commitment for every ticket, and email surveys on resolution.
  const read=async(route,options={})=>{const data=await app.ok(route,{token:w.tokens.owner,...options});return data.data??data}
  await app.ok(`/api/outcomes/projects/${p}/settings`,{token:w.tokens.owner,method:'PUT',body:{enabled:true,scale:'thumbs',delayMinutes:0,expiresDays:14,locale:'en'}})
  const calendar=await read(base+'/workflow-calendars',{body:{name:'Incident support',timezone:'UTC',weekly:[0,1,2,3,4,5,6].map(day=>({day,start:'00:00',end:'24:00'})),holidays:'none',closures:[]}})
  const policy=await read(base+'/sla-policies',{body:{name:'Incident commitments',calendar_id:calendar.id,position:1,conditions:{priorities:[],plans:[],channels:[],brands:[]},first_response_minutes:60,next_response_minutes:120,resolution_minutes:480}})
  const sla=id=>read(`${base}/conversations/${id}/sla`),resolutionClock=state=>state.clocks.filter(clock=>clock.metric==='resolution').at(-1)
  const frontier=async id=>(await call(id)).ticket
  await call(problem,'',{...await frontier(problem),is_problem:true},'PATCH')
  // A Problem is an ordinary support ticket at the engineering doors. Link
  // its chosen context once, then use the returned fix in its incident preview.
  const escalation=`/api/escalations/projects/${p}`,secret='synthetic-happytohelp-3'
  await app.ok(escalation+'/connections',{token:w.tokens.owner,body:{provider:'github',target:'synthetic-owner/synthetic-repo',token:'synthetic-happytohelp-4',webhook_secret:secret}})
  await app.ok(`${escalation}/conversations/${problem}/links`,{token:w.tokens.owner,body:{provider:'github',mode:'create',title:'Checkout incident',message_ids:[],attachment_ids:[],request_id:'synthetic-happytohelp-5'}})
  let engineering=(await call(problem)).engineering_issues
  assert.equal(engineering.length,1);assert.equal(engineering[0].issue_key,'17');assert.equal(engineering[0].recovery,'unconfirmed');assert.equal(engineering[0].stale,false)
  assert.equal((await app.call(`/api/dashboard/projects/${p}/conversations/${problem}/ticket/problem`,{token:(await app.seedWorkspace('foreign-problem')).tokens.owner})).status,404)
  issue.state='closed';issue.updated_at='2026-10-23T08:05:00Z'
  const raw=JSON.stringify({action:'closed',repository:{full_name:'synthetic-owner/synthetic-repo'},issue})
  const event={token:w.tokens.owner,body:raw,raw:true,headers:{'Content-Type':'application/json','x-github-event':'issues','x-github-delivery':'synthetic-happytohelp-6','x-hub-signature-256':'sha256='+createHmac('sha256',secret).update(raw).digest('hex')}}
  await app.ok(`/api/escalations/webhooks/${p}:github`,event)
  assert.equal((await app.ok(`/api/escalations/webhooks/${p}:github`,event)).duplicate,true)
  engineering=(await call(problem)).engineering_issues
  assert.equal(engineering[0].status,'closed');assert.equal(engineering[0].recovery,'unconfirmed')
  assert.equal((await app.ok(`${escalation}/conversations/${problem}`,{token:w.tokens.owner})).data.drafts.length,1)
  assert.equal(sent.length,0,'engineering closure drafts an update without contacting incidents')
  await app.db.prepare('UPDATE escalation_connections SET token_cipher=NULL WHERE project_id=?').bind(p).run()
  assert.equal((await call(problem)).engineering_issues[0].stale,true,'disconnect retains context with an explicit stale state')
  await app.configure({})
  assert.equal((await call(problem)).engineering_issues[0].status,'closed')
  const matches=await app.ok(base+'/ticket-problem-search?q='+encodeURIComponent(fixture.tickets[3].subject),{token:w.tokens.owner});assert.ok(matches.data.some(t=>t.id===fixture.tickets[3].id))
  const byReference=await app.ok(base+'/ticket-problem-search?q='+encodeURIComponent(incidents[0]),{token:w.tokens.owner});assert.equal(byReference.data[0].id,incidents[0])
  const tickets=await Promise.all(incidents.map(frontier))
  const preview=await call(problem,'/incidents/preview',{action:'link',tickets})
  assert.equal(preview.results.filter(r=>r.status==='ready').length,25)
  assert.equal(sent.length,0)
  const linked=await call(problem,'/incidents/apply',{action:'link',tickets})
  assert.equal(linked.results.filter(r=>r.status==='applied').length,25)
  assert.equal((await call(problem)).incident_count,25)
  // Link another incident, then unlink it before previewing the resolution.
  // Its independently owned ticket and delivery history must remain untouched.
  const unlinked=fixture.tickets[26].id,unchanged=await frontier(unlinked)
  await call(problem,'/incidents/apply',{action:'link',tickets:[unchanged]})
  assert.equal((await call(problem)).incident_count,26)
  await call(problem,'/incidents/apply',{action:'unlink',tickets:[await frontier(unlinked)]})
  assert.equal((await call(problem)).incident_count,25)
  const unlinkedBefore=await frontier(unlinked)
  const unlinkedHistory=await app.ok(`${base}/conversations/${unlinked}/ticket`,{token:w.tokens.owner})
  await app.db.prepare("UPDATE contacts SET metadata_json='{\"portal_notification_emails\":0}' WHERE id=?").bind(fixture.tickets[4].contact_id).run()
  const slaBefore=new Map()
  for(const id of [...incidents,unlinked]){
   const state=await sla(id);slaBefore.set(id,state)
   assert.equal(state.policy.id,policy.id)
   assert.equal(state.clocks.find(clock=>clock.metric==='resolution'&&clock.cycle===1).started_at,fixture.tickets.find(t=>t.id===id).created_at,'each incident\'s commitment starts from its own request')
  }
  const plan=await call(problem,'/solve/preview',{reply:'Hi {{contact.name}}, checkout is working again. — {{agent.name}}',solve_incidents:true})
  assert.equal(plan.results.length,25)
  assert.equal(plan.results.filter(r=>r.status==='blocked').length,1)
  assert.equal(sent.length,0)
  assert.ok(plan.results.filter(r=>r.status==='ready').every(r=>!r.reply.includes('{{')))
  const solveStarted=Date.now()
  const result=(await app.ok(path(problem)+'/solve/apply',{token:w.tokens.owner,body:{preview_id:plan.preview_id},headers:{'x-test-fault':'db-once','x-test-statement-at':'1001'}})).data
  const solveEnded=Date.now()
  const failure=result.results.find(r=>r.id===fixture.tickets[2].id)
  assert.equal(failure.status,'failed',JSON.stringify(result))
  assert.match(failure.reason,/rejected/)
  assert.equal(result.results.filter(r=>r.status==='solved').length,23,JSON.stringify(result))
  assert.equal(result.problem.status,'solved',JSON.stringify(result.problem))
  assert.equal((await call(problem)).recent_preview_id,plan.preview_id)
  assert.equal((await call(problem,'/solve/'+plan.preview_id)).results.filter(r=>r.status==='solved').length,23)
  assert.deepEqual(await frontier(unlinked),unlinkedBefore,'an incident unlinked before solve retains its own state')
  assert.deepEqual(await app.ok(`${base}/conversations/${unlinked}/ticket`,{token:w.tokens.owner}),unlinkedHistory,'problem resolution does not rewrite the unlinked incident history')
  assert.ok(!sent.some(mail=>mail.to.includes('customer26@customer.example.test')))
  const sends=sent.length
  await call(problem,'/solve/apply',{preview_id:plan.preview_id})
  assert.equal(sent.length,sends)
  assert.equal(sends,11)
  for(const mail of sent){assert.equal(mail.to.length,1);assert.ok(!mail.cc?.length&&!mail.bcc?.length);assert.ok(!mail.to.includes('customer0@customer.example.test'))}
  // A solved incident completes its own running commitment at its own resolution; an incident left open by a failed
  // or blocked reply, and one unlinked before the solve, keep their resolution commitment running.
  const outcomes=new Map(result.results.map(r=>[r.id,r.status])),checked={solved:0,open:0}
  for(const [id,before] of slaBefore){
   const was=resolutionClock(before),now=resolutionClock(await sla(id))
   if(was.completed_at!==null)continue
   assert.equal(now.started_at,was.started_at)
   if(outcomes.get(id)==='solved'){assert.ok(now.completed_at>=solveStarted&&now.completed_at<=solveEnded,`${id} completes its own resolution commitment`);checked.solved++}
   else{assert.equal(now.completed_at,null,`${id} keeps its resolution commitment running`);checked.open++}
  }
  assert.ok(checked.solved>0&&checked.open>1,JSON.stringify(checked))
  const stored=await app.sql('SELECT id,status_category FROM conversations WHERE id IN (SELECT value FROM json_each(?))',JSON.stringify(incidents))
  assert.equal(stored.find(t=>t.id===failure.id).status_category,'open')
  assert.equal(stored.find(t=>t.id===fixture.tickets[4].id).status_category,'open')
  const widgetId=fixture.tickets[1].id
  assert.equal((await app.first("SELECT count(*) n FROM messages WHERE conversation_id=? AND local_id LIKE 'problem:%'",widgetId)).n,1)
  await call(problem,'/incidents/apply',{action:'unlink',tickets:[await frontier(failure.id)]})
  const erasedContact=fixture.tickets[1].contact_id
  await app.ok(`/api/management/projects/${p}/contacts/${erasedContact}/erase`,{token:w.tokens.owner,body:{}})
  assert.equal((await app.first('SELECT count(*) n FROM ticket_problem_incidents WHERE incident_id=?',widgetId)).n,0)
  assert.ok((await app.first("SELECT count(*) n FROM ticket_problem_previews WHERE id=? AND state='erased' AND plan_json='{\"tickets\":[]}'",plan.preview_id)).n)
  assert.ok((await app.first("SELECT count(*) n FROM audit_events WHERE project_id=? AND action LIKE 'ticket.problem%'",p)).n>0)
  // A second Problem whose incidents arrived through the widget from signed mailboxes: each solved ticket invites only
  // its own requester to rate it, once, while an incident unlinked before the solve invites nobody.
  const {verificationSecret}=await app.ok(`/api/management/projects/${p}/widget-settings`,{token:w.tokens.owner})
  const visitor=async n=>{
   const email=`incident${n}@customer.example.test`,session=await app.ok('/api/identity/widget/session',{headers:{Origin:w.allowedOrigin},body:{widgetKey:w.widgetKey,name:`Incident requester ${n}`,email,identifier:email,contact_hash:createHmac('sha256',verificationSecret).update(email).digest('hex')}})
   const conversation=await app.ok('/api/conversations',{token:session.token,body:{projectId:p}})
   await app.ok(`/api/conversations/${conversation.id}/messages`,{token:session.token,body:{localId:'checkout',content:'Checkout fails for me too.',expectedRevision:0}})
   return {id:conversation.id,email}
  }
  const outage=await visitor(1),reports=[await visitor(2),await visitor(3),await visitor(4)],withdrawn=reports[2]
  await call(outage.id,'',{...await frontier(outage.id),is_problem:true},'PATCH')
  await call(outage.id,'/incidents/apply',{action:'link',tickets:await Promise.all(reports.map(r=>frontier(r.id)))})
  await call(outage.id,'/incidents/apply',{action:'unlink',tickets:[await frontier(withdrawn.id)]})
  const outagePlan=await call(outage.id,'/solve/preview',{reply:'Hi {{contact.name}}, checkout is working again.',solve_incidents:true})
  const outageResult=await call(outage.id,'/solve/apply',{preview_id:outagePlan.preview_id})
  assert.deepEqual(outageResult.results.map(r=>[r.id,r.status]).sort(),reports.slice(0,2).map(r=>[r.id,'solved']).sort(),JSON.stringify(outageResult.results))
  for(let run=0,count=-1;run<10&&count!==invitations.length;run++){count=invitations.length;await app.scheduled()}
  for(const mail of invitations){assert.equal(mail.to.length,1);assert.ok(!mail.cc?.length&&!mail.bcc?.length)}
  assert.deepEqual(invitations.flatMap(mail=>mail.to).sort(),[outage.email,reports[0].email,reports[1].email].sort(),'each solved ticket invites only its own requester, once; the unlinked incident invites nobody')
  console.log(JSON.stringify({proof:'R10 problem incidents',linked:25,solved:23,providerRejected:1,optOutBlocked:1,emails:sends,replayEmails:0,slaChecked:checked,invitations:invitations.length}))
 }finally{await app.close()}
}
