import assert from 'node:assert/strict'

export async function availabilityOutcomes(f){
 const {app,w,p,owner,manage,ok,settings,availability,configuration,clock,open,transcript,mail}=f
 await settings({timezone:'America/New_York',default_responder:'human'})
 await ok(manage+'/widget-settings',{text:{ai:{human_response:'Usually within two business hours'}}})
 const weekly={days:[1,2,3,4,5],time_from:'09:00',time_to:'17:00',message:''}
 await availability({is_available:true,is_availability_schedule_enabled:true,availability_schedule:weekly,is_presence_away_enabled:true})
 // A public operator reply is delivered through the native mail queue. The
 // away acknowledgement remains one system message and never becomes an emailed answer.
 const leaveAndAnswer=async(label,{back=false}={})=>{
  const ui=await open({at:label==='outside'?'2026-10-26T22:00:00Z':'2026-10-27T16:00:00Z'})
  try{
   const notice=ui.page.locator('.happytohelp-away-notice')
   await notice.getByText("We're away right now",{exact:true}).waitFor()
   if(back){assert.match(await notice.textContent(),/tomorrow at 3:00 AM/);assert.match(await ui.page.locator('.happytohelp-chat-header').textContent(),/tomorrow at 3:00 AM/)}
   else {assert.match(await notice.textContent(),/Usually within two business hours/);assert.match(await ui.page.locator('.happytohelp-chat-header').textContent(),/Usually within two business hours/)}
   const email=`${label}@visitor.example.test`
   await ui.page.getByRole('textbox',{name:'you@example.com',exact:true}).fill(email)
   await ui.page.locator('textarea[name=content]').fill('Please help me finish checkout.')
   await ui.page.locator('button[name=submit]').click()
   const v=await ui.session()
   await app.until(async()=>(await transcript(v)).messages.some(m=>m.actor_role==='system'),{message:label+' away reply'})
   const current=await transcript(v),away=current.messages.filter(m=>m.actor_role==='system')
   assert.equal(current.messages.filter(m=>m.actor_role==='contact').length,1)
   assert.equal(away.length,1);assert.equal(away[0].actor_id,'away')
   if(!back)assert.match(away[0].content,/Usually within two business hours/)
   const profile=await app.ok('/api/identity/widget/profile',{token:v.token,headers:f.headers})
   assert.equal(profile.contact.email,email,'typed notification address is retained')
   const tickets=await app.ok(`/api/dashboard/projects/${p}/conversations`,{token:owner})
   assert.equal(tickets.data.filter(t=>t.id===v.conversationId).length,1,'one native ticket reaches the inbox')
   const answer=`We saved your ${label} checkout. Reply here whenever you are ready.`
   const sent=await app.ok(`/api/conversations/${v.conversationId}/messages`,{token:owner,body:{localId:'answer-'+label,content:answer,expectedRevision:current.revision,expectedLastMessageId:current.lastMessageId}})
   await app.drainJobs();await app.scheduled(undefined,{after:61000});await app.drainJobs()
   const delivered=await app.until(()=>mail.find(m=>m.to.includes(email)&&m.text.includes(answer)),{message:'provider-edge answer'})
   assert.deepEqual(delivered.to,[email])
   assert.ok(delivered.text.split('\n').some(line=>line===answer),'exact answer text reaches the mail provider')
   assert.ok(!delivered.text.includes(away[0].content),'away acknowledgement is not an emailed human answer')
   const buckets=await app.ok(`/api/dashboard/projects/${p}/conversations/${v.conversationId}/buckets`,{token:owner})
   const deliveredMessage=buckets.data.flatMap(bucket=>bucket.messages).find(m=>m.id===sent.message.id)
   assert.equal(deliveredMessage.email_status.state,'sent')
   await ui.reload();await ui.page.getByText(answer,{exact:true}).waitFor()
   assert.equal((await transcript(v)).messages.filter(m=>m.actor_role==='system').length,1,'reload never duplicates the away reply')
   assert.deepEqual(ui.errors,[])
  }finally{await ui.close()}
 }
 const outside=await configuration();assert.equal(outside.availability.available,false);assert.equal(outside.availability.opensAt,Date.parse('2026-10-27T13:00:00Z'))
 await leaveAndAnswer('outside',{back:true})
 await clock('2026-10-27T16:00:00Z')
 const nobody=await configuration();assert.equal(nobody.availability.available,false);assert.equal(nobody.availability.live,true);assert.equal(nobody.availability.opensAt,null)
 await leaveAndAnswer('nobody')
 await availability({is_available:false})
 assert.equal((await configuration()).availability.available,false)
 await leaveAndAnswer('accept-off')
 // SLA-001 calendars are configured and observed through their public routes;
 // no calendar implementation is changed by this widget qualification.
 await availability({is_available:true,is_presence_away_enabled:false})
 const calendar=(await ok(`/api/dashboard/projects/${p}/workflow-calendars`,{name:'Support business days',timezone:'America/New_York',weekly:[1,2,3,4,5].map(day=>({day,start:'09:00',end:'17:00'})),holidays:'us_federal',closures:['2026-11-12']},'POST')).data
 await ok(`/api/dashboard/projects/${p}/sla-policies`,{name:'Widget hours',calendar_id:calendar.id,conditions:{},first_response_minutes:120,resolution_minutes:480,pause_on_hold:true},'POST')
 for(const [at,next] of [['2026-11-11T16:00:00Z','2026-11-13T14:00:00Z'],['2026-11-12T16:00:00Z','2026-11-13T14:00:00Z']]){
  await clock(at)
  const state=(await configuration()).availability
  assert.equal(state.available,false);assert.equal(state.calendar.id,calendar.id);assert.equal(state.opensAt,Date.parse(next),'holiday and closure override otherwise-open widget hours')
  const v=await app.ok('/api/identity/widget/session',{headers:f.headers,body:{widgetKey:w.widgetKey}})
  const c=await app.ok('/api/conversations',{token:v.token,body:{projectId:p}})
  await app.ok(`/api/conversations/${c.id}/messages`,{token:v.token,body:{localId:'closure',content:'Are you open?',expectedRevision:0}})
  await app.drainJobs()
  assert.equal((await transcript({...v,conversationId:c.id})).messages.filter(m=>m.actor_id==='away').length,1)
 }
 // With a configured, enabled assistant, the real queue admits an AI answer;
 // the installed widget keeps an explicit disclosure after copy edits and reload.
 await clock('2026-10-27T16:00:00Z');await availability({is_presence_away_enabled:true})
 await app.db.prepare("INSERT INTO ai_profiles(id,project_id,name,role,prompt,model,created_at) VALUES('widget-assistant',?,'Checkout assistant','support','Answer briefly','gpt-5.6-luna',?)").bind(p,Date.now()).run()
 await ok(manage+'/ai',{default_visitor_ai_id:'widget-assistant'})
 assert.equal((await configuration()).availability.available,false,'an assistant without its provider key cannot promise availability')
 await app.configure({OPENAI_API_KEY:'synthetic-widget-model'})
 assert.equal((await configuration()).availability.available,true,'permitted provider-ready AI makes the team available')
 const ui=await open({at:'2026-10-27T16:00:00Z'})
 try{
  await ui.page.locator('.happytohelp-ai-disclosure').getByText('AI assistant',{exact:true}).waitFor()
  assert.equal(await ui.page.locator('.happytohelp-away-notice').count(),0)
  await ui.page.locator('textarea[name=content]').fill('Can you help with checkout?');await ui.page.locator('button[name=submit]').click()
  const v=await ui.session();const jobs=await app.until(async()=>{const pending=await app.takeJobs();return pending.length?pending:null},{message:'AI queue admission'});await app.runJobs(jobs)
  // The queue is captured at its network edge; scheduled outbox recovery drains
  // any delivery admitted between the browser click and the queue read.
  await app.scheduled();await app.drainJobs()
  await ui.page.getByText('Your checkout is saved. A teammate can help you finish.',{exact:true}).waitFor()
  assert.equal((await transcript(v)).messages.filter(m=>m.actor_role==='ai').length,1)
  assert.equal((await transcript(v)).messages.filter(m=>m.actor_id==='away').length,0)
  await ok(manage+'/widget-settings',{text:{ai:{human_response:'A teammate will reply soon'}}})
  await ui.reload();await ui.page.locator('.happytohelp-ai-disclosure').getByText('AI assistant',{exact:true}).waitFor()
  await ui.page.getByText('Your checkout is saved. A teammate can help you finish.',{exact:true}).waitFor()
  assert.deepEqual(ui.errors,[])
 }finally{await ui.close()}
 await ok(manage+'/ai',{default_visitor_ai_id:null})
 await app.configure({H2H_WORKFLOW_NOW:undefined})
 await availability({is_presence_away_enabled:false,is_availability_schedule_enabled:false,is_available:true})
}
