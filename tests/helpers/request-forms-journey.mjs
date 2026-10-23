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
  assert.equal((await app.call(path,{body:{...valid,turnstileToken:'wrong-site'},status:422})).data.code,'challenge_failed')
  const publicForm=(await app.ok(`${api}/${form.id}?locale=es`)).data;assert.equal(publicForm.title,'Problema con un pedido');assert.equal(publicForm.fields.find(v=>v.id===order.id).label,'Número de pedido');assert.ok(!JSON.stringify(publicForm).includes(internal.id))
  const forbidden=await app.call(admin,{...owner,body:{...f.config,fields:[{fieldId:internal.id}]},status:400});assert.match(forbidden.data.error,/internal/)
  assert.equal((await app.call(admin,{token:f.workspace.tokens.operator,body:f.config})).status,403)
  assert.equal((await app.call(`${api}/${form.id}`,{headers:{Cookie:'h2h_portal=not-a-proof'}})).status,200)
  const customer=await signin('rosa@example.com',`/help/${p}/requests/${form.id}`)
  assert.equal(customer.location,`/help/${p}/requests/${form.id}`);assert.equal((await app.call(customer.path)).status,400)
  const article=(await app.call(`/api/knowledge/${p}/articles`,{...owner,body:{title:'Refund help',slug:'refund-help',content:'Contact support after checking the duplicate charge.',status:'published'},status:201})).data
  const view=(await app.call(`/api/knowledge/public/${p}/events`,{body:{kind:'view',slug:'refund-help',locale:'es'},status:200})).data.eventId
  assert.ok(view)
  const created=await app.call(path,{...customer,body:{...valid,locale:'es',afterReading:view},status:201}),id=created.data.ticket.id;assert.equal(created.data.ticket.status,'open')
  const analytics=async()=>(await app.call(`/api/knowledge/${p}/analytics`,{...owner,status:200})).data
  assert.equal((await analytics()).totals.tickets,1,'only an admitted request counts after reading')
  assert.equal((await analytics()).articles.find(row=>row.articleId===article.id).tickets,1)
  await app.call(path,{...customer,body:{...valid,locale:'es',afterReading:view},status:200})
  assert.equal((await analytics()).totals.tickets,1,'a replay never counts twice')
  const newRequest=async(localId,afterReading,headers={})=>app.call(path,{...customer,headers:{...customer.headers,...headers},body:{...valid,localId,afterReading},status:201})
  await newRequest('synthetic-happytohelp-1',crypto.randomUUID())
  const foreignView=(await app.call(`/api/knowledge/public/${p}/events`,{headers:{'User-Agent':'another-reader'},body:{kind:'view',slug:'refund-help'},status:200})).data.eventId
  await newRequest('synthetic-happytohelp-2',foreignView)
  const staleView=(await app.call(`/api/knowledge/public/${p}/events`,{body:{kind:'view',slug:'refund-help'},status:200})).data.eventId
  await app.db.prepare('UPDATE knowledge_events SET created_at=? WHERE id=?').bind(Date.now()-1800001,staleView).run()
  await newRequest('synthetic-happytohelp-3',staleView)
  const restricted=(await app.call(`/api/knowledge/${p}/categories`,{...owner,body:{title:'Private',audience:'domains',allowedDomains:['private.test']},status:201})).data.id
  await app.call(`/api/knowledge/${p}/articles`,{...owner,body:{...article,title:'Refund help',slug:'refund-help',content:'Restricted now',status:'published',categoryIds:[restricted]},status:201})
  await newRequest('synthetic-happytohelp-4',view)
  assert.equal((await analytics()).totals.tickets,1,'forged, other-reader, expired and now-restricted receipts count nothing')
  const values=await app.sql('SELECT field_id,value_json FROM ticket_field_values WHERE conversation_id=?',id);assert.deepEqual(Object.fromEntries(values.map(v=>[v.field_id,JSON.parse(v.value_json)])),valid.fields)
  assert.equal((await app.call(path,{...customer,body:valid,status:200})).data.ticket.id,id)
  assert.equal((await app.call(path,{...customer,body:{...valid,message:'Changed command'},status:409})).status,409)
  assert.equal((await app.first('SELECT count(*) n FROM conversations WHERE project_id=?',p)).n,before.n+5)
  assert.ok(await app.first("SELECT id FROM audit_events WHERE project_id=? AND action='form.submitted'",p))
  const stale=await app.call(`${admin}/${form.id}`,{...owner,method:'PUT',body:{...form,title:'Order help'}});assert.equal(stale.status,200)
  assert.equal((await app.call(`${admin}/${form.id}`,{...owner,method:'PUT',body:form})).status,409)
  await app.configure({FORMS_TURNSTILE_SECRET_KEY:undefined})
  assert.equal((await app.call(path,{body:{...valid,localId:'not-configured'},status:503})).data.code,'verification_unavailable')
  // A verified mailbox can still use the portal when anonymous submissions are disabled.
  assert.equal((await app.call(path,{...customer,body:{...valid,localId:'verified-second'},status:201})).data.ticket.status,'open')
  // Abusive anonymous sends and sign-in mail are limited at their public doors.
  await app.configure({RATE_LIMITS:JSON.stringify({conversationsPerIpHour:1})})
  await app.call(path,{body:{...valid,localId:'limited-request'},status:429})
  let limited
  for(let attempt=0;attempt<16;attempt++){
   limited=await app.call(`/api/portal/${p}/access/request`,{headers:{Origin:'https://app.example'},body:{email:'limited@example.com'}})
   if(limited.status===429)break
   assert.equal(limited.status,202)
  }
  assert.equal(limited.status,429,'email-link requests are rate limited')
 }finally{await app.close()}
}
