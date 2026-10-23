import assert from 'node:assert/strict'
import {createHash,createHmac,randomUUID} from 'node:crypto'
import {startApp} from '../../journeys/kit/app.mjs'
import {seedReportFixture} from '../reports-team-fixture.mjs'

export async function problemJourney(){
 const sent=[],receipts=[],issue={id:901,number:17,state:'open',assignee:{login:'Support engineer'},updated_at:'2026-10-23T08:00:00Z'}
 const app=await startApp({captureQueue:true,bindings:{APP_ORIGIN:'https://app.example',INBOUND_EMAIL_TOKEN:'synthetic-happytohelp-10',EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'synthetic-happytohelp-1',INTEGRATION_ENCRYPTION_KEY:createHash('sha256').update('synthetic-happytohelp-2').digest('base64'),EMAIL_FROM:'support@example.test'},outbound:async(request,entry)=>{if(new URL(request.url).hostname==='api.github.com'){assert.match(new URL(request.url).pathname,/^\/repos\/synthetic-owner\/synthetic-repo\/issues(?:\/17)?$/);return Response.json(issue)}assert.equal(new URL(request.url).hostname,'api.resend.com');const body=JSON.parse(entry.body);sent.push(body);receipts.push({body,key:request.headers.get('idempotency-key')});return body.to.includes('customer2@customer.example.test')?new Response('rejected',{status:422}):Response.json({id:'incident-mail-'+sent.length})}})
 try{
  const w=await app.seedWorkspace('problems'),p=w.projectId,base=`/api/dashboard/projects/${p}`
  const fixture=await seedReportFixture(app.db,p,{count:30})
  // An active outage and 25 independent affected customers, including one opted-out email.
  await app.db.prepare("UPDATE conversations SET resolved_at=NULL,status_category='open',status_id='open' WHERE project_id=?").bind(p).run()
  const problem=fixture.tickets[0].id,incidents=fixture.tickets.slice(1,26).map(t=>t.id),path=id=>`${base}/conversations/${id}/ticket/problem`
  const call=async(id,suffix='',body,method)=>{const data=await app.ok(path(id)+suffix,{token:w.tokens.owner,...(body?{body}:{}),...(method?{method}:{})});return data.data}
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
  const plan=await call(problem,'/solve/preview',{reply:'Hi {{contact.name}}, checkout is working again. — {{agent.name}}',solve_incidents:true})
  assert.equal(plan.results.length,25)
  assert.equal(plan.results.filter(r=>r.status==='blocked').length,1)
  assert.equal(sent.length,0)
  assert.ok(plan.results.filter(r=>r.status==='ready').every(r=>!r.reply.includes('{{')))
  const result=(await app.ok(path(problem)+'/solve/apply',{token:w.tokens.owner,body:{preview_id:plan.preview_id},headers:{'x-test-fault':'db-once','x-test-statement-at':'1001'}})).data
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
  console.log(JSON.stringify({proof:'R10 problem incidents',linked:25,solved:23,providerRejected:1,optOutBlocked:1,emails:sends,replayEmails:0}))
  await incidentCommitmentsJourney(app,receipts)
 }finally{await app.close()}
}

