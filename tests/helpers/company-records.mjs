import assert from 'node:assert/strict'
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
  // Erasure clears active membership and every undo snapshot that could restore it.
  await app.ok(`${B}/contacts/${contacts[0].id}/erase`,{...owner,body:{}})
  assert.equal(await app.first('SELECT * FROM contact_companies WHERE project_id=? AND contact_id=?',p,contacts[0].id),null)
  assert.equal((await app.sql('SELECT before_json,after_json,provenance_json FROM company_history WHERE project_id=?',p)).some(row=>JSON.stringify(row).includes(contacts[0].id)),false)
  assert.ok((await app.sql("SELECT action FROM audit_events WHERE project_id=? AND action LIKE 'company.%'",p)).length>0)
 }finally{await app.close()}
}
