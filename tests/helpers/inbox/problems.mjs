import assert from 'node:assert/strict'
import {startApp} from '../../journeys/kit/app.mjs'
import {seedReportFixture} from '../reports-team-fixture.mjs'

export async function problemJourney(){
 const sent=[]
 const app=await startApp({captureQueue:true,bindings:{EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'fixture-key',EMAIL_FROM:'support@example.test'},outbound:async(request,entry)=>{assert.equal(new URL(request.url).hostname,'api.resend.com');const body=JSON.parse(entry.body);sent.push(body);return body.to.includes('customer2@customer.example.test')?new Response('rejected',{status:422}):Response.json({id:'incident-mail-'+sent.length})}})
 try{
  const w=await app.seedWorkspace('problems'),p=w.projectId,base=`/api/dashboard/projects/${p}`
  const fixture=await seedReportFixture(app.db,p,{count:30})
  // An active outage and 25 independent affected customers, including one opted-out email.
  await app.db.prepare("UPDATE conversations SET resolved_at=NULL,status_category='open',status_id='open' WHERE project_id=?").bind(p).run()
  const problem=fixture.tickets[0].id,incidents=fixture.tickets.slice(1,26).map(t=>t.id),path=id=>`${base}/conversations/${id}/ticket/problem`
  const call=async(id,suffix='',body,method)=>{const data=await app.ok(path(id)+suffix,{token:w.tokens.owner,...(body?{body}:{}),...(method?{method}:{})});return data.data}
  const frontier=async id=>(await call(id)).ticket
  await call(problem,'',{...await frontier(problem),is_problem:true},'PATCH')
  const matches=await app.ok(base+'/ticket-problem-search?q='+encodeURIComponent(fixture.tickets[3].subject),{token:w.tokens.owner});assert.ok(matches.data.some(t=>t.id===fixture.tickets[3].id))
  const byReference=await app.ok(base+'/ticket-problem-search?q='+encodeURIComponent(incidents[0]),{token:w.tokens.owner});assert.equal(byReference.data[0].id,incidents[0])
  const tickets=await Promise.all(incidents.map(frontier))
  const preview=await call(problem,'/incidents/preview',{action:'link',tickets})
  assert.equal(preview.results.filter(r=>r.status==='ready').length,25)
  assert.equal(sent.length,0)
  const linked=await call(problem,'/incidents/apply',{action:'link',tickets})
  assert.equal(linked.results.filter(r=>r.status==='applied').length,25)
  assert.equal((await call(problem)).incident_count,25)
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
 }finally{await app.close()}
}