// Real widget and email intake, with only the outgoing mail provider faked.
// Linking and bulk resolution must retain each requester's service and feedback cycle.
async function incidentCommitmentsJourney(app,receipts){
 const w=await app.seedWorkspace('incident-service'),p=w.projectId,owner={token:w.tokens.owner},base=`/api/dashboard/projects/${p}`;
 const api=async(path,body,method)=>(await app.ok(base+path,{...owner,...(body===undefined?{}:{body}),...(method?{method}:{})})).data;
 const ticket=id=>api(`/conversations/${id}/ticket`),problemPath=id=>`/conversations/${id}/ticket/problem`;
 const frontier=async id=>(await api(problemPath(id))).ticket;
 const secret=(await app.first('SELECT verification_secret FROM projects WHERE id=?',p)).verification_secret;
 const visitors=[];
 const widget=async index=>{
  const email=`incident${index}@support.example.test`;
  const visitor=await app.ok('/api/identity/widget/session',{body:{widgetKey:w.widgetKey,identifier:email,email,name:`Requester ${index}`,contact_hash:createHmac('sha256',secret).update(email).digest('hex')},headers:{Origin:w.allowedOrigin}});
  const conversation=await app.ok('/api/conversations',{token:visitor.token,body:{projectId:p}});
  await app.ok(`/api/conversations/${conversation.id}/messages`,{token:visitor.token,body:{localId:randomUUID(),content:`Checkout outage for requester ${index}`,expectedRevision:0}});
  visitors.push({...visitor,id:conversation.id,email});return conversation.id;
 };
 await app.db.prepare("INSERT INTO email_settings VALUES(?,'Support','support@example.test','incident-service@example.test',1,1)").bind(p).run();
 const email=async index=>{
  const received=await app.ok('/api/integrations/email/inbound',{headers:{Authorization:'Bearer synthetic-happytohelp-10'},body:{messageId:randomUUID()+'@example.test',to:'incident-service@example.test',from:`incident${index}@support.example.test`,subject:`Checkout outage ${index}`,text:`Checkout failed for requester ${index}`}});
  return received.conversationId||received.conversation_id;
 };
 const calendar=await api('/workflow-calendars',{name:'Incident service',timezone:'America/New_York',weekly:[0,1,2,3,4,5,6].map(day=>({day,start:'00:00',end:'23:59'})),holidays:'none',closures:[]});
 const policies={};
 for(const [channel,minutes] of [['widget',120],['email',60]])policies[channel]=await api('/sla-policies',{name:channel+' commitment',calendar_id:calendar.id,position:0,conditions:{channels:[channel]},first_response_minutes:minutes,next_response_minutes:minutes,resolution_minutes:minutes*4,pause_on_hold:true,approaching_minutes:10,backup_user_ids:[]});
 await app.ok(`/api/outcomes/projects/${p}/settings`,{...owner,method:'PUT',body:{enabled:true,scale:'five',delayMinutes:0,expiresDays:14,locale:'en'}});
 const root=await widget(0),ids=[await widget(1),await email(2),await widget(3),await email(4),await widget(5)];
 assert.ok(ids.every(Boolean),'all five incidents arrived through native intake');
 await api(problemPath(root),{...await frontier(root),is_problem:true},'PATCH');
 await api(`/conversations/${ids[0]}/ticket`,{expected_version:(await ticket(ids[0])).ticket_version,status_id:'pending'},'PATCH');
 const sla=id=>api(`/conversations/${id}/sla`),before=new Map();
 for(const id of ids){const own=await sla(id),t=await ticket(id);assert.equal(own.policy.id,policies[t.channel].id);assert.ok(own.clocks.some(clock=>clock.metric==='resolution'&&!clock.completed_at));before.set(id,own);}
 assert.equal(before.get(ids[0]).pause_reason,'pending');
 await api(problemPath(root)+'/incidents/apply',{action:'link',tickets:await Promise.all(ids.map(frontier))});
 for(const id of ids){const own=await sla(id),prior=before.get(id);assert.equal(own.policy.id,prior.policy.id);assert.deepEqual(own.clocks.map(({metric,cycle,started_at,due_at,target_ms})=>({metric,cycle,started_at,due_at,target_ms})),prior.clocks.map(({metric,cycle,started_at,due_at,target_ms})=>({metric,cycle,started_at,due_at,target_ms})),'linking preserves the incident SLA targets and start times');}
 const unlinked=ids.at(-1);await api(problemPath(root)+'/incidents/apply',{action:'unlink',tickets:[await frontier(unlinked)]});
 const unlinkedHistory=await ticket(unlinked),sentBefore=receipts.length;
 const preview=await api(problemPath(root)+'/solve/preview',{reply:'Hello {{contact.name}}, your checkout is working again.',solve_incidents:true});
 assert.equal(preview.results.length,4);assert.ok(preview.results.every(row=>row.status==='ready'));
 const solved=await api(problemPath(root)+'/solve/apply',{preview_id:preview.preview_id});
 assert.equal(solved.results.filter(row=>row.status==='solved').length,4,JSON.stringify(solved));
 await app.configure({});await app.scheduled();
 const results=await app.ok(`/api/outcomes/projects/${p}/results`,owner),cycles=[];
 for(const id of ids.slice(0,-1)){
  const own=await sla(id);assert.equal(own.policy.id,before.get(id).policy.id);
  assert.ok(own.clocks.filter(clock=>['first_response','resolution'].includes(clock.metric)).every(clock=>clock.completed_at!==null),'each resolved incident completes its own service clocks');
  const row=results.results.find(row=>row.conversationId===id);assert.ok(row,'each incident retains its own resolution history');cycles.push(row.resolutionId);
  const survey=await app.first('SELECT * FROM csat_surveys WHERE resolution_id=?',row.resolutionId);assert.ok(survey,'each requester earns a separate invitation');assert.equal(survey.conversation_id,id);assert.equal(survey.state,'sent');
  const deliveries=receipts.slice(sentBefore).filter(entry=>entry.key==='csat:'+survey.id);assert.equal(deliveries.length,1);assert.deepEqual(deliveries[0].body.to,[survey.recipient]);
 }
 assert.equal(new Set(cycles).size,4,'resolution and CSAT never share a problem-level cycle');
 assert.deepEqual(await ticket(unlinked),unlinkedHistory,'an unlinked incident keeps its independent status and history');
 assert.ok((await sla(unlinked)).clocks.find(clock=>clock.metric==='resolution'&&!clock.completed_at));
 assert.equal(await app.first('SELECT * FROM csat_surveys WHERE conversation_id=?',unlinked),null);
 for(const visitor of visitors){
  const transcript=await app.ok(`/api/conversations/${visitor.id}/messages`,{token:visitor.token});
  const text=JSON.stringify(transcript);
  for(const other of visitors.filter(other=>other.id!==visitor.id))assert.ok(!text.includes(other.email),'customer transcript never contains another requester identity');
 }
 const count=receipts.length;await app.scheduled();await api(problemPath(root)+'/solve/apply',{preview_id:preview.preview_id});assert.equal(receipts.length,count,'restart, cron and replay cannot duplicate replies or invitations');
 console.log(JSON.stringify({proof:'independent incident commitments',nativeIntake:5,linked:5,unlinked:1,solved:4,independentSla:4,independentCsat:4,replaySends:0}));
}
