import assert from 'node:assert/strict'
import {startApp,sha} from '../journeys/kit/app.mjs'

export async function customerCsvJourney(){
 const app=await startApp({captureQueue:true}),w=await app.seedWorkspace('csv'),p=w.projectId,owner={token:w.tokens.owner},B=`/api/management/projects/${p}`,I=B+'/customer-imports'
 try{
  const company=(await app.ok(B+'/companies',{...owner,body:{name:'Northstar Supply',domains:['northstar.example']}})).company
  const original=(await app.ok(B+'/contacts',{...owner,body:{name:'Old name',email:'known@northstar.example'}})).data
  const rows=Array.from({length:500},(_,i)=>`${i===0?'Updated name':`Customer ${i}`},${i===0?'known@northstar.example':i===1?'not-an-email':i===2?'known@northstar.example':`customer${i}@northstar.example`}`)
  const input={kind:'contacts',csv:'Full name,Work email\n'+rows.join('\n'),mapping:{name:'Full name',email:'Work email'},matchDomains:true}
  const before={mail:app.requests.length,jobs:(await app.takeJobs()).length,workflows:(await app.first('SELECT count(*) n FROM workflow_events')).n,sla:(await app.first('SELECT count(*) n FROM ticket_sla_state')).n}
  assert.equal((await app.call(I+'/preview',{token:w.tokens.operator,body:input})).status,403)
  const run=await app.ok(I+'/preview',{...owner,body:input})
  assert.equal(run.rows.length,500)
  assert.deepEqual(run.counts,{create:497,update:1,skip:2})
  assert.equal(run.rows[1].action,'skip');assert.match(run.rows[1].reason,/email/i)
  assert.equal(run.rows[2].action,'skip');assert.match(run.rows[2].reason,/duplicate|already/i)
  assert.equal(run.rows[0].domainMatch.companyId,company.id)
  assert.equal((await app.first('SELECT name FROM contacts WHERE id=?',original.id)).name,'Old name','preview changes nothing')
  await app.db.prepare('UPDATE session_factors SET verified_at=1 WHERE token_hash=?').bind(sha(w.tokens.owner)).run()
  assert.equal((await app.call(`${I}/${run.id}/apply`,{...owner,body:{}})).data.code,'step_up_required')
  await app.db.prepare('UPDATE session_factors SET verified_at=? WHERE token_hash=?').bind(Date.now(),sha(w.tokens.owner)).run()
  const applied=await app.ok(`${I}/${run.id}/apply`,{...owner,body:{}})
  assert.equal(applied.status,'applied')
  assert.equal((await app.first('SELECT count(*) n FROM contact_companies WHERE project_id=? AND company_id=?',p,company.id)).n,498)
  assert.equal((await app.first('SELECT name FROM contacts WHERE id=?',original.id)).name,'Updated name')
  assert.equal(app.requests.length,before.mail);assert.equal((await app.takeJobs()).length,before.jobs)
  assert.equal((await app.first('SELECT count(*) n FROM workflow_events')).n,before.workflows)
  assert.equal((await app.first('SELECT count(*) n FROM ticket_sla_state')).n,before.sla)
  assert.equal((await app.ok(`${I}/${run.id}/undo`,{...owner,body:{}})).status,'undone')
  assert.equal((await app.first('SELECT count(*) n FROM contacts WHERE project_id=?',p)).n,1)
  assert.equal((await app.first('SELECT name FROM contacts WHERE id=?',original.id)).name,'Old name')
  const stale=await app.ok(I+'/preview',{...owner,body:input})
  await app.ok(B+'/contacts/'+original.id,{...owner,method:'PUT',body:{name:'Later edit'}})
  assert.equal((await app.call(`${I}/${stale.id}/apply`,{...owner,body:{}})).status,409)
  const field=(await app.ok(B+'/company-fields',{...owner,body:{name:'Annual spend',type:'number'}})).field
  const companies=await app.ok(I+'/preview',{...owner,body:{kind:'companies',csv:'Account,Domains,Spend\nNorthstar Supply,northstar.example,400\nHarbor Parts,harbor.example,200\nBad company,bad domain,foo',mapping:{name:'Account',domains:'Domains',['attribute:'+field.id]:'Spend'},matchDomains:true}})
  assert.deepEqual(companies.counts,{create:1,update:1,skip:1})
  await app.ok(`${I}/${companies.id}/apply`,{...owner,body:{}})
  assert.equal((await app.ok(`${B}/companies/${company.id}`,owner)).company.attributes[field.id],400)
  await app.ok(`${I}/${companies.id}/undo`,{...owner,body:{}})
  assert.deepEqual((await app.ok(`${B}/companies/${company.id}`,owner)).company.attributes,{})
  const erased=await app.ok(I+'/preview',{...owner,body:input});await app.ok(`${I}/${erased.id}/apply`,{...owner,body:{}})
  const note=(await app.ok(B+'/company-fields',{...owner,body:{name:'Account notes',type:'text'}})).field
  const former=(await app.ok(B+'/company-fields',{...owner,body:{name:'Former contact name',type:'text'}})).field
  const privateCompany=await app.ok(I+'/preview',{...owner,body:{kind:'companies',csv:'Account,Notes,Former name\nNorthstar Supply,Contact '+original.email+',\nNorthstar Supply,,Old name',mapping:{name:'Account',['attribute:'+note.id]:'Notes',['attribute:'+former.id]:'Former name'},matchDomains:false}})
  await app.ok(`${B}/contacts/${original.id}/erase`,{...owner,body:{}})
  const privateRetained=await app.ok(`${I}/${privateCompany.id}`,owner)
  assert.equal(JSON.stringify(privateRetained).includes('Old name'),false,'historical names in company CSV images are erased');assert.equal(privateRetained.status,'erased');assert.equal(JSON.stringify(privateRetained).includes(original.email),false,'company CSV images are erased too')
  const retained=JSON.stringify(await app.ok(`${I}/${erased.id}`,owner))
  assert.equal(retained.includes(original.email),false)
  assert.equal((await app.call(`${I}/${erased.id}/undo`,{...owner,body:{}})).status,409)
  assert.ok((await app.sql("SELECT action FROM audit_events WHERE project_id=? AND action LIKE 'customer_csv.%'",p)).length>=3)
 }finally{await app.close()}
}
