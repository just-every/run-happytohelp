import assert from 'node:assert/strict'
import {selfServiceFixture} from './self-service-fixture.mjs'
import {applyMigrations} from '../journeys/kit/app.mjs'

// The lookup extends the existing request-form acceptance journey, without another leaf.
export async function accountLookupJourney(f,customer){
 await accountLookupUpgrade()
 customer={...customer,headers:{...customer.headers,'CF-Connecting-IP':'198.51.100.87'}}
 const {app,p,owner,api,admin,signin}=f,base=`/api/management/projects/${p}`
 await app.configure({RATE_LIMITS:JSON.stringify({conversationsPerContactHour:100})})
 const field=(await app.ok(base+'/ticket-fields',{...owner,body:{name:'Support account',type:'account'}})).data
 let form=(await app.ok(admin,{...owner,body:{title:'Account help',enabled:true,fields:[{fieldId:field.id,required:true}]}})).data
 const company=(await app.ok(base+'/companies',{...owner,body:{name:'Northstar account',domains:['example.com']}})).company
 const contact=(await app.first('SELECT contact_id FROM portal_identities WHERE project_id=? AND email=?',p,'rosa@example.com')).contact_id
 const member=base+`/companies/${company.id}/members/${contact}`,companyPath=base+`/companies/${company.id}`,path=`${api}/${form.id}/submissions`,read=`${api}/${form.id}`
 const command={subject:'Account support',message:'Help with my account.',localId:'synthetic-hh-account-1',fields:{[field.id]:company.id}}
 const refused=async(value=company.id,localId='synthetic-hh-refused')=>{const result=await app.call(path,{...customer,body:{...command,localId,fields:{[field.id]:value}},status:422});assert.equal(result.data.field,field.id);assert.equal(result.data.code,'invalid_account')}
 assert.deepEqual((await app.ok(read,customer)).data.fields.find(row=>row.id===field.id).options,[],'a matching domain grants no membership')
 await refused()
 await app.ok(member,{...owner,method:'PUT',body:{}})
 const expected=[{value:company.id,label:'Northstar account'}]
 assert.deepEqual((await app.ok(read,customer)).data.fields.find(row=>row.id===field.id).options,expected)
 assert.equal((await app.first('SELECT portal_company_view enabled FROM companies WHERE id=?',company.id)).enabled,0)
 const save=async changes=>{form=(await app.ok(admin+'/'+form.id,{...owner,method:'PATCH',body:{...changes,updatedAt:form.updatedAt}})).data}
 await app.ok(companyPath,{...owner,method:'PATCH',body:{portalCompanyView:true}})
 await save({fields:[]})
 assert.ok(!(await app.ok(read,customer)).data.fields.some(row=>row.id===field.id),'portal visibility does not publish an account field')
 const unpublished=await app.call(path,{...customer,body:command,status:422});assert.equal(unpublished.data.field,field.id);assert.equal(unpublished.data.code,'unavailable_field')
 await save({fields:[{fieldId:field.id,required:true}]})
 await save({enabled:false})
 assert.equal((await app.call(read,customer)).status,404)
 assert.equal((await app.call(path,{...customer,body:command,status:422})).data.field,field.id)
 await save({enabled:true})
 await app.ok(companyPath,{...owner,method:'PATCH',body:{portalCompanyView:false}})

 assert.deepEqual((await app.ok(read)).data.fields.find(row=>row.id===field.id).options,[],'anonymous definitions expose no account names')
 assert.deepEqual((await app.ok(api,customer)).data.find(row=>row.id===form.id).fields.find(row=>row.id===field.id).options,expected,'the list door applies the same scope')
 // Revoke between loading the public definition and selecting offered choices.
 for(const sql of [
  `DELETE FROM contact_companies WHERE project_id='${p}' AND contact_id='${contact}'`,
  `UPDATE request_forms SET enabled=0 WHERE project_id='${p}' AND id='${form.id}'`,
  `UPDATE ticket_fields SET write_roles_json='["owner"]' WHERE project_id='${p}' AND id='${field.id}'`
 ]){
  const offered=await app.ok(read,{...customer,headers:{...customer.headers,'x-test-statement':'SELECT candidate.id','x-test-before-statement':sql}})
  assert.deepEqual(offered.data.fields.find(row=>row.id===field.id).options,[],'offer rechecks current membership, publication and field permissions')
  await app.ok(member,{...owner,method:'PUT',body:{}})
  await app.db.prepare('UPDATE ticket_fields SET write_roles_json=? WHERE project_id=? AND id=?').bind('[]',p,field.id).run()
  await save({enabled:true})
 }

 const outsider=await signin('outsider@example.com')
 assert.deepEqual((await app.ok(read,outsider)).data.fields.find(row=>row.id===field.id).options,[])
 const foreign=(await app.ok(`/api/management/projects/${f.foreign.projectId}/companies`,{token:f.foreign.tokens.owner,body:{name:'Foreign account',portalCompanyView:true}})).company
 for(const value of ['synthetic-hh-forged',foreign.id])await refused(value)
 const before=(await app.first('SELECT count(*) n FROM conversations WHERE project_id=?',p)).n
 await app.call(path,{...outsider,body:command,status:422})
 assert.equal((await app.first('SELECT count(*) n FROM conversations WHERE project_id=?',p)).n,before)
 // Revocation at the write boundary cannot admit a ticket after the preflight.
 await app.call(path,{...customer,body:{...command,localId:'synthetic-hh-race'},headers:{...customer.headers,'x-test-statement':'INSERT OR IGNORE INTO conversations','x-test-before-statement':`DELETE FROM contact_companies WHERE project_id='${p}' AND contact_id='${contact}'`},status:422})
 assert.equal((await app.first('SELECT count(*) n FROM conversations WHERE project_id=?',p)).n,before)
 await app.ok(member,{...owner,method:'PUT',body:{}})

 // Publication and field permissions are rechecked inside the admission transaction.
 const race=async(sql,localId,code)=>{
  const result=await app.call(path,{...customer,body:{...command,localId},headers:{...customer.headers,'x-test-statement':'INSERT OR IGNORE INTO conversations','x-test-before-statement':sql},status:422})
  assert.equal(result.data.field,field.id);assert.equal(result.data.code,code)
  assert.equal((await app.first('SELECT count(*) n FROM conversations WHERE project_id=?',p)).n,before)
 }
 await race(`UPDATE request_forms SET enabled=0 WHERE project_id='${p}' AND id='${form.id}'`,'synthetic-hh-publication-race','unavailable_field')
 await save({enabled:true})
 await race(`UPDATE ticket_fields SET read_roles_json='["owner"]' WHERE project_id='${p}' AND id='${field.id}'`,'synthetic-hh-permission-race','unavailable_field')
 await app.db.prepare('UPDATE ticket_fields SET read_roles_json=? WHERE project_id=? AND id=?').bind('[]',p,field.id).run()
 const merged=(await app.ok(base+'/companies',{...owner,body:{name:'Merged account'}})).company
 await app.ok(base+`/companies/${merged.id}/members/${contact}`,{...owner,method:'PUT',body:{}})
 const preview=(await app.ok(companyPath+'/merge/preview',{...owner,body:{sourceId:merged.id}})).preview
 await app.ok(companyPath+'/merge',{...owner,body:{sourceId:merged.id,preview:preview.token}})
 await refused(merged.id,'synthetic-hh-merged')
 assert.deepEqual((await app.ok(read,customer)).data.fields.find(row=>row.id===field.id).options,expected,'merged accounts are never offered')
 const created=await app.call(path,{...customer,body:command,status:201}),id=created.data.ticket.id,ticketPath=`/api/dashboard/projects/${p}/conversations/${id}/ticket`
 assert.equal((await app.ok(ticketPath,owner)).data.fields[field.id],company.id)
 await app.call(ticketPath,{...owner,method:'PATCH',body:{fields:{[field.id]:foreign.id}},status:422})
 await app.ok(ticketPath,{...owner,method:'PATCH',body:{fields:{[field.id]:company.id}}})
 await app.ok(member,{...owner,method:'DELETE'})
 await refused(company.id,'synthetic-hh-revoked')
 assert.equal((await app.call(path,{...customer,body:command,status:200})).data.ticket.id,id,'historical admitted commands remain replayable')
 await app.ok(ticketPath,{...owner,method:'PATCH',body:{subject:'Historical account support',fields:{[field.id]:company.id}}})
 await app.configure({})
 assert.equal((await app.ok(ticketPath,owner)).data.fields[field.id],company.id,'revocation and restart retain the historical identifier')
 const fieldPath=base+`/ticket-fields/${field.id}`
 await app.ok(fieldPath,{...owner,method:'PATCH',body:{name:'Historical support account',read_roles:['owner'],write_roles:['owner']}})
 assert.equal((await app.call(read,customer)).status,404)
 const restricted=await app.call(path,{...customer,body:{...command,localId:'synthetic-hh-restricted'},status:422});assert.equal(restricted.data.field,field.id);assert.equal(restricted.data.code,'unavailable_field')
 assert.ok(!Object.hasOwn((await app.ok(ticketPath,{token:f.workspace.tokens.operator})).data.fields,field.id))
 assert.equal((await app.call(ticketPath,{token:f.workspace.tokens.operator,method:'PATCH',body:{fields:{[field.id]:company.id}}})).status,403)
 assert.equal((await app.call(fieldPath,{...owner,method:'DELETE'})).status,400)
 const versions=(await app.ok(fieldPath+'/versions',owner)).data
 assert.equal(versions.length,2);assert.equal(versions[1].definition.type,'account')
}

