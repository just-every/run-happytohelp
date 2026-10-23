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
  // Configure both consumers through the same settings doors leads use. The
  // selected form and typed answer must survive admission into routing and SLA.
  const dashboard=`/api/dashboard/projects/${p}`,manage=async(path,body)=>{const result=await app.ok(dashboard+path,{...owner,body});return result.data??result}
  const calendar=await manage('/workflow-calendars',{name:'Always available',timezone:'America/New_York',weekly:Array.from({length:7},(_,day)=>({day,start:'00:00',end:'24:00'})),holidays:'none',closures:[]})
  const policyInput={name:'Refund form response',calendar_id:calendar.id,conditions:{form_ids:[form.id],fields:{[reason.id]:'refund'}},first_response_minutes:60}
  const policy=await manage('/sla-policies',policyInput)
  for(const conditions of [{fields:{[reason.id]:42}},{fields:{[internal.id]:7}},{fields:{unknown:'refund'}},{form_ids:[f.foreign.projectId]}]){
   assert.equal((await app.call(dashboard+'/sla-policies',{...owner,body:{...policyInput,conditions}})).status,400,'invalid, restricted and foreign references cannot select a policy')
  }
  await app.ok(dashboard+'/routing-operators',{...owner,method:'PUT',body:{operators:[{user_id:f.workspace.users.operator,available:true,capacity:10,skills:[]}]}})
  const routing=await manage('/workflow-rules',{name:'Route refund form',kind:'routing',position:0,conditions:{all:[{field:'form_id',op:'eq',value:form.id},{field:`field:${reason.id}`,op:'eq',value:'refund'}]},actions:[],routing:{strategy:'named',user_id:f.workspace.users.operator,skills:[]}})
  await manage(`/workflow-rules/${routing.rule.id}/publish`,{})
  const customer=await signin('rosa@example.com',`/help/${p}/requests/${form.id}`)
  assert.equal(customer.location,`/help/${p}/requests/${form.id}`);assert.equal((await app.call(customer.path)).status,400)
  const created=await app.call(path,{...customer,body:{...valid,locale:'es'},status:201}),id=created.data.ticket.id;assert.equal(created.data.ticket.status,'open')
  const values=await app.sql('SELECT field_id,value_json FROM ticket_field_values WHERE conversation_id=?',id);assert.deepEqual(Object.fromEntries(values.map(v=>[v.field_id,JSON.parse(v.value_json)])),valid.fields)
  assert.equal((await app.call(path,{...customer,body:valid,status:200})).data.ticket.id,id)
  assert.equal((await app.call(path,{...customer,body:{...valid,message:'Changed command'},status:409})).status,409)
  assert.equal((await app.first('SELECT count(*) n FROM conversations WHERE project_id=?',p)).n,before.n+1)
  const ticket=(await app.ok(`${dashboard}/conversations/${id}/ticket`,owner)).data
  assert.equal(ticket.assigned_to,f.workspace.users.operator,'the selected form and typed field route the ticket')
  const sla=(await app.ok(`${dashboard}/conversations/${id}/sla`,owner)).data
  assert.equal(sla.policy.id,policy.id,'the selected form and typed field select its SLA')
  const response=sla.clocks.find(clock=>clock.metric==='first_response')
  assert.equal(response.due_at,response.started_at+60*60000,'the form request has a one-hour response commitment')
  const question=await app.ok(path,{...customer,body:{...valid,localId:'question-not-refund',fields:{[reason.id]:'question'}}}),questionId=question.ticket.id
  assert.equal((await app.ok(`${dashboard}/conversations/${questionId}/ticket`,owner)).data.assigned_to,null,'a nonmatching answer does not route')
  assert.equal((await app.ok(`${dashboard}/conversations/${questionId}/sla`,owner)).data.policy,null,'a nonmatching answer does not select the refund SLA')
  const technical=(await app.ok(admin,{...owner,body:{...f.config,title:'Technical',translations:{},fields:[{fieldId:reason.id,required:true}]}})).data
  const technicalTicket=await app.ok(`${api}/${technical.id}/submissions`,{...customer,body:{...valid,localId:'technical-refund',fields:{[reason.id]:'refund'}}})
  assert.equal((await app.ok(`${dashboard}/conversations/${technicalTicket.ticket.id}/sla`,owner)).data.policy,null,'a matching answer on another form does not select the refund SLA')
  assert.equal((await app.ok(`${dashboard}/conversations/${technicalTicket.ticket.id}/ticket`,owner)).data.assigned_to,null,'another form does not use the refund route')
  await app.configure({})
  assert.equal((await app.ok(`${dashboard}/conversations/${id}/sla`,owner)).data.policy.id,policy.id,'form-based commitments survive worker restart')
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
