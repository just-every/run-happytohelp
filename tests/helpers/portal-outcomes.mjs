import assert from 'node:assert/strict'
import {portalRecovery} from './portal-recovery.mjs'

// Exercise only portal outcomes. The existing signed-in form is ticket setup;
// form validation/anonymous submission remain FORMS-001's acceptance.
export async function portalOutcomes(f){
 const {app,p,owner,signin}=f,P=`/api/portal/${p}`,base=`/api/management/projects/${p}`
 const people=await Promise.all(['recovery@harbor.example','reader@orchard.example','member@harbor.example'].map(email=>signin(email)))
 const contacts=await Promise.all(people.map(person=>app.ok(P+'/preferences',person).then(row=>app.first('SELECT contact_id FROM portal_identities WHERE project_id=? AND email=?',p,row.email))))
 const companies=[]
 for(const name of ['Harbor','Orchard'])companies.push((await app.ok(base+'/companies',{...owner,body:{name,portalCompanyView:false}})).company)
 for(let i=0;i<people.length;i++)await app.ok(`${base}/companies/${companies[i===1?1:0].id}/members/${contacts[i].contact_id}`,{...owner,method:'PUT',body:{}})
 const tickets=[]
 for(let i=0;i<people.length;i++)tickets.push((await app.ok(`${f.api}/${f.form.id}/submissions`,{...people[i],body:{...f.valid,localId:'portal-outcome-'+i,subject:['Harbor shipment','Orchard invoice','Harbor shared request'][i]}})).ticket)
 const exactList=async(person,ids)=>{const rows=(await app.ok(P+'/tickets',person)).tickets;assert.equal(rows.length,ids.length);assert.deepEqual(rows.map(row=>row.id).sort(),[...ids].sort())}
 // Two separately verified customers in different companies: exact rows in both directions.
 for(let i=0;i<2;i++){
  await exactList(people[i],[tickets[i].id])
  const path=P+`/tickets/${tickets[i].id}`,initial=await app.ok(path,people[i])
  assert.equal(initial.ticket.subject,tickets[i].subject)
  assert.equal(initial.messages[0].content,f.valid.message)
  const file=await app.ok(path+'/attachments',{...people[i],raw:true,body:'Private receipt '+i,headers:{...people[i].headers,'Content-Type':'text/plain','X-Filename':'receipt.txt'}})
  tickets[i].file=file.id
  await app.ok(path+'/reply',{...people[i],body:{localId:'own-reply-'+i,content:'Customer follow-up '+i,expectedRevision:initial.ticket.revision,mediaIds:[file.id]}})
  await app.ok(`/api/dashboard/projects/${p}/conversations/${tickets[i].id}`,{...owner,method:'PUT',body:{resolved:true}})
  const solved=await app.ok(path,people[i]);assert.equal(solved.ticket.status,'solved')
  await refusedTicket(f,people[1-i],tickets[i])
  await app.ok(path+'/reopen',{...people[i],body:{expectedRevision:solved.ticket.revision}})
  const history=await app.ok(path,people[i]);assert.equal(history.ticket.status,'open')
  assert.deepEqual(history.messages.map(row=>row.content),[...initial.messages.map(row=>row.content),'Customer follow-up '+i],'portal reads the complete customer conversation')
  assert.ok((await app.sql('SELECT source FROM ticket_history WHERE conversation_id=?',tickets[i].id)).some(row=>row.source==='portal'))
 }
 // Explicit grant, then membership and entitlement removal fence issued links immediately.
 const companyPath=base+`/companies/${companies[0].id}`
 await app.ok(companyPath,{...owner,method:'PATCH',body:{portalCompanyView:true}})
 await exactList(people[2],[tickets[0].id,tickets[2].id]);await exactList(people[1],[tickets[1].id])
 const issued=P+`/tickets/${tickets[0].id}/attachments/${tickets[0].file}`
 assert.equal(await (await app.request(issued,people[2])).text(),'Private receipt 0')
 await app.ok(companyPath+`/members/${contacts[2].contact_id}`,{...owner,method:'DELETE'})
 await exactList(people[2],[tickets[2].id]);await refusedTicket(f,people[2],tickets[0])
 assert.equal((await app.call(P+'/preferences',people[2])).status,200,'membership removal keeps the personal session')
 await app.ok(companyPath+`/members/${contacts[2].contact_id}`,{...owner,method:'PUT',body:{}})
 assert.equal((await app.request(issued,people[2])).status,200)
 await app.ok(companyPath,{...owner,method:'PATCH',body:{portalCompanyView:false}})
 await exactList(people[2],[tickets[2].id]);await refusedTicket(f,people[2],tickets[0])
 assert.equal((await app.call(people[1].path)).status,400)
 await exactList(await signin('reader@orchard.example'),[tickets[1].id])
 await portalRecovery(f,{person:people[0],email:'recovery@harbor.example',ticket:tickets[0],contact:contacts[0].contact_id,forbidden:[tickets[1].id,tickets[2].id]})
 // A foreign request ID and a valid session in the wrong workspace never confer authority.
 const foreignWidget=await app.ok('/api/identity/widget/session',{headers:{Origin:f.foreign.allowedOrigin},body:{widgetKey:f.foreign.widgetKey}})
 const foreign=await app.ok('/api/conversations',{token:foreignWidget.token,body:{projectId:f.foreign.projectId}})
 await app.ok(`/api/conversations/${foreign.id}/messages`,{token:foreignWidget.token,body:{localId:'foreign-request',content:'Orchard private history',expectedRevision:0}})
 await refusedTicket(f,people[1],{id:foreign.id,file:tickets[0].file})
 for(const person of [people[1],{headers:{Cookie:'h2h_portal='+f.workspace.tokens.owner}},{headers:{Cookie:'h2h_portal='+'0'.repeat(64)}}]){
  const workspace=person===people[1]?f.foreign.projectId:p
  assert.equal((await app.call(`/api/portal/${workspace}/tickets`,person)).status,401)
 }
 // No request-delete product door exists: stage a genuinely absent ID in D1,
 // removing dependent rows in foreign-key order while retaining the issued URL.
 await app.db.batch(deletedRequestStatements(tickets[1].id).map(sql=>app.db.prepare(sql)))
 await exactList(people[1],[]);await refusedTicket(f,people[1],tickets[1])
 assert.equal((await app.call(P+'/preferences',people[1])).status,200,'missing request does not revoke its owner')
 await app.ok(base+`/contacts/${contacts[2].contact_id}/erase`,{...owner,body:{}})
 const after=await snapshot(app)
 for(const path of ['/tickets','/tickets/'+tickets[2].id,'/tickets/'+tickets[0].id+'/attachments/'+tickets[0].file])assert.equal((await app.call(P+path,people[2])).status,401)
 assert.equal((await app.first('SELECT count(*) n FROM portal_session_proofs WHERE contact_id=?',contacts[2].contact_id)).n,0)
 assert.deepEqual(await snapshot(app),after,'refusals never restore erased data')
}

