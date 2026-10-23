import assert from 'node:assert/strict'
import {createHmac} from 'node:crypto'
import {startApp,sha} from '../journeys/kit/app.mjs'

export async function companyRecordsJourney(){
 const app=await startApp({captureQueue:true}),w=await app.seedWorkspace('companies'),other=await app.seedWorkspace('foreign-companies'),p=w.projectId,owner={token:w.tokens.owner},B=`/api/management/projects/${p}`
 try{
  const defs={}
  for(const [type,value,options] of [['text','US distribution'],['number',125],['date','2026-10-20'],['dropdown','Enterprise',['Standard','Enterprise']],['checkbox',true]]){
   const field=(await app.ok(B+'/company-fields',{...owner,body:{name:type,type,...(options?{options}:{})}})).field
   defs[type]={field,value}
  }
  const attributes=Object.fromEntries(Object.values(defs).map(({field,value})=>[field.id,value]))
  const company=(await app.ok(B+'/companies',{...owner,body:{name:'Northstar Supply',domains:['northstar.example'],attributes}})).company
  assert.equal(company.portalCompanyView,false)
  assert.deepEqual(company.attributes,attributes)
  assert.equal((await app.call(`${B}/companies/${company.id}`,{...owner,method:'PATCH',body:{attributes:{[defs.number.field.id]:'invalid'}}})).status,400)
  const contacts=[]
  for(const name of ['Alex','Bea','Chen']){
   const contact=(await app.ok(B+'/contacts',{...owner,body:{name,email:name.toLowerCase()+'@northstar.example'}})).data;contacts.push(contact)
   await app.ok(`${B}/companies/${company.id}/members/${contact.id}`,{...owner,method:'PUT',body:{}})
  }
  const source=(await app.ok(B+'/companies',{...owner,body:{name:'Northstar West',domains:['west.example'],attributes:{[defs.number.field.id]:50},portalCompanyView:true}})).company
  const preview=(await app.ok(`${B}/companies/${company.id}/merge/preview`,{...owner,body:{sourceId:source.id}})).preview
  await app.ok(`${B}/agents/${w.users.operator}`,{...owner,method:'PUT',body:{role:'collaborator'}})
  assert.equal((await app.call(`${B}/companies/${company.id}/merge/preview`,{token:w.tokens.operator,body:{sourceId:source.id}})).status,403)
  assert.ok(preview.conflicts.some(conflict=>conflict.fieldId===defs.number.field.id))
  const path=`${B}/companies/${company.id}/merge`,mergeBody={sourceId:source.id,preview}
  await app.db.prepare('UPDATE session_factors SET verified_at=1 WHERE token_hash=?').bind(sha(w.tokens.owner)).run()
  assert.equal((await app.call(path,{...owner,body:mergeBody})).data.code,'step_up_required')
  await app.db.prepare('UPDATE session_factors SET verified_at=? WHERE token_hash=?').bind(Date.now(),sha(w.tokens.owner)).run()
  const merged=await app.ok(path,{...owner,body:mergeBody})
  assert.equal(merged.company.portalCompanyView,false)
  assert.deepEqual(merged.domains,['northstar.example','west.example'])
  assert.equal(merged.members.length,3)
  assert.equal((await app.call(`/api/management/projects/${other.projectId}/companies/${company.id}`,{token:other.tokens.owner})).status,404)
  assert.equal((await app.call(`${B}/companies/${source.id}`,owner)).status,404)
  assert.ok(merged.history.some(row=>row.action==='merged'&&row.provenance))
  await app.ok(`${B}/companies/${company.id}/history/${merged.historyId}/undo`,{...owner,body:{}})
  assert.equal((await app.ok(`${B}/companies/${source.id}`,owner)).company.name,'Northstar West')
  const stale=(await app.ok(`${B}/companies/${company.id}/merge/preview`,{...owner,body:{sourceId:source.id}})).preview
  await app.ok(`${B}/companies/${source.id}`,{...owner,method:'PATCH',body:{name:'Northstar Pacific'}})
  assert.equal((await app.call(path,{...owner,body:{sourceId:source.id,preview:stale}})).status,409)
  // Identity associations are a separate, reviewed operator record. They never
  // merge sessions, transfer conversations or make typed email into proof.
  const secret=(await app.first('SELECT verification_secret FROM projects WHERE id=?',p)).verification_secret
  const signed=async identifier=>app.ok('/api/identity/widget/session',{body:{widgetKey:w.widgetKey,identifier,contact_hash:createHmac('sha256',secret).update(identifier).digest('hex'),name:identifier},headers:{Origin:w.allowedOrigin}})
  const [alice,social]=await Promise.all([signed('synthetic-happytohelp-1'),signed('synthetic-happytohelp-2')])
  const linkPath=`${B}/contacts/${alice.contactId}/identity-links`,intent={action:'link',contact_id:social.contactId,provenance:'Verified source support request synthetic-happytohelp-3'}
  const review=(await app.ok(linkPath+'/preview',{...owner,body:intent})).preview
  assert.equal(review.grants_customer_access,false)
  assert.ok(review.contacts.every(c=>c.proof==='signed_widget'))
  assert.equal((await app.ok(linkPath,owner)).links.length,0,'preview has no effect')
  assert.equal((await app.call(linkPath,{token:w.tokens.operator,body:review})).status,403,'collaborator cannot link identities')
  assert.equal((await app.call(linkPath,{token:alice.token,body:review})).status,403,'a customer cannot link another identity')
  assert.equal((await app.call(linkPath+'/preview',{...owner,body:{...intent,contact_id:contacts[1].id}})).status,409,'typed email has no identity proof')
  assert.equal((await app.call(`/api/management/projects/${other.projectId}/contacts/${alice.contactId}/identity-links/preview`,{token:other.tokens.owner,body:intent})).status,404)
  await app.db.prepare('UPDATE contacts SET name=? WHERE id=?').bind('Changed identity',social.contactId).run()
  assert.equal((await app.call(linkPath,{...owner,body:review})).status,409,'changed identity invalidates its preview')
  const apply=async body=>app.ok(linkPath,{...owner,body:(await app.ok(linkPath+'/preview',{...owner,body})).preview})
  const authorityReview=(await app.ok(linkPath+'/preview',{...owner,body:intent})).preview
  const refused=await app.call(linkPath,{...owner,body:authorityReview,headers:{'x-test-before-batch':`UPDATE sessions SET revoked_at=1 WHERE token_hash='${sha(w.tokens.owner)}'`}})
  assert.equal(refused.status,409,'the durable claim rechecks the live session')
  assert.equal((await app.first('SELECT count(*) n FROM customer_identity_links WHERE project_id=?',p)).n,0)
  await app.db.prepare('UPDATE sessions SET revoked_at=NULL WHERE token_hash=?').bind(sha(w.tokens.owner)).run()
  const proofReview=(await app.ok(linkPath+'/preview',{...owner,body:intent})).preview
  assert.equal((await app.call(linkPath,{...owner,body:proofReview,headers:{'x-test-before-batch':`UPDATE contacts SET is_verified=0 WHERE id='${social.contactId}'`}})).status,409,'verification loss at commit cannot install an association')
  await app.db.prepare('UPDATE contacts SET is_verified=1 WHERE id=?').bind(social.contactId).run()
  await apply(intent)
  await app.configure({})
  const linked=await app.ok(linkPath,owner),reverse=await app.ok(`${B}/contacts/${social.contactId}/identity-links`,owner)
  assert.equal(linked.links[0].contact.id,social.contactId);assert.equal(reverse.links[0].contact.id,alice.contactId)
  assert.equal(linked.links[0].provenance,intent.provenance)
  const ticket=await app.ok('/api/conversations',{token:alice.token,body:{projectId:p}})
  assert.equal((await app.call(`/api/conversations/${ticket.id}/messages`,{token:social.token})).status,404,'linked identity gains no other customer history')
  await apply({...intent,action:'unlink'})
  assert.equal((await app.ok(linkPath,owner)).links.length,0)
  await apply(intent)
  assert.equal((await app.sql("SELECT action FROM audit_events WHERE project_id=? AND action IN ('customer.identity_linked','customer.identity_unlinked')",p)).length,3)
  assert.equal(app.requests.length,0,'identity review sends nothing')
  await app.ok(`${B}/contacts/${social.contactId}/erase`,{...owner,body:{}})
  assert.equal((await app.ok(linkPath,owner)).links.length,0,'erasure removes associations from both sides')
  // Erasure clears active membership and every undo snapshot that could restore it.
  await app.ok(`${B}/contacts/${contacts[0].id}/erase`,{...owner,body:{}})
  assert.equal(await app.first('SELECT * FROM contact_companies WHERE project_id=? AND contact_id=?',p,contacts[0].id),null)
  assert.equal((await app.sql('SELECT before_json,after_json,provenance_json FROM company_history WHERE project_id=?',p)).some(row=>JSON.stringify(row).includes(contacts[0].id)),false)
  assert.ok((await app.sql("SELECT action FROM audit_events WHERE project_id=? AND action LIKE 'company.%'",p)).length>0)
 }finally{await app.close()}
}
