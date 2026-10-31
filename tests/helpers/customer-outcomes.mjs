import assert from 'node:assert/strict'
import {createHmac} from 'node:crypto'
import {sha} from '../journeys/kit/app.mjs'
import {selfServiceFixture} from './self-service-fixture.mjs'
import {customerEdgeOutcomes} from './customer-outcomes-edges.mjs'

// CUSTOMER-001: extend the existing account journey, without another registration.
// Writes go through native doors; SQL only observes state or injects a commit race.
export async function customerOutcomes(){
 const f=await selfServiceFixture(),{app,p,owner,workspace:w,foreign,signin}=f,B=`/api/management/projects/${p}`,P=`/api/portal/${p}`
 try{
  await app.ok(B+'/availability',{...owner,method:'PUT',body:{is_presence_away_enabled:false}})
  const email='customer-outcomes@example.test',portal=await signin(email)
  await app.ok(P+'/preferences',{...portal,method:'PUT',body:{locale:'fr',surveyEmails:false,updateEmails:false}})
  const secret=(await app.first('SELECT verification_secret FROM projects WHERE id=?',p)).verification_secret
  const signed=identifier=>app.ok('/api/identity/widget/session',{headers:{Origin:w.allowedOrigin},body:{widgetKey:w.widgetKey,identifier,email:identifier,contact_hash:createHmac('sha256',secret).update(identifier).digest('hex')}})
  const chat=await signed(email),linked=await signed('other-verified@example.test')
  const typed=await app.ok('/api/identity/widget/session',{headers:{Origin:w.allowedOrigin},body:{widgetKey:w.widgetKey,email}})
  assert.notEqual(typed.contactId,chat.contactId,'typing a proven mailbox never joins its record')
  const open=async(person,text)=>{
   const ticket=await app.ok('/api/conversations',{token:person.token,body:{projectId:p}})
   await app.ok(`/api/conversations/${ticket.id}/messages`,{token:person.token,body:{localId:text,content:text,expectedRevision:0}})
   return ticket
  }
  const chatTicket=await open(chat,'Chat about a delivery'),linkedTicket=await open(linked,'Separate verified identity history'),trap=await open(typed,'Typed-email private history')
  await app.ok(`/api/conversations/${chatTicket.id}/widget-events`,{token:chat.token,body:{action:'contextConsent',data:{consent:false}}})
  await app.ok(`/api/dashboard/projects/${p}/conversations/${chatTicket.id}`,{...owner,method:'PUT',body:{resolved:true}})
  const inbound=await app.ok('/api/integrations/email/inbound',{headers:{Authorization:'Bearer fixture-survey-signing-key-for-self-service'},body:{messageId:'customer-outcomes-email',to:'help@example.com',from:email,subject:'Email about a return',text:'My email interaction'}})
  assert.equal(inbound.actor.contactId,chat.contactId,'authenticated email and signed chat have one requester')
  const record=async id=>(await app.ok(`${B}/contacts/${id}`,owner)).data
  const history=async id=>(await app.ok(`${B}/contacts/${id}/conversations`,owner)).data
  assert.equal((await record(chat.contactId)).id,chat.contactId)
  assert.deepEqual(new Set((await history(chat.contactId)).map(row=>row.id)),new Set([chatTicket.id,inbound.conversationId]))
  assert.deepEqual(new Set((await history(chat.contactId)).map(row=>row.preview)),new Set(['Chat about a delivery','My email interaction']))
  assert.ok(!(await history(chat.contactId)).some(row=>[trap.id,linkedTicket.id].includes(row.id)))

  const field=(await app.ok(B+'/company-fields',{...owner,body:{name:'Seat count',type:'number'}})).field
  const company=(await app.ok(B+'/companies',{...owner,body:{name:'Outcome account',attributes:{[field.id]:4}}})).company
  for(const id of [chat.contactId,linked.contactId])await app.ok(`${B}/companies/${company.id}/members/${id}`,{...owner,method:'PUT',body:{}})
  const companyPath=`${B}/companies/${company.id}`,detail=()=>app.ok(companyPath,owner)
  const account=await detail()
  assert.deepEqual(new Set(account.members.map(member=>member.id)),new Set([chat.contactId,linked.contactId]))
  assert.deepEqual(new Set(account.tickets.map(ticket=>ticket.id)),new Set([chatTicket.id,inbound.conversationId,linkedTicket.id]))
  assert.ok(account.tickets.some(ticket=>ticket.id===inbound.conversationId&&ticket.status_category!=='solved'))
  assert.ok(account.tickets.some(ticket=>ticket.id===chatTicket.id&&ticket.status_category==='solved'))
  await app.ok(companyPath,{...owner,method:'PATCH',body:{attributes:{[field.id]:8}}})
  const edited=await detail()
  assert.equal(edited.company.attributes[field.id],8)
  const change=edited.history.find(row=>row.action==='updated')
  assert.equal(change.actorId,w.users.owner);assert.ok(change.at>0)
  assert.equal(change.provenance.before.attributes[field.id],4);assert.equal(change.provenance.after.attributes[field.id],8)
  assert.equal((await app.call(companyPath,{...owner,method:'PATCH',body:{attributes:{[field.id]:'eight'}}})).status,400)
  assert.deepEqual(await detail(),edited,'invalid typed edit leaves values and history unchanged')

  const outsider=(await app.ok(B+'/contacts',{...owner,body:{name:'Other account',email:'outside@example.test'}})).data
  const otherCompany=(await app.ok(B+'/companies',{...owner,body:{name:'Other account',attributes:{[field.id]:99},portalCompanyView:true}})).company
  await app.ok(`${B}/companies/${otherCompany.id}/members/${outsider.id}`,{...owner,method:'PUT',body:{}})
  const otherTicket=await app.ok('/api/conversations',{...owner,body:{projectId:p,contactId:outsider.id}})
  assert.ok(!(await detail()).tickets.some(ticket=>ticket.id===otherTicket.id))
  for(const identity of [{token:chat.token},portal]){
   for(const path of [`${B}/companies/${otherCompany.id}`,`${B}/contacts/${outsider.id}`,`${B}/contacts/${outsider.id}/conversations`])assert.equal((await app.call(path,identity)).status,identity===portal?401:403)
   assert.equal((await app.call(P+`/tickets/${otherTicket.id}`,identity)).status,identity===portal?404:401)
  }
  const F=`/api/management/projects/${foreign.projectId}`,foreignOwner={token:foreign.tokens.owner}
  for(const path of [`/companies/${company.id}`,`/contacts/${chat.contactId}`,`/contacts/${chat.contactId}/conversations`])assert.equal((await app.call(F+path,foreignOwner)).status,404)
  assert.deepEqual((await app.ok(F+'/companies',foreignOwner)).companies,[])
  assert.deepEqual((await app.ok(F+'/contacts',foreignOwner)).data,[])
  assert.equal((await app.call(`/api/conversations/${chatTicket.id}/messages`,{token:foreign.tokens.owner})).status,404)

  await app.ok(B+'/agents/'+w.users.operator,{...owner,method:'PUT',body:{role:'collaborator'}})
  const linkPath=`${B}/contacts/${chat.contactId}/identity-links`,intent={action:'link',contact_id:linked.contactId,provenance:'Customer confirmed both verified support identities in request OUTCOME-1'}
  const counts=async()=>Object.fromEntries(await Promise.all(['contacts','messages','sessions'].map(async table=>[table,(await app.first(`SELECT count(*) n FROM ${table} WHERE project_id=?`,p)).n])))
  const refused=async(path,options,status,restore=async()=>{})=>{
   const before=await counts(),links=await app.ok(linkPath,owner)
   assert.equal((await app.call(path,options)).status,status)
   await restore()
   assert.deepEqual(await counts(),before,'refused identity operation changes no customers, messages or sessions')
   assert.deepEqual(await app.ok(linkPath,owner),links)
  }
  const preview=(await app.ok(linkPath+'/preview',{...owner,body:intent})).preview
  assert.equal(preview.grants_customer_access,false);assert.ok(preview.contacts.every(contact=>contact.proof))
  assert.equal((await app.ok(linkPath,owner)).links.length,0)
  await refused(linkPath+'/preview',{...owner,body:{...intent,contact_id:typed.contactId}},409)
  await refused(linkPath,{token:w.tokens.operator,body:preview},403)
  await refused(linkPath,{token:chat.token,body:preview},403)
  await app.ok(B+'/contacts/'+linked.contactId,{...owner,method:'PUT',body:{name:'Updated verified identity'}})
  await refused(linkPath,{...owner,body:preview},409)
  const fresh=(await app.ok(linkPath+'/preview',{...owner,body:intent})).preview
  await refused(linkPath,{...owner,body:fresh,headers:{'x-test-before-batch':`UPDATE contacts SET is_verified=0 WHERE id='${linked.contactId}'`}},409)
  await app.db.prepare('UPDATE contacts SET is_verified=1 WHERE id=?').bind(linked.contactId).run()
  const sessionReview=(await app.ok(linkPath+'/preview',{...owner,body:intent})).preview
  await refused(linkPath,{...owner,body:sessionReview,headers:{'x-test-before-batch':`UPDATE sessions SET revoked_at=1 WHERE token_hash='${sha(w.tokens.owner)}'`}},409,()=>app.db.prepare('UPDATE sessions SET revoked_at=NULL WHERE token_hash=?').bind(sha(w.tokens.owner)).run())

  const preferences=()=>app.ok(P+'/preferences',portal)
  const retained=async()=>({
   preferences:await preferences(),
   consent:await app.sql('SELECT project_id,subject_id,consent,bot_enabled,help_types FROM context_subjects WHERE project_id=? AND subject_id IN (?,?,?,?) ORDER BY subject_id',p,chat.contactId,linked.contactId,typed.contactId,outsider.id),
   history:await history(chat.contactId),
   messages:await app.sql('SELECT * FROM messages WHERE project_id=? ORDER BY id',p),
   sessions:await app.sql('SELECT token_hash,contact_id,role,revoked_at,expires_at FROM sessions WHERE project_id=? ORDER BY token_hash',p),
   portalTickets:(await app.ok(P+'/tickets',portal)).tickets.map(ticket=>ticket.id).sort(),
  })
  await app.takeJobs() // Discard setup work before measuring these no-send operations.
  const before=await retained(),noSend={requests:app.requests.length,jobs:0}
  const unchanged=async()=>{
   assert.deepEqual(await retained(),before,'consent, preferences, complete history and customer authority survive')
   assert.equal(app.requests.length,noSend.requests,'no mail, widget or provider request')
   assert.equal((await app.takeJobs()).length,noSend.jobs,'no queued sending')
   assert.equal((await app.call(`/api/conversations/${linkedTicket.id}/messages`,{token:chat.token})).status,404)
   assert.equal((await app.call(P+`/tickets/${linkedTicket.id}`,portal)).status,404)
   assert.equal((await app.call(`/api/conversations/${chatTicket.id}/messages`,{token:linked.token})).status,404)
  }
  const apply=async body=>app.ok(linkPath,{...owner,body:(await app.ok(linkPath+'/preview',{...owner,body})).preview})
  const identityBefore=await counts()
  await apply(intent)
  const association=await app.ok(linkPath,owner),link=association.links[0]
  assert.equal(link.contact.id,linked.contactId);assert.equal(link.actor_id,w.users.owner);assert.ok(link.created_at>0);assert.equal(link.provenance,intent.provenance)
  assert.equal(association.grants_customer_access,false)
  assert.equal((await app.ok(`${B}/contacts/${linked.contactId}/identity-links`,owner)).links[0].contact.id,chat.contactId)
  assert.ok((await history(link.contact.id)).some(row=>row.id===linkedTicket.id),'staff can open the linked history as separate context')
  assert.equal((await app.call(linkPath,{token:w.tokens.operator})).status,403,'staff context obeys role scope')
  assert.deepEqual(await counts(),identityBefore);await unchanged()
  const reason='Customer asked to keep these support identities separate'
  await apply({...intent,action:'unlink',provenance:reason})
  const decisions=await app.ok(linkPath,owner)
  assert.equal(decisions.links.length,0)
  assert.deepEqual(decisions.history.map(row=>[row.action,row.provenance,row.actor_id]),[['unlinked',reason,w.users.owner],['linked',intent.provenance,w.users.owner]])
  assert.ok(decisions.history.every(row=>row.at>0))
  const security=(await app.ok(B+'/audit?limit=200',owner)).data
  for(const action of ['customer.identity_linked','customer.identity_unlinked'])assert.ok(security.some(row=>row.action===action&&row.actor_id===w.users.owner))
  assert.deepEqual(await counts(),identityBefore);await unchanged()

  const I=B+'/customer-imports',business=async()=>({
   contacts:await app.sql('SELECT * FROM contacts WHERE project_id=? ORDER BY id',p),
   companies:await app.sql('SELECT id,project_id,name,attributes_json,portal_company_view,created_at,merged_into FROM companies WHERE project_id=? ORDER BY id',p),
   members:await app.sql('SELECT * FROM contact_companies WHERE project_id=? ORDER BY contact_id',p),
   domains:await app.sql('SELECT * FROM company_domains WHERE project_id=? ORDER BY domain',p),
  })
  const ambiguous=await app.ok(I+'/preview',{...owner,body:{kind:'contacts',csv:'Name,Email\nAmbiguous update,'+email,mapping:{name:'Name',email:'Email'}}})
  assert.equal(ambiguous.rows[0].action,'skip');assert.match(ambiguous.rows[0].reason,/ambiguous|conflicts/i)
  const matchedEmail=await app.ok(I+'/preview',{...owner,body:{kind:'contacts',csv:'Name,Email\nMatched mailbox,other-verified@example.test',mapping:{name:'Name',email:'Email'}}})
  assert.equal(matchedEmail.rows[0].entityId,linked.contactId);assert.equal(matchedEmail.rows[0].action,'update')
  // Correct the visitor's unproven address through the operator door before importing.
  await app.ok(B+'/contacts/'+typed.contactId,{...owner,method:'PUT',body:{email:null}})
  const businessBefore=await business() // Company revision/updated_at remain monotonic guard metadata.
  const input={kind:'contacts',csv:`Display,External,Account\nImported name,${email},Outcome account\nDuplicate,${email},Outcome account\nInvalid,invalid-row,Unknown account\nNew customer,new-outcome,Outcome account`,mapping:{name:'Display',externalId:'External',company:'Account'}}
  const run=await app.ok(I+'/preview',{...owner,body:input})
  assert.deepEqual(run.counts,{create:1,update:1,skip:2})
  assert.equal(run.rows[0].entityId,chat.contactId);assert.equal(run.rows[0].data.name,'Imported name');assert.equal(run.rows[0].data.company,'Outcome account')
  assert.equal(run.rows[1].action,'skip');assert.match(run.rows[1].reason,/duplicate/i)
  assert.equal(run.rows[2].row,4);assert.equal(run.rows[2].action,'skip');assert.match(run.rows[2].reason,/company not found/i)
  assert.deepEqual(await business(),businessBefore);await unchanged()
  await app.ok(`${I}/${run.id}/apply`,{...owner,body:{}})
  assert.equal((await record(chat.contactId)).name,'Imported name')
  assert.equal((await app.ok(B+'/contacts?search=invalid-row',owner)).data.length,0)
  const applied=await business();await unchanged()
  await app.ok(`${I}/${run.id}/apply`,{...owner,body:{}})
  assert.deepEqual(await business(),applied,'repeating apply changes nothing');await unchanged()
  await app.ok(`${I}/${run.id}/undo`,{...owner,body:{}})
  assert.deepEqual(await business(),businessBefore,'whole contact import restores exact pre-import business state');await unchanged()
  const external=await app.ok(I+'/preview',{...owner,body:{kind:'contacts',csv:`Display,External\nMatched by external ID,${email}`,mapping:{name:'Display',externalId:'External'}}})
  assert.equal(external.rows[0].entityId,chat.contactId);assert.equal(external.rows[0].action,'update');await unchanged()
  const companies=await app.ok(I+'/preview',{...owner,body:{kind:'companies',csv:'Account,Seats\nOutcome account,12\nNew company,2\nInvalid company,not-a-number',mapping:{name:'Account',['attribute:'+field.id]:'Seats'}}})
  assert.deepEqual(companies.counts,{create:1,update:1,skip:1})
  assert.equal(companies.rows[2].row,4);assert.equal(companies.rows[2].reason,'Invalid value for Seat count');await unchanged()
  await app.ok(`${I}/${companies.id}/apply`,{...owner,body:{}})
  assert.equal((await detail()).company.attributes[field.id],12);await unchanged()
  await app.ok(`${I}/${companies.id}/undo`,{...owner,body:{}})
  assert.deepEqual(await business(),businessBefore,'whole company import restores exact pre-import business state');await unchanged()
 }finally{await app.close()}
 await customerEdgeOutcomes()
}
