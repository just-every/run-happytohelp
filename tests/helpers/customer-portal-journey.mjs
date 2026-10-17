import assert from 'node:assert/strict'
import {selfServiceFixture} from './self-service-fixture.mjs'
export async function customerPortalJourney(){
 const f=await selfServiceFixture({failSurveys:true}),{app,p,owner,api,form,valid,signin,mail}=f,P=`/api/portal/${p}`
 try{
  // A hostile widget visitor may type the real customer's address; signing into
  // that mailbox creates a separate identity and never exposes the visitor thread.
  const widget=await app.ok('/api/identity/widget/session',{body:{widgetKey:f.workspace.widgetKey,email:'rosa@example.com'},headers:{Origin:f.workspace.allowedOrigin}})
  const trap=await app.ok('/api/conversations',{token:widget.token,body:{projectId:p}})
  await app.ok(`/api/conversations/${trap.id}/messages`,{token:widget.token,body:{localId:'typed-address',content:'Only the widget visitor may see this.',expectedRevision:0}})
  const rosa=await signin('rosa@example.com'),other=await signin('mallory@example.com')
  assert.equal((await app.call(P+'/tickets')).status,401)
  assert.equal((await app.call(P+`/tickets/${trap.id}`,rosa)).status,404)
  assert.equal((await app.call(P+'/tickets',rosa)).data.tickets.length,0)
  const create=(await app.call(`${api}/${form.id}/submissions`,{...rosa,body:valid,status:201})).data,id=create.ticket.id
  const detail=()=>app.ok(P+`/tickets/${id}`,rosa)
  assert.equal((await detail()).ticket.status,'open')
  assert.equal((await app.call(P+`/tickets/${id}`,other)).status,404)
  assert.equal((await app.call(P+`/tickets/${id}/reply`,{...other,body:{localId:'steal',content:'Inject',expectedRevision:1}})).status,404)
  assert.equal((await app.call(P+`/tickets/${id}/reply`,{...rosa,headers:{...rosa.headers,Origin:'https://evil.example'},body:{}})).status,403)
  const upload=await app.call(P+`/tickets/${id}/attachments`,{...rosa,raw:true,body:'Order NS-10482 receipt bytes',headers:{...rosa.headers,'Content-Type':'text/plain','X-Filename':'receipt.txt'},status:201})
  const reply={localId:'rosa-reply',content:'Here is my receipt.',expectedRevision:create.ticket.revision,mediaIds:[upload.data.id]}
  await app.ok(P+`/tickets/${id}/reply`,{...rosa,body:reply})
  const filePath=P+`/tickets/${id}/attachments/${upload.data.id}`,download=await app.request(filePath,rosa);assert.equal(download.status,200);assert.equal(await download.text(),'Order NS-10482 receipt bytes')
  assert.equal((await app.call(filePath,other)).status,404)
  const objectKey=(await app.first('SELECT object_key FROM media WHERE id=?',upload.data.id)).object_key
  const contact=(await app.first('SELECT contact_id FROM conversations WHERE id=?',id)).contact_id
  await app.ok(`/api/outcomes/projects/${p}/settings`,{...owner,method:'PUT',body:{enabled:true,scale:'five',delayMinutes:0,expiresDays:14,locale:'en'}})
  await app.ok(`/api/dashboard/projects/${p}/conversations/${id}`,{...owner,method:'PUT',body:{resolved:true}});await app.scheduled()
  const solved=await detail();assert.equal(solved.ticket.status,'solved');assert.equal(solved.survey.state,'available')
  const survey=new URL(solved.survey.url);assert.equal((await app.request(survey.pathname)).status,200)
  assert.equal((await app.request(survey.pathname,{body:{score:4,reason:'outcome',comment:'Thank you for the clear answer'}})).status,200)
  assert.equal((await app.call(survey.pathname,{body:{score:4}})).status,410)
  await app.ok(P+`/tickets/${id}/reopen`,{...rosa,body:{expectedRevision:solved.ticket.revision}})
  assert.equal((await detail()).ticket.status,'open');assert.equal((await app.call(survey.pathname)).status,410)
  const history=await app.sql('SELECT source FROM ticket_history WHERE conversation_id=?',id);assert.ok(history.some(h=>h.source==='portal'))
  const delayed=(await app.ok(`${api}/${form.id}/submissions`,{...rosa,body:{...valid,localId:'delayed-survey'}})).ticket
  await app.ok(`/api/outcomes/projects/${p}/settings`,{...owner,method:'PUT',body:{enabled:true,scale:'five',delayMinutes:60,expiresDays:14,locale:'en'}})
  await app.ok(`/api/dashboard/projects/${p}/conversations/${delayed.id}`,{...owner,method:'PUT',body:{resolved:true}});await app.scheduled()
  assert.equal((await app.ok(P+`/tickets/${delayed.id}`,rosa)).survey.state,'unavailable','portal survey respects configured delay')
  await app.ok(P+'/preferences',{...rosa,method:'PUT',body:{locale:'es',surveyEmails:false,updateEmails:false}})
  assert.equal((await app.ok(P+'/preferences',rosa)).updateEmails,false)
  const translated=await app.ok(`${api}/${form.id}`,rosa)
  assert.equal(translated.data.title,f.config.translations.es.title,'request forms use the saved customer language')
  let before=mail.length,revision=(await app.first('SELECT revision FROM conversations WHERE id=?',id)).revision
  await app.ok(`/api/conversations/${id}/messages`,{...owner,body:{localId:'operator-no-notify',content:'The refund is now processing.',expectedRevision:revision}})
  assert.ok(!mail.slice(before).some(m=>[].concat(m.to).includes('rosa@example.com')),'reply email respects customer opt-out')
  await app.ok(P+'/preferences',{...rosa,method:'PUT',body:{locale:'en',surveyEmails:true,updateEmails:true}})
  before=mail.length;revision=(await app.first('SELECT revision FROM conversations WHERE id=?',id)).revision
  await app.ok(`/api/conversations/${id}/messages`,{...owner,body:{localId:'operator-notify',content:'You can track your refund in your account.',expectedRevision:revision}})
  assert.ok(mail.slice(before).some(m=>[].concat(m.to).includes('rosa@example.com')),'reply email resumes after preference change')
  assert.equal((await app.call(`/api/portal/${f.foreign.projectId}/tickets`,rosa)).status,401)
  await app.ok(`/api/management/projects/${p}/contacts/${contact}/erase`,{...owner,body:{}})
  for(const table of ['portal_identities','portal_preferences','portal_session_proofs','request_form_submissions'])assert.equal((await app.first(`SELECT count(*) n FROM ${table} WHERE project_id=? AND contact_id=?`,p,contact)).n,0)
  assert.equal((await app.first('SELECT count(*) n FROM portal_links WHERE project_id=? AND email=?',p,'rosa@example.com')).n,0)
  assert.equal((await app.first('SELECT count(*) n FROM ticket_field_values WHERE conversation_id=?',id)).n,0)
  assert.equal((await app.call(P+`/tickets/${id}`,rosa)).status,401)
  assert.equal(await (await app.files).get(objectKey),null)
  assert.ok(await app.first("SELECT id FROM audit_events WHERE project_id=? AND action='portal.preferences.updated'",p))
 }finally{await app.close()}
}