async function accountLookupUpgrade(){
 const f=await selfServiceFixture({migrate:name=>name<'257_account_lookup_fields.sql'}),{app,p,owner,signin,api,form,valid}=f
 try{
  const customer=await signin('synthetic-hh-upgrade@example.com'),ticket=(await app.call(`${api}/${form.id}/submissions`,{...customer,body:valid,status:201})).data.ticket
  const snapshot=async()=>({fields:await app.sql('SELECT * FROM ticket_fields ORDER BY project_id,id'),values:await app.sql('SELECT * FROM ticket_field_values ORDER BY project_id,conversation_id,field_id'),events:await app.sql('SELECT * FROM workflow_events ORDER BY id')})
  const before=await snapshot()
  await applyMigrations(app.db,name=>name==='257_account_lookup_fields.sql')
  assert.deepEqual(await snapshot(),before,'extending the field type retains definitions, typed values and the workflow journal byte for byte')
  await app.ok(`/api/dashboard/projects/${p}/conversations/${ticket.id}/ticket`,{...owner,method:'PATCH',body:{fields:{[f.order.id]:'NS-10483'}}})
  assert.equal((await app.first('SELECT value_json FROM ticket_field_values WHERE conversation_id=? AND field_id=?',ticket.id,f.order.id)).value_json,'"NS-10483"')
  assert.ok((await app.sql('SELECT after_json FROM workflow_events WHERE conversation_id=?',ticket.id)).some(row=>JSON.parse(row.after_json).fields?.[f.order.id]==='NS-10483'),'editing a retained field still journals its new typed value')
 }finally{await app.close()}
}
