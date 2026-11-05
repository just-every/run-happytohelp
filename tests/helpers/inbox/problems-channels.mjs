import assert from 'node:assert/strict'
import {createHash,createHmac,randomUUID} from 'node:crypto'
import {startApp} from '../../journeys/kit/app.mjs'

// Only the provider boundary is replaced. Intake, signed webhook validation,
// message admission, D1, outbox/queues, ticket changes and result reads are native.
export async function problemChannelsJourney(){
 const signing='synthetic-happytohelp-31',credential='synthetic-happytohelp-32',gateway='synthetic-happytohelp-33'
 const mail=[],surveys=[],sends=[],responses=new Map()
 const account='synthetic-happytohelp-account-sms',sender='+12025550123',waAccount='synthetic-happytohelp-account-whatsapp',waSender='synthetic-happytohelp-page'
 const app=await startApp({captureQueue:true,bindings:{APP_ORIGIN:'https://app.example',EMAIL_PROVIDER:'resend',EMAIL_API_KEY:credential,EMAIL_FROM:'support@example.test',INBOUND_EMAIL_TOKEN:gateway,INTEGRATION_ENCRYPTION_KEY:createHash('sha256').update(signing).digest('base64')},outbound:async(request,entry)=>{
  const url=new URL(request.url)
  if(url.hostname==='messaging.twilio.com')return Response.json(url.pathname.endsWith('/PhoneNumbers')?{phone_numbers:[{phone_number:sender,account_sid:account}]}:{usa2p:[{account_sid:account,campaign_status:'VERIFIED'}]})
  if(url.hostname==='api.resend.com'){
   const body=JSON.parse(entry.body)
   ;(entry.headers['idempotency-key']?.startsWith('csat:')?surveys:mail).push({...body,delivery_id:entry.headers['idempotency-key']})
   return Response.json({id:'synthetic-happytohelp-mail-'+(mail.length+surveys.length)})
  }
  assert.ok(['api.twilio.com','graph.facebook.com'].includes(url.hostname),url.hostname)
  const body=url.hostname==='api.twilio.com'?Object.fromEntries(new URLSearchParams(entry.body)):JSON.parse(entry.body),recipient=body.To??body.to
  sends.push({recipient,body,provider:url.hostname==='api.twilio.com'?'sms':'whatsapp'})
  const response=responses.get(recipient)
  if(response)return Response.json(response.body,{status:response.status})
  return url.hostname==='api.twilio.com'?Response.json({sid:'synthetic-happytohelp-send-'+sends.length,status:'queued'}):Response.json({messaging_product:'whatsapp',messages:[{id:'synthetic-happytohelp-send-'+sends.length}]})
 }})
 try{
  const w=await app.seedWorkspace('problem-channel-updates'),p=w.projectId,token=w.tokens.owner,base=`/api/dashboard/projects/${p}`,channels=`/api/support-channels/projects/${p}`
  await app.presenceAwayOff(p)
  const read=async(path,body,method)=>(await app.ok(path,{token,body,method})).data
  const problemPath=id=>`${base}/conversations/${id}/ticket/problem`,call=(id,suffix='',body,method)=>read(problemPath(id)+suffix,body,method),frontier=async id=>(await call(id)).ticket
  const ticket=async id=>read(`${base}/conversations/${id}/ticket`),transcript=async(id,as=token)=>app.ok(`/api/conversations/${id}/messages`,{token:as}),receipt=id=>read(channels+'/conversations/'+id)
  const calendar=await read(base+'/workflow-calendars',{name:'Transport incidents',timezone:'UTC',weekly:[0,1,2,3,4,5,6].map(day=>({day,start:'00:00',end:'24:00'})),holidays:'none',closures:[]})
  const policy=await read(base+'/sla-policies',{name:'Each requester commitment',calendar_id:calendar.id,position:1,conditions:{priorities:[],plans:[],channels:[],brands:[]},first_response_minutes:60,next_response_minutes:120,resolution_minutes:480})
  const sla=id=>read(`${base}/conversations/${id}/sla`),clock=s=>s.clocks.filter(c=>c.metric==='resolution').at(-1)
  await app.ok(`/api/outcomes/projects/${p}/settings`,{token,method:'PUT',body:{enabled:true,scale:'thumbs',delayMinutes:0,expiresDays:14,locale:'en'}})
  await app.ok(`/api/management/projects/${p}/email-settings`,{token,method:'PUT',body:{from_address:'support@example.test',inbound_address:'problem-inbound@example.test',is_enabled:true}})
  const connect=async provider=>read(channels+'/connections',{provider,account:provider==='sms'?account:waAccount,sender:provider==='sms'?sender:waSender,token:credential,signing_secret:signing,registered:true,messaging_service:'synthetic-happytohelp-service'})
  const sms=await connect('sms'),whatsapp=await connect('whatsapp')
  const deliver=async(connection,provider,raw)=>{
   const path='/api/support-channels/webhooks/'+connection.id,url=app.origin+path
   const signature=provider==='sms'?createHmac('sha1',signing).update(url+[...new URLSearchParams(raw).keys()].sort().map(key=>key+new URLSearchParams(raw).get(key)).join('')).digest('base64'):createHmac('sha256',signing).update(raw).digest('hex')
   return app.ok(path,{raw:true,body:raw,headers:provider==='sms'?{'Content-Type':'application/x-www-form-urlencoded','X-Twilio-Signature':signature}:{'Content-Type':'application/json','X-Hub-Signature-256':'sha256='+signature}})
  }
  const inbound=async(provider,recipient,{text='Checkout is broken for me.',at=Date.now()}={})=>{
   const connection=provider==='sms'?sms:whatsapp,id=randomUUID()
   const raw=provider==='sms'?new URLSearchParams({AccountSid:account,To:sender,From:recipient,MessageSid:id,Body:text,NumMedia:'0'}).toString():JSON.stringify({entry:[{id:waAccount,changes:[{value:{metadata:{phone_number_id:waSender},messages:[{timestamp:String(Math.floor(at/1000)),id,from:recipient,type:'text',text:{body:text}}]}}]}]})
   await deliver(connection,provider,raw)
   const t=await app.first('SELECT * FROM support_channel_threads WHERE connection_id=? AND recipient=?',connection.id,recipient)
   assert.ok(t)
   return {id:t.conversation_id,contact_id:t.contact_id,recipient,provider}
  }
  const {verificationSecret}=await app.ok(`/api/management/projects/${p}/widget-settings`,{token})
  let visitorNumber=0
  const widget=async name=>{
   const email=`synthetic-requester-${++visitorNumber}@customer.example.test`
   const session=await app.ok('/api/identity/widget/session',{headers:{Origin:w.allowedOrigin},body:{widgetKey:w.widgetKey,name,email,identifier:email,contact_hash:createHmac('sha256',verificationSecret).update(email).digest('hex')}})
   const c=await app.ok('/api/conversations',{token:session.token,body:{projectId:p}})
   await app.ok(`/api/conversations/${c.id}/messages`,{token:session.token,body:{localId:'checkout',content:'Checkout is broken.',expectedRevision:0}})
   return {id:c.id,email,token:session.token}
  }
  const root=await widget('Problem requester'),chat=await widget('Widget requester')
  const emailIngress=await app.ok('/api/integrations/email/inbound',{token:gateway,body:{from:'email-requester@customer.example.test',to:'problem-inbound@example.test',messageId:'synthetic-happytohelp-problem-mail',name:'Email requester',subject:'Checkout fails',text:'My checkout failed.'}})
  const email={id:emailIngress.conversationId??emailIngress.conversation_id,email:'email-requester@customer.example.test'}
  assert.ok(email.id,JSON.stringify(emailIngress))
  const mobile=await inbound('sms','+12025550124'),stopped=await inbound('sms','+12025550125'),expired=await inbound('whatsapp','12025550126',{at:Date.now()-25*3600000}),unlinked=await inbound('whatsapp','12025550127')
  await inbound('sms',stopped.recipient,{text:'STOP'})
  const incidents=[email,chat,mobile,stopped,expired]
  await call(root.id,'',{...await frontier(root.id),is_problem:true},'PATCH')
  await call(root.id,'/incidents/apply',{action:'link',tickets:await Promise.all([...incidents,unlinked].map(i=>frontier(i.id)))})
  await call(root.id,'/incidents/apply',{action:'unlink',tickets:[await frontier(unlinked.id)]})
  for(const i of [...incidents,unlinked])await app.ok(`${base}/conversations/${i.id}/notes`,{token,body:{content:'Private engineering context for '+i.id}})
  const snapshot=async id=>{
   const {updated_at,...state}=await sla(id)
   return {ticket:await ticket(id),transcript:await transcript(id),sla:{...state,clocks:state.clocks.map(({remaining_minutes,...clock})=>clock)},channel:await receipt(id)}
  }
  const untouched=await snapshot(unlinked.id),beforeClocks=new Map(),beforeStatus=new Map()
  for(const i of incidents){const state=await sla(i.id);assert.equal(state.policy.id,policy.id);beforeClocks.set(i.id,clock(state));beforeStatus.set(i.id,(await ticket(i.id)).status_category)}
  const before={mail:mail.length,sends:sends.length}
  const plan=await call(root.id,'/solve/preview',{reply:'Hi {{contact.name}}, checkout is restored for your request {{ticket.id}}.',solve_incidents:true})
  assert.equal(plan.results.length,5)
  assert.equal(plan.results.filter(r=>r.status==='ready').length,3,JSON.stringify(plan))
  assert.match(plan.results.find(r=>r.id===stopped.id).reason,/customer_opted_out/)
  assert.match(plan.results.find(r=>r.id===expired.id).reason,/reply_window_expired/)
  assert.deepEqual({mail:mail.length,sends:sends.length},before,'preview has no sends')
  const foreign=await app.seedWorkspace('problem-channels-foreign')
  assert.equal((await app.call(problemPath(root.id)+'/solve/apply',{token:foreign.tokens.owner,body:{preview_id:plan.preview_id}})).status,404)
  assert.ok([401,403].includes((await app.call(problemPath(root.id)+'/solve/apply',{token:chat.token,body:{preview_id:plan.preview_id}})).status))
  const operatorPlan=await app.ok(problemPath(root.id)+'/solve/preview',{token:w.tokens.operator,body:{reply:'Transport update'}})
  await app.db.prepare("INSERT INTO member_roles(project_id,user_id,role_key,assigned_at) VALUES(?,?,'collaborator',1)").bind(p,w.users.operator).run()
  assert.equal((await app.call(problemPath(root.id)+'/solve/apply',{token:w.tokens.operator,body:{preview_id:operatorPlan.data.preview_id}})).status,403)
  await app.db.prepare('DELETE FROM member_roles WHERE project_id=? AND user_id=?').bind(p,w.users.operator).run()
  await Promise.all([call(root.id,'/solve/apply',{preview_id:plan.preview_id}),call(root.id,'/solve/apply',{preview_id:plan.preview_id})])
  const result=await call(root.id,'/solve/'+plan.preview_id),outcomes=new Map(result.results.map(r=>[r.id,r]))
  assert.equal(outcomes.get(email.id).status,'solved',JSON.stringify(result))
  assert.equal(outcomes.get(chat.id).status,'solved')
  assert.equal(outcomes.get(mobile.id).status,'accepted',JSON.stringify(result))
  assert.match(outcomes.get(mobile.id).reason,/delivery is unconfirmed/)
  assert.equal(outcomes.get(stopped.id).status,'blocked');assert.equal(outcomes.get(expired.id).status,'blocked')
  assert.equal(sends.length-before.sends,1)
  assert.equal(mail.length-before.mail,1)
  assert.deepEqual(mail.at(-1).to,[email.email]);assert.ok(!mail.at(-1).cc?.length&&!mail.at(-1).bcc?.length)
  assert.match(mail.at(-1).text,new RegExp(email.id))
  assert.equal(sends.at(-1).recipient,mobile.recipient);assert.equal(sends.at(-1).body.Body,plan.results.find(r=>r.id===mobile.id).reply)
  for(const body of [mail.at(-1).text,sends.at(-1).body.Body]){assert.doesNotMatch(body,/Private engineering context/);for(const i of incidents.filter(i=>!body.includes(i.id)))assert.ok(!body.includes(i.email??i.recipient??i.id))}
  const own=await transcript(chat.id,chat.token)
  assert.equal(own.messages.filter(m=>m.local_id?.startsWith('problem:')).length,1)
  for(const i of incidents.filter(i=>i.id!==chat.id))assert.equal((await app.call(`/api/conversations/${i.id}/messages`,{token:chat.token})).status,404)
  for(const i of incidents){
   const was=beforeClocks.get(i.id),now=clock(await sla(i.id)),current=await ticket(i.id)
   assert.equal(now.started_at,was.started_at)
   assert.equal(current.status_category,[email.id,chat.id].includes(i.id)?'solved':i.id===mobile.id?'open':beforeStatus.get(i.id))
   if([email.id,chat.id].includes(i.id))assert.ok(now.completed_at!==null);else assert.equal(now.completed_at,null)
  }
  const channelReceipt=(await receipt(mobile.id)).sends.find(s=>s.message_id===outcomes.get(mobile.id).message_id)
  assert.equal(channelReceipt.state,'accepted')
  const provider=await app.first('SELECT provider_id FROM support_channel_sends WHERE message_id=?',channelReceipt.message_id)
  await deliver(sms,'sms',new URLSearchParams({AccountSid:account,From:sender,To:mobile.recipient,MessageSid:provider.provider_id,MessageStatus:'delivered'}).toString())
  assert.equal((await call(root.id,'/solve/'+plan.preview_id)).results.find(r=>r.id===mobile.id).status,'delivered')
  assert.equal((await ticket(mobile.id)).status_category,'open','delivery callbacks do not assert customer recovery or auto-solve')
  assert.deepEqual(await snapshot(unlinked.id),untouched,'unlinked ticket, transcript, history, SLA and channel receipts stay unchanged')
  assert.ok(!sends.some(s=>s.recipient===unlinked.recipient))
  const count=sends.length,replyMail=()=>mail.filter(m=>m.delivery_id===`message:${outcomes.get(email.id).message_id}:notification`).length
  assert.equal(replyMail(),1)
  await app.configure({})
  await call(root.id,'/solve/apply',{preview_id:plan.preview_id})
  await app.db.prepare("UPDATE conversation_outbox SET delivered_at=NULL WHERE message_id IN (SELECT message_id FROM ticket_problem_attempts WHERE preview_id=?)").bind(plan.preview_id).run()
  await app.drainJobs();await app.scheduled()
  assert.equal(sends.length,count);assert.equal(replyMail(),1,'outbox recovery does not replay reviewed replies')
  assert.ok(!surveys.some(s=>s.to.includes(stopped.email??stopped.recipient)))
  assert.equal((await app.first('SELECT count(*) n FROM csat_surveys WHERE conversation_id IN (?,?,?)',mobile.id,stopped.id,expired.id)).n,0,'unconfirmed and blocked incidents have no resolution invitation')
  // Fresh reviewed commands exercise WhatsApp and terminal network outcomes,
  // then ordinary revocation/registration/consent changes after preview.
  const cases=[{provider:'whatsapp',recipient:'12025550128',expected:'accepted'},
   {provider:'sms',recipient:'+12025550129',response:{status:422,body:{code:21610,message:'Rejected'}},expected:'failed'},
   {provider:'whatsapp',recipient:'12025550130',response:{status:200,body:{}},expected:'uncertain'},
   {provider:'sms',recipient:'+12025550131',change:'stop',expected:'blocked'},
   {provider:'sms',recipient:'+12025550132',change:'registration',expected:'blocked'},
   {provider:'sms',recipient:'+12025550135',change:'requester',expected:'blocked'},
   {provider:'whatsapp',recipient:'12025550134',change:'window',expected:'blocked'},
   {provider:'whatsapp',recipient:'12025550133',change:'revoke',expected:'blocked'}]
  for(const entry of cases){
   const problem=await widget('Transport problem'),incident=await inbound(entry.provider,entry.recipient)
   await call(problem.id,'',{...await frontier(problem.id),is_problem:true},'PATCH')
   await call(problem.id,'/incidents/apply',{action:'link',tickets:[await frontier(incident.id)]})
   const beforeStatus=(await ticket(incident.id)).status_category
   const preview=await call(problem.id,'/solve/preview',{reply:'Hi {{contact.name}}, update for {{ticket.id}}.',solve_incidents:true})
   assert.equal(preview.results[0].status,'ready',JSON.stringify(preview))
   const n=sends.length
   if(entry.response)responses.set(entry.recipient,entry.response)
   if(entry.change==='stop')await inbound('sms',entry.recipient,{text:'STOP'})
   if(entry.change==='registration')await app.db.prepare('UPDATE support_channel_connections SET registered=0 WHERE id=?').bind(sms.id).run()
   if(entry.change==='requester')await app.ok(`${base}/conversations/${incident.id}/ticket`,{token,method:'PATCH',body:{requester_id:(await ticket(problem.id)).contact_id,expected_version:(await frontier(incident.id)).expected_version}})
   if(entry.change==='window')await app.db.prepare('UPDATE support_channel_threads SET last_inbound_at=0 WHERE conversation_id=?').bind(incident.id).run()
   if(entry.change==='revoke')await app.ok(channels+'/connections/'+whatsapp.id,{token,method:'DELETE'})
   const applied=await call(problem.id,'/solve/apply',{preview_id:preview.preview_id})
   assert.equal(applied.results[0].status,entry.expected,JSON.stringify(applied))
   assert.equal(sends.length-n,entry.change?0:1)
   assert.equal((await ticket(incident.id)).status_category,entry.change?beforeStatus:'open')
   if(!entry.change){
    const saved=(await transcript(incident.id)).messages.find(m=>m.local_id?.startsWith('problem:'))
    assert.equal(saved.content,preview.results[0].reply)
    assert.equal((await receipt(incident.id)).sends.find(s=>s.message_id===saved.id).state,entry.expected)
   }
   const after=sends.length
   await app.configure({});await call(problem.id,'/solve/apply',{preview_id:preview.preview_id});await app.drainJobs();await app.scheduled()
   assert.equal(sends.length,after,'terminal or refused sends never replay after restart')
   if(entry.change==='registration')await app.db.prepare('UPDATE support_channel_connections SET registered=1 WHERE id=?').bind(sms.id).run()
  }
  await app.ok(`/api/management/projects/${p}/contacts/${mobile.contact_id}/erase`,{token,body:{}})
  assert.equal((await call(root.id,'/solve/'+plan.preview_id)).state,'erased')
  const afterErasure=sends.length;await app.scheduled();assert.equal(sends.length,afterErasure)
  console.log('PROBE CONVERSATION-003 1: native email/widget and signed SMS/WhatsApp intake -> five linked incidents; preview sends 0; email/widget solved, SMS accepted then delivered with incident open, STOP and expired WhatsApp blocked; provider refusal/unknown and post-preview authority checks visible; repeat/restart sends 0')
  console.log('PROBE CONVERSATION-003 2: native link/unlink then solve routes -> unlinked WhatsApp transcript/status/history/SLA/receipts unchanged; provider sends 0')
 }finally{await app.close()}
}