const snapshot=async app=>({tickets:await app.sql('SELECT id,revision,status_category,contact_id FROM conversations ORDER BY id'),messages:await app.sql('SELECT id,content,revision FROM messages ORDER BY id'),media:await app.sql('SELECT id,message_id FROM media ORDER BY id')})
export async function refusedTicket(f,person,ticket){
 const {app,p}=f,P=`/api/portal/${p}/tickets/`,before=await snapshot(app)
 for(const action of ['', '/reply','/reopen','/attachments','/attachments/'+ticket.file]){
  const options={...person,...(action==='/attachments'?{raw:true,body:'Forbidden bytes',headers:{...person.headers,'Content-Type':'text/plain','X-Filename':'denied.txt'}}:action==='/reply'||action==='/reopen'?{body:{localId:'forbidden-'+ticket.id,content:'Forbidden message',expectedRevision:1}}:{})}
  const denied=await app.call(P+ticket.id+action,options),missing=await app.call(P+'missing-request'+action,options)
  assert.equal(denied.status,404);assert.equal(missing.status,404)
  assert.deepEqual(denied.data,missing.data,'no existence leak on '+action)
 }
 assert.deepEqual(await snapshot(app),before,'denied deep links change no ticket, message or media')
}

// Fixture-only removal: no public request deletion command exists. Keep D1's
// foreign keys active, and remove only this synthetic request's dependents.
export function deletedRequestStatements(id){
 const value="'"+id.replaceAll("'","''")+"'",where='conversation_id='+value
 const statements=[]
 for(const table of ['csat_response_history','csat_responses'])statements.push(`DELETE FROM ${table} WHERE resolution_id IN (SELECT id FROM conversation_resolutions WHERE ${where})`)
 statements.push(`DELETE FROM csat_surveys WHERE ${where}`)
 for(const table of ['conversation_rating_history','conversation_ratings'])statements.push(`DELETE FROM ${table} WHERE resolution_id IN (SELECT id FROM conversation_resolutions WHERE ${where})`)
 for(const table of ['conversation_outbox','operator_notification_activity','media'])statements.push(`DELETE FROM ${table} WHERE ${where}`)
 statements.push(`DELETE FROM message_authorship WHERE message_id IN (SELECT id FROM messages WHERE ${where})`)
 for(const table of ['messages','conversation_buckets','conversation_reads','conversation_notes','conversation_participants','conversation_ai','conversation_tags','conversation_tracking','conversation_handoffs','conversation_resolutions','email_reply_grants','operator_notifications','triage_jobs','triage_labels'])statements.push(`DELETE FROM ${table} WHERE ${where}`)
 statements.push(`DELETE FROM conversations WHERE id=${value}`)
 return statements
}
