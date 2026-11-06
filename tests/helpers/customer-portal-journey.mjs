import {portalOutcomes} from './portal-outcomes.mjs'
import {emailOutcomes} from './outcomes-002-email-outcomes.mjs'
import {accountLookupJourney} from './account-lookup-journey.mjs'
import {companyPortalJourney} from './company-portal.mjs'
import assert from 'node:assert/strict'
import {createHmac} from 'node:crypto'
import {selfServiceFixture} from './self-service-fixture.mjs'
export async function customerPortalJourney(){
 await emailOutcomes()
 const f=await selfServiceFixture({failSurveys:true}),{app,p,owner,api,form,valid,signin,mail}=f,P=`/api/portal/${p}`
 try{
  await portalOutcomes(f)
  await companyPortalJourney(f)
  // A hostile widget visitor may type the real customer's address; signing into
  // that mailbox creates a separate identity and never exposes the visitor thread.
  const widget=await app.ok('/api/identity/widget/session',{body:{widgetKey:f.workspace.widgetKey,email:'rosa@example.com'},headers:{Origin:f.workspace.allowedOrigin}})
  const trap=await app.ok('/api/conversations',{token:widget.token,body:{projectId:p}})
  await app.ok(`/api/conversations/${trap.id}/messages`,{token:widget.token,body:{localId:'typed-address',content:'Only the widget visitor may see this.',expectedRevision:0}})
  const beforeAnonymous=(await app.first('SELECT count(*) n FROM conversations WHERE project_id=?',p)).n
  assert.equal((await app.call(`${api}/${form.id}/submissions`,{body:valid})).status,428)
  assert.equal((await app.first('SELECT count(*) n FROM conversations WHERE project_id=?',p)).n,beforeAnonymous)
  assert.equal((await app.call(`${api}/${form.id}/submissions`,{body:{...valid,fields:{[f.reason.id]:'refund'}}})).status,422)
  const rosa=await signin('rosa@example.com',`/help/${p}/requests/${form.id}`),other=await signin('mallory@example.com')
  assert.equal(rosa.location,`/help/${p}/requests/${form.id}`);assert.equal((await app.call(rosa.path)).status,400)
  assert.equal((await app.call(P+'/tickets')).status,401)
  assert.equal((await app.call(P+`/tickets/${trap.id}`,rosa)).status,404)
  assert.equal((await app.call(P+'/tickets',rosa)).data.tickets.length,0)
  const create=(await app.call(`${api}/${form.id}/submissions`,{...rosa,body:valid,status:201})).data,id=create.ticket.id
  const nativeTicket=(await app.ok(`/api/management/projects/${p}/conversations/${id}/ticket`,owner)).data
  const view=(await app.ok(`/api/dashboard/projects/${p}/ticket-views`,{...owner,body:{name:'Open refund requests',visibility:'shared',filters:[{field:'status_category',operator:'eq',value:nativeTicket.status_category},{field:'custom:'+f.reason.id,operator:'eq',value:'refund'}],sort:[]}})).data
  const queue=(await app.ok(`/api/dashboard/projects/${p}/conversations?saved_view=${view.id}`,owner)).data
  assert.ok(queue.some(ticket=>ticket.id===id));assert.equal((await app.first('SELECT value_json FROM ticket_field_values WHERE conversation_id=? AND field_id=?',id,f.order.id)).value_json,JSON.stringify(valid.fields[f.order.id]))
  // Portal first, then real authenticated inbound mail: a separate ticket with
  // one requester, visible immediately and after another mailbox verification.
  const emailed=await app.ok('/api/integrations/email/inbound',{headers:{Authorization:'Bearer fixture-survey-signing-key-for-self-service'},body:{messageId:'rosa-mail-after-portal',to:'help@example.com',from:'rosa@example.com',subject:'Delivery of my replacement order',text:'When will my replacement order arrive?'}})
  const emailId=emailed.conversationId
  assert.notEqual(emailId,id)
  assert.deepEqual(new Set((await app.ok(P+'/tickets',rosa)).tickets.map(t=>t.id)),new Set([id,emailId]))
  assert.equal((await app.first('SELECT contact_id FROM conversations WHERE id=?',emailId)).contact_id,create.ticket.contact_id??(await app.first('SELECT contact_id FROM conversations WHERE id=?',id)).contact_id)
  const fresh=await signin('rosa@example.com')
  assert.deepEqual(new Set((await app.ok(P+'/tickets',fresh)).tickets.map(t=>t.id)),new Set([id,emailId]))
  let emailTicket=(await app.ok(P+`/tickets/${emailId}`,rosa)).ticket
  await app.ok(P+`/tickets/${emailId}/reply`,{...rosa,body:{localId:'portal-on-email',content:'Please send the tracking number.',expectedRevision:emailTicket.revision}})
  await app.ok(`/api/dashboard/projects/${p}/conversations/${emailId}`,{...owner,method:'PUT',body:{resolved:true}})
  emailTicket=(await app.ok(P+`/tickets/${emailId}`,rosa)).ticket
  await app.ok(P+`/tickets/${emailId}/reopen`,{...rosa,body:{expectedRevision:emailTicket.revision}})
  assert.equal((await app.ok(P+`/tickets/${emailId}`,rosa)).ticket.status,'open')
  assert.equal((await app.call(P+`/tickets/${emailId}`,other)).status,404)
  const secret=(await app.first('SELECT verification_secret FROM projects WHERE id=?',p)).verification_secret
  const signed=await app.ok('/api/identity/widget/session',{headers:{Origin:f.workspace.allowedOrigin},body:{widgetKey:f.workspace.widgetKey,email:'rosa@example.com',contact_hash:createHmac('sha256',secret).update('rosa@example.com').digest('hex')}})
  assert.equal(signed.contactId,(await app.first('SELECT contact_id FROM conversations WHERE id=?',id)).contact_id)
  const signedThread=await app.ok('/api/conversations',{token:signed.token,body:{projectId:p}})
  await app.ok(`/api/conversations/${signedThread.id}/messages`,{token:signed.token,body:{localId:'signed-widget-question',content:'An update from my account.',expectedRevision:0}})
  assert.equal((await app.call(P+`/tickets/${signedThread.id}`,rosa)).status,200)
  // Unsigned mail impersonating this proven mailbox is kept apart, even when
  // sent after the customer's proof and after a signed widget visit.
  await app.email('From: Rosa <rosa@example.com>\r\nTo: help@example.com\r\nMessage-ID: <spoof-rosa>\r\nSubject: Forged request\r\n\r\nThis is an unproven sender.',{from:'rosa@example.com',to:'help@example.com'})
  const spoof=(await app.ok(`/api/management/projects/${p}/suspended`,owner)).data.find(entry=>entry.subject==='Forged request')
  assert.ok(spoof)
  const held=(await app.ok(`/api/management/projects/${p}/suspended/${spoof.id}`,owner)).data
  assert.equal((await app.first('SELECT state FROM inbound_emails WHERE id=?',held.receipt_id)).state,'suspended')
  assert.equal(await app.first("SELECT id FROM conversations WHERE project_id=? AND subject='Forged request'",p),null)
  assert.equal((await app.call(P+`/tickets/${spoof.id}`,rosa)).status,404)
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
  const survey=new URL(solved.survey.url);assert.match(survey.pathname,/\.portal\./);
  assert.equal((await app.request(survey.pathname.replace('.portal.','.'))).status,404,'response surface cannot be forged without its signature');assert.equal((await app.request(survey.pathname)).status,200)
  assert.equal((await app.request(survey.pathname,{body:{score:4,reason:'outcome',comment:'Thank you for the clear answer'}})).status,200)
  assert.equal((await app.call(survey.pathname,{body:{score:4}})).status,410)
  const portalResult=(await app.ok(`/api/outcomes/projects/${p}/results`,owner)).results.find(row=>row.conversationId===id)
  assert.equal(portalResult.response.channel,'portal');assert.equal(portalResult.response.invitationChannel,'email')
  await app.ok(P+`/tickets/${id}/reopen`,{...rosa,body:{expectedRevision:solved.ticket.revision}})
  assert.equal((await detail()).ticket.status,'open');assert.equal((await app.call(survey.pathname)).status,410)
  const history=await app.sql('SELECT source FROM ticket_history WHERE conversation_id=?',id);assert.ok(history.some(h=>h.source==='portal'))
  // This customer's email ticket also receives a separately signed email-channel survey.
  f.allowSurveyMail();const surveyMailBefore=mail.length
  emailTicket=(await app.ok(P+`/tickets/${emailId}`,rosa)).ticket
  await app.ok(P+`/tickets/${emailId}/reply`,{...rosa,body:{localId:'new-delivery-followup',content:'The replacement has arrived. Thank you.',expectedRevision:emailTicket.revision}})
  await app.ok(`/api/dashboard/projects/${p}/conversations/${emailId}`,{...owner,method:'PUT',body:{resolved:true}});await app.scheduled()
  const invitation=mail.slice(surveyMailBefore).find(message=>message.text?.includes('/api/outcomes/surveys/')&&message.text.includes('.email.'))
  assert.ok(invitation,'the solved email request receives its own survey')
  const emailSurvey=invitation.text.match(/https:\/\/app\.example(\/api\/outcomes\/surveys\/[^\s)]+)/)[1]
  assert.equal((await app.request(emailSurvey)).status,200,'scanners do not consume the survey')
  assert.equal((await app.request(emailSurvey,{body:{score:5,reason:'outcome',comment:'The emailed answer solved my request'}})).status,200)
  assert.equal((await app.request(emailSurvey,{body:{score:1}})).status,410)
  const emailResult=(await app.ok(`/api/outcomes/projects/${p}/results`,owner)).results.find(row=>row.conversationId===emailId)
  assert.equal(emailResult.response.channel,'email');assert.equal(emailResult.response.comment,'The emailed answer solved my request')
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
  await accountLookupJourney(f,rosa)
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
