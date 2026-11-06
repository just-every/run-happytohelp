import assert from 'node:assert/strict'
import {mailApp,recipients} from '../email/app.mjs'
import {teammateOutcomes} from './teammates.mjs'
import {selfServiceFixture} from '../self-service-fixture.mjs'

// Only the mail/DNS network edge is faked. Settings, admission, messages,
// merges, membership and notification reads all enter the application's routes.
export async function notificationOutcomesJourney(){
 const m=await mailApp(),{app,mail}=m,brands=[]
 try{
  for(const label of ['alpha','beta']){
   const w=await app.seedWorkspace('notify-'+label,{name:'Notify '+label}),owner={token:w.tokens.owner}
   const base=`/api/management/projects/${w.projectId}`,desk=`/api/dashboard/projects/${w.projectId}`
   const req=(path,body,method)=>app.ok(path,{...owner,...(body===undefined?{}:{body}),...(method?{method}:{})})
   await req(base+'/email-settings',{from_name:w.name,from_address:`support@${label}.example.test`,inbound_address:`help@${label}.example.test`,is_enabled:true},'PUT')
   const defaults=(await req(base+'/notification-triggers')).data
   const overrides=['email','widget'].map(channel=>({...defaults.find(t=>t.event==='request_received'),channel,brand_id:w.projectId,subject:`${label} ${channel} #{{ticket.id}} received`,body:'Hello {{requester.first_name | there}}: {{ticket.subject}}\n{{ticket.link}}\n{{brand.name}}: {{expected_reply_time}}',expected_reply_time:`within ${channel==='email'?'two':'three'} ${label} hours`}))
   await req(base+'/notification-triggers',{triggers:overrides},'PUT')
   assert.deepEqual((await req(base+'/notification-triggers')).data.filter(t=>t.brand_id===w.projectId).map(t=>t.expected_reply_time).sort(),overrides.map(t=>t.expected_reply_time).sort(),'channel and brand trigger edits persist')
   const receive=async(messageId,extra={})=>{
    const response=await m.gateway({messageId,to:`help@${label}.example.test`,from:`buyer-${label}@example.test`,subject:label+' order',text:'Please help with my order.',...extra})
    assert.equal(response.status,201,await response.clone().text());return (await response.json()).conversationId
   }
   const emailId=await receive('notify-'+label)
   const visitor=await app.ok('/api/identity/widget/session',{headers:{Origin:w.allowedOrigin},body:{widgetKey:w.widgetKey,email:`widget-${label}@example.test`}})
   const widget=await app.ok('/api/conversations',{token:visitor.token,body:{projectId:w.projectId}})
   await app.scheduled()
   assert.equal(mail.sent.filter(e=>e.body.subject?.includes(widget.id)).length,0,'empty widget admission is not a request')
   const command={localId:'notify-widget-'+label,content:'Please help with this widget order.',expectedRevision:0}
   await app.ok(`/api/conversations/${widget.id}/messages`,{token:visitor.token,body:command})
   await app.ok(`/api/conversations/${widget.id}/messages`,{token:visitor.token,body:command})
   await app.scheduled()
   for(const [channel,id,address] of [['email',emailId,`buyer-${label}@example.test`],['widget',widget.id,`widget-${label}@example.test`]]){
    const copies=mail.sent.filter(e=>e.body.subject===`${label} ${channel} #${id} received`)
    assert.equal(copies.length,1,`${channel}/${label} receives one acknowledgment after replay`)
    assert.deepEqual(recipients(copies[0].body),[address])
    assert.ok(copies[0].body.text.includes(id));assert.ok(copies[0].body.text.includes(w.name))
    assert.ok(copies[0].body.text.includes(overrides.find(t=>t.channel===channel).expected_reply_time))
    assert.match(copies[0].body.text,/Hello there:/,'MACRO-001 fallback renders for an unnamed requester')
    assert.doesNotMatch(copies[0].body.text,/\{\{/)
    const outcome=(await req(base+'/notification-triggers')).outcomes.find(o=>o.conversation_id===id&&o.event==='request_received')
    assert.equal(outcome.state,'complete');assert.equal(outcome.outcome.deliveries.length,1,'the settings door exposes the delivery outcome')
   }
   brands.push({w,base,desk,req,receive,emailId,visitor,widget,overrides})
  }
  const b=brands[0],{req,base,emailId,receive,overrides}=b
  // Missing template values are a visible terminal failure, with no literal or mail.
  await req(base+'/notification-triggers',{triggers:[{...overrides[0],body:'Reference {{ticket.custom.absent}}'}]},'PUT')
  const beforeTemplate=mail.attempts,missing=await receive('notify-missing',{from:'missing@example.test'})
  await app.scheduled()
  const failure=(await req(base+'/notification-triggers')).outcomes.find(o=>o.conversation_id===missing)
  assert.equal(failure.state,'template_error');assert.match(failure.outcome.error,/ticket.custom.absent/)
  assert.equal(mail.attempts,beforeTemplate,'a missing placeholder sends nothing')
  await req(base+'/notification-triggers',{triggers:[overrides[0]]},'PUT')
  // An accepted send whose response is lost remains uncertain across restart/redelivery.
  mail.respond=entry=>{if(recipients(entry.body).includes('uncertain@example.test'))throw new Error('provider accepted; response lost')}
  const uncertain=await receive('notify-uncertain',{from:'uncertain@example.test'})
  await app.scheduled()
  const outcome=async()=>(await req(base+'/notification-triggers')).outcomes.find(o=>o.conversation_id===uncertain)
  assert.equal((await outcome()).state,'uncertain')
  const attempted=mail.sent.filter(e=>recipients(e.body).includes('uncertain@example.test')).length
  assert.equal(attempted,1)
  mail.respond=null;await app.configure({});await app.scheduled()
  assert.equal((await m.gateway({messageId:'notify-uncertain',to:'help@alpha.example.test',from:'uncertain@example.test',subject:'alpha order',text:'Please help with my order.'})).status,200)
  await app.scheduled();assert.equal((await outcome()).state,'uncertain')
  assert.equal(mail.sent.filter(e=>recipients(e.body).includes('uncertain@example.test')).length,attempted,'an uncertain acknowledgment is never sent again')
  // A merge itself cannot create another acknowledgment or teammate delivery.
  const source=await receive('notify-merge',{from:'duplicate@example.test'});await app.scheduled()
  const ticket=id=>req(`${b.desk}/conversations/${id}/ticket`),beforeMerge=mail.attempts
  await req(`${b.desk}/conversations/${emailId}/merge`,{source_id:source,source_version:(await ticket(source)).data.ticket_version,target_version:(await ticket(emailId)).data.ticket_version})
  await app.scheduled()
  assert.equal(mail.attempts,beforeMerge,'merging acknowledged tickets emits no notification')
  assert.ok((await req(`${b.desk}/conversations/${emailId}/merged-history`)).data.some(t=>t.conversation_id===source))
  for(const [key,headers] of [['auto',{'Auto-Submitted':'auto-replied'}],['machine',{'Auto-Submitted':'auto-generated'}],['suspended',{'X-Spam-Score':'8'}]]){
   const before=mail.attempts,address=`notify-${key}@example.test`
   await m.gateway({messageId:'notify-'+key,to:'help@alpha.example.test',from:address,text:'Automatic or suspended content',headers})
   await app.scheduled()
   assert.equal(mail.attempts,before,`${key} mail triggers no delivery`)
   assert.equal(mail.sent.filter(e=>recipients(e.body).includes(address)).length,0)
   if(key==='suspended')assert.ok((await req(base+'/suspended')).data.some(row=>row.from_address===address),'MAIL-002 public suspended list confirms admission was held')
  }
  await teammateOutcomes(m,brands)
  const beta=brands[1],frontier=(await beta.req(`${beta.desk}/conversations/${beta.emailId}/ticket`)).data
  await beta.req(`/api/conversations/${beta.emailId}/messages`,{localId:'notify-public-headers',content:'Public reply header proof.',expectedRevision:frontier.revision,expectedLastMessageId:frontier.last_message_id})
  await beta.req(`${beta.desk}/conversations/${beta.emailId}`,{resolved:true},'PUT');await app.scheduled()
  assert.ok(mail.sent.some(e=>e.body.text?.includes('Public reply header proof.')))
  assert.ok(mail.sent.some(e=>e.body.subject?.includes(beta.emailId)&&e.body.subject.includes('solved')))
  for(const {body,headers} of mail.sent){
   assert.equal(body.headers['Auto-Submitted'],'auto-generated')
   assert.equal(body.headers['X-Auto-Response-Suppress'],'All','every captured ticket notice suppresses loops')
   const receipt=await app.first('SELECT recipient,state FROM email_deliveries WHERE id=?',headers['idempotency-key'])
   assert.ok(receipt,'every provider attempt has its exact durable delivery claim')
   assert.deepEqual(recipients(body),[receipt.recipient]);assert.ok(['sent','uncertain'].includes(receipt.state))
  }
 }finally{await m.close()}
 await formNotificationTemplate()
}

// CC admission/replay is already asserted by request-forms-journey.mjs; this
// checks the remaining form-specific template scope through its existing door.
async function formNotificationTemplate(){
 const f=await selfServiceFixture(),{app,p,owner,api,form,valid,signin,mail}=f,settings=`/api/management/projects/${p}/notification-triggers`
 try{
  const trigger=(await app.ok(settings,owner)).data.find(t=>t.event==='request_received')
  await app.ok(settings,{...owner,method:'PUT',body:{triggers:[{...trigger,channel:'form',brand_id:p,expected_reply_time:'within six business hours'}]}})
  const customer=await signin('notify-form@example.test'),submitted=await app.ok(`${api}/${form.id}/submissions`,{...customer,body:valid})
  const copies=mail.filter(body=>body.subject?.includes(submitted.ticket.id)&&body.subject.includes('received'))
  assert.equal(copies.length,1);assert.deepEqual(recipients(copies[0]),['notify-form@example.test'])
  assert.ok(copies[0].text.includes(submitted.ticket.id));assert.match(copies[0].text,/within six business hours/)
  assert.ok(copies[0].text.includes(f.workspace.name),'the form acknowledgment carries its current brand')
 }finally{await app.close()}
}
