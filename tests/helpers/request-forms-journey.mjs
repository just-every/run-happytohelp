import assert from 'node:assert/strict'
import {selfServiceFixture} from './self-service-fixture.mjs'
export async function requestFormsJourney(){
 const f=await selfServiceFixture(),{app,p,owner,admin,api,reason,order,internal,form,valid,signin}=f,path=`${api}/${form.id}/submissions`
 try{
  const missing=await app.call(path,{body:{...valid,fields:{[reason.id]:'refund'}},status:422});assert.equal(missing.data.field,order.id);assert.match(missing.data.error,/Order number/)
  const pattern=await app.call(path,{body:{...valid,fields:{[reason.id]:'refund',[order.id]:'incorrect'}},status:422});assert.equal(pattern.data.field,order.id)
  assert.equal((await app.call(path,{body:{...valid,fields:{[reason.id]:'question',[order.id]:'NS-101'}},status:422})).data.code,'inactive_field')
  const before=await app.first('SELECT count(*) n FROM conversations WHERE project_id=?',p)
  assert.equal((await app.call(path,{body:valid,status:428})).data.code,'email_verification_required')
  assert.equal((await app.first('SELECT count(*) n FROM conversations WHERE project_id=?',p)).n,before.n)
  assert.equal((await app.call(path,{body:{...valid,turnstileToken:'bad'},status:422})).data.field,'turnstileToken')
  const publicForm=(await app.ok(`${api}/${form.id}?locale=es`)).data;assert.equal(publicForm.title,'Problema con un pedido');assert.equal(publicForm.fields.find(v=>v.id===order.id).label,'Número de pedido');assert.ok(!JSON.stringify(publicForm).includes(internal.id))
  const forbidden=await app.call(admin,{...owner,body:{...f.config,fields:[{fieldId:internal.id}]},status:400});assert.match(forbidden.data.error,/internal/)
  assert.equal((await app.call(admin,{token:f.workspace.tokens.operator,body:f.config})).status,403)
  assert.equal((await app.call(`${api}/${form.id}`,{headers:{Cookie:'h2h_portal=not-a-proof'}})).status,200)
  const customer=await signin('rosa@example.com',`/help/${p}/requests/${form.id}`)
  assert.equal(customer.location,`/help/${p}/requests/${form.id}`);assert.equal((await app.call(customer.path)).status,400)
  const created=await app.call(path,{...customer,body:{...valid,locale:'es'},status:201}),id=created.data.ticket.id;assert.equal(created.data.ticket.status,'open')
  const values=await app.sql('SELECT field_id,value_json FROM ticket_field_values WHERE conversation_id=?',id);assert.deepEqual(Object.fromEntries(values.map(v=>[v.field_id,JSON.parse(v.value_json)])),valid.fields)
  assert.equal((await app.call(path,{...customer,body:valid,status:200})).data.ticket.id,id)
  assert.equal((await app.call(path,{...customer,body:{...valid,message:'Changed command'},status:409})).status,409)
  assert.equal((await app.first('SELECT count(*) n FROM conversations WHERE project_id=?',p)).n,before.n+1)
  assert.ok(await app.first("SELECT id FROM audit_events WHERE project_id=? AND action='form.submitted'",p))
  const stale=await app.call(`${admin}/${form.id}`,{...owner,method:'PUT',body:{...form,title:'Order help'}});assert.equal(stale.status,200)
  assert.equal((await app.call(`${admin}/${form.id}`,{...owner,method:'PUT',body:form})).status,409)
  await app.configure({FORMS_TURNSTILE_SECRET_KEY:undefined})
  assert.equal((await app.call(path,{body:{...valid,localId:'not-configured'},status:503})).data.code,'verification_unavailable')
  // A verified mailbox can still use the portal when anonymous submissions are disabled.
  assert.equal((await app.call(path,{...customer,body:{...valid,localId:'verified-second'},status:201})).data.ticket.status,'open')
 }finally{await app.close()}
}
