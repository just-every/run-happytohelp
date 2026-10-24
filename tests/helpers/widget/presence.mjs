import assert from 'node:assert/strict'
import {startApp,sha} from '../../journeys/kit/app.mjs'
import {socketClient} from './sockets.mjs'

// Live bounds of workspace presence (src/modules/collaboration/presence.ts).
const ONLINE_TTL_MS=90_000,CLOSE_GRACE_MS=10_000

// Presence-based away on the real application: teammates' dashboard streams decide whether anyone is online, and the
// widget settings door, the away reply, Settings -> Availability and the security log follow it.
export async function presenceJourney(){
 const app=await startApp({origin:'https://app.example'}),socketTo=socketClient(app)
 try{
  const workspace=await app.seedWorkspace('presence',{allowedOrigin:'https://widget.example'}),p=workspace.projectId,{owner,admin,operator}=workspace.tokens,users=workspace.users
  // A collaborator adds internal notes only: their open dashboard never makes the team available.
  const collaborator='collaborator-token-presence',now=Date.now()
  await app.db.batch([
   app.db.prepare('INSERT INTO users(id,email,name,created_at) VALUES(?,?,?,?)').bind('collaborator-presence','collaborator-presence@example.test','collaborator presence',now),
   app.db.prepare("INSERT INTO memberships VALUES(?,?,'operator')").bind(p,'collaborator-presence'),
   app.db.prepare("INSERT INTO member_roles(project_id,user_id,role_key,assigned_at) VALUES(?,?,'collaborator',?)").bind(p,'collaborator-presence',now),
   app.db.prepare("INSERT INTO sessions(token_hash,actor_id,project_id,role,expires_at) VALUES(?,?,?,'operator',?)").bind(sha(collaborator),'collaborator-presence',p,now+3600000),
   app.db.prepare("INSERT INTO session_factors(token_hash,user_id,method,verified_at) VALUES(?,?,'password',?)").bind(sha(collaborator),'collaborator-presence',now)])
  const state=async()=>{const {available,live,opensAt}=(await app.call(`/api/widget/settings?widgetKey=${workspace.widgetKey}`,{headers:{Origin:'https://widget.example'},status:200})).data.availability;return {available,live,opensAt}}
  const away={available:false,live:true,opensAt:null},online={available:true,live:true,opensAt:null}
  const becomes=(expected,message)=>app.until(async()=>JSON.stringify(await state())===JSON.stringify(expected),{timeout:CLOSE_GRACE_MS+10_000,interval:100,message})
  const stream=async token=>{const opened=await socketTo(`/api/projects/${p}/socket`,{Cookie:`h2h_session=${token}`,Origin:'https://app.example'});assert.equal(opened.status,101);return opened}
  const report=(opened,idleMs)=>opened.socket.send(JSON.stringify({type:'presence',idleMs}))
  const row=user=>app.first('SELECT active_at,expires_at FROM operator_presence WHERE project_id=? AND user_id=?',p,user)
  const availabilityPut=(token,body,status=200)=>app.call(`/api/management/projects/${p}/availability`,{token,method:'PUT',body,status})
  const visitor=async()=>(await app.call('/api/identity/widget/session',{body:{widgetKey:workspace.widgetKey},headers:{Origin:'https://widget.example'},status:201})).data
  const conversation=async contact=>(await app.call('/api/conversations',{token:contact.token,body:{projectId:p},status:201})).data
  const write=(contact,id,localId,content,expectedRevision)=>app.call(`/api/conversations/${id}/messages`,{token:contact.token,body:{localId,content,expectedRevision},status:200})
  const transcript=id=>app.sql('SELECT actor_role,content FROM messages WHERE conversation_id=? ORDER BY revision',id)

  // Open hours (no schedule, accepting conversations) and nobody online: visitors are told the team is away, with no
  // reopening time, but with the configured response estimate; an open widget keeps asking.
  assert.deepEqual(await state(),away,'nobody online during open hours is away')
  const notes=await stream(collaborator);report(notes,0)
  await app.until(()=>row('collaborator-presence'),{message:'the collaborator stream reported'})
  assert.deepEqual(await state(),away,'a collaborator cannot reply, so never counts as online')

  // An agent with the dashboard open and in use makes the team available; their entry lives at most 90 seconds past
  // the last report.
  const desk=await stream(operator);report(desk,0)
  await becomes(online,'an active agent makes the team available')
  assert.ok((await row(users.operator)).expires_at<=Date.now()+ONLINE_TTL_MS,'an entry expires within 90 seconds of its last report')
  assert.deepEqual((await app.call(`/api/management/projects/${p}/presence`,{token:owner,status:200})).data.data.online.map(person=>person.id),[users.operator],'Settings lists who is online')

  // Idle past the lead's idle time (15 minutes unless changed) is away; another active tab of the same agent is online,
  // and closing it leaves the idle one.
  report(desk,16*60_000);await becomes(away,'an agent idle for 16 minutes is away')
  const tab=await stream(operator);report(tab,0);await becomes(online,'an active second tab is online')
  tab.socket.close();await becomes(away,'closing the active tab leaves the idle one')
  // The lead allows 30 idle minutes: the same agent is online again. Collaborators cannot change it; the idle time is
  // one of the offered values; each change is in the security log.
  await availabilityPut(collaborator,{presence_idle_minutes:30},403)
  await availabilityPut(owner,{presence_idle_minutes:7},400)
  await availabilityPut(admin,{presence_idle_minutes:30});await becomes(online,'16 idle minutes are within 30')

  // Closing the dashboard is away within the close grace (10 seconds).
  const closedAt=Date.now();desk.socket.close()
  await app.until(async()=>(await row(users.operator)).expires_at<=closedAt+CLOSE_GRACE_MS+5000,{message:'a closed stream lingers only for the grace'})
  await becomes(away,'closing the dashboard is away')

  // A revoked session's stream closes at its next report and stops counting; a removed member stops at once.
  const lead=await stream(admin);report(lead,0);await becomes(online,'an active admin is online')
  const revoked=new Promise(resolve=>lead.socket.addEventListener('close',resolve,{once:true}))
  await app.db.prepare('UPDATE sessions SET revoked_at=? WHERE token_hash=?').bind(Date.now(),sha(admin)).run()
  report(lead,0);await revoked;await becomes(away,'a revoked teammate is away')
  const agent=await stream(operator);report(agent,0);await becomes(online,'the agent is back')
  await app.call(`/api/management/projects/${p}/agents/${users.operator}`,{token:owner,method:'DELETE',status:200})
  assert.deepEqual(await state(),away,'a removed member is away at once');assert.equal(await row(users.operator),null)

  // While nobody is online a visitor's chat earns the away message once; while someone is, none; the lead's own away
  // message replaces the standard one.
  const night=await visitor(),first=await conversation(night)
  await write(night,first.id,'presence-1','Is anyone there?',0);await write(night,first.id,'presence-2','My parcel is late.',2)
  const quiet=await transcript(first.id)
  assert.deepEqual(quiet.map(message=>message.actor_role),['contact','system','contact'])
  assert.equal(quiet[1].content,"Thanks for your message. Workspace presence is away right now. We'll reply here. Responds within 24 hours")
  const front=await stream(owner);report(front,0);await becomes(online,'the owner is online')
  const day=await visitor(),second=await conversation(day)
  await write(day,second.id,'presence-day','Hello?',0)
  assert.deepEqual((await transcript(second.id)).map(message=>message.actor_role),['contact'],'no away message while a teammate is online')
  const responseTime='Responds within two business days'
  await app.call(`/api/management/projects/${p}/widget-settings`,{token:owner,method:'PUT',body:{text:{ai:{human_response:responseTime}}},status:200})
  await app.call(`/api/management/projects/${p}/settings`,{token:owner,method:'PUT',body:{is_available:false},status:200})
  assert.equal((await state()).available,false,'Accept new conversations off is away even with the owner online')
  const paused=await visitor(),pausedChat=await conversation(paused)
  await write(paused,pausedChat.id,'presence-paused','Can you help?',0)
  assert.ok((await transcript(pausedChat.id))[1].content.includes(responseTime),'the switched-off away reply includes the configured estimate')
  await app.call(`/api/management/projects/${p}/settings`,{token:owner,method:'PUT',body:{is_available:true},status:200})
  await availabilityPut(owner,{presence_away_message:'Our team is with other customers. We will email you shortly.'})
  front.socket.close();await becomes(away,'the owner left')
  const later=await visitor(),third=await conversation(later)
  await write(later,third.id,'presence-later','Still there?',0)
  assert.deepEqual((await transcript(third.id)).map(message=>message.content),['Still there?',`Our team is with other customers. We will email you shortly. ${responseTime}`])

  // Outside the schedule's hours nothing changes: the team is away with its return time, whoever is online.
  const back=await stream(owner);report(back,0);await becomes(online,'the owner is back')
  const weekday=(new Date().getUTCDay()+6)%7+1,closedDay=weekday%7+1
  await availabilityPut(owner,{is_availability_schedule_enabled:true,availability_schedule:{days:[closedDay],time_from:'09:00',time_to:'17:00',message:''}})
  const closed=await state();assert.equal(closed.available,false);assert.equal(closed.live,false);assert.ok(closed.opensAt>Date.now(),'outside hours the widget says when the team is back')
  await availabilityPut(owner,{is_availability_schedule_enabled:false})
  await becomes(online,'without the schedule the online owner makes the team available again')

  // A restart drops every stream without a close; the entry it leaves expires on its own within 90 seconds of its last
  // report, and the reconnecting dashboard reports again.
  await app.configure({})
  assert.ok((await row(users.owner)).expires_at<=Date.now()+ONLINE_TTL_MS,'the entry a restart leaves behind still expires')
  const reconnected=await stream(owner);report(reconnected,0);await becomes(online,'the reconnected dashboard is online')
  reconnected.socket.close();await becomes(away,'and away once closed')

  // A lead turns presence-based away off: the schedule and switch alone decide again, and the log shows each change.
  await availabilityPut(collaborator,{is_presence_away_enabled:false},403)
  await availabilityPut(owner,{is_presence_away_enabled:false})
  assert.deepEqual(await state(),{available:true,live:false,opensAt:null},'with presence-based away off nobody online is still available')
  const changes=(await app.call(`/api/management/projects/${p}/audit`,{token:owner,status:200})).data.data.filter(event=>event.action==='availability.presence_changed')
  assert.deepEqual(changes.map(event=>event.detail),[{from:'On, 30 min idle',to:'Off, 30 min idle'},{from:'On, 15 min idle',to:'On, 30 min idle'}])
  assert.equal((await app.sql("SELECT count(*) n FROM audit_events WHERE project_id=? AND action='permission.denied' AND actor_id='collaborator-presence'",p))[0].n,2,'each collaborator attempt is refused and logged')

  // An enabled visitor assistant whose provider key is installed answers visitors, so nobody online is not away.
  await availabilityPut(owner,{is_presence_away_enabled:true})
  await app.db.prepare("INSERT INTO ai_profiles(id,project_id,name,role,prompt,model,is_enabled,created_at) VALUES('presence-assistant',?,'Night assistant','Support','Answer visitors.','gpt-5-mini',1,1)").bind(p).run()
  await app.call(`/api/management/projects/${p}/ai`,{token:owner,method:'PUT',body:{default_visitor_ai_id:'presence-assistant'},status:200})
  assert.deepEqual(await state(),away,'an assistant without its provider key answers nobody')
  await app.configure({OPENAI_API_KEY:'synthetic-presence-provider-key'})
  assert.deepEqual(await state(),{available:true,live:false,opensAt:null},'an answering assistant keeps the widget available')

  // SLA calendars, not the legacy opening-hours setting, own matching widget intake.
  // Both the holiday and explicit closure are exercised through the public settings door.
  await app.call(`/api/management/projects/${p}/ai`,{token:owner,method:'PUT',body:{default_visitor_ai_id:null},status:200})
  await availabilityPut(owner,{is_presence_away_enabled:false,is_availability_schedule_enabled:true,availability_schedule:{days:[1,2,3,4,5,6,7],time_from:'00:00',time_to:'23:59',message:''}})
  const manage=(path,body,method='POST')=>app.call(`/api/management/projects/${p}${path}`,{token:owner,body,method,status:method==='POST'?201:200}).then(result=>result.data.data)
  const calendar=await manage('/workflow-calendars',{name:'synthetic-happytohelp-1',timezone:'UTC',weekly:[0,1,2,3,4,5,6].map(day=>({day,start:'00:00',end:'24:00'})),holidays:'us_federal',closures:['2026-11-27']})
  const ignored=await manage('/sla-policies',{name:'synthetic-happytohelp-2',calendar_id:calendar.id,position:0,conditions:{channels:['email']},first_response_minutes:60})
  const policy=await manage('/sla-policies',{name:'synthetic-happytohelp-3',calendar_id:calendar.id,position:1,conditions:{channels:['widget']},first_response_minutes:60})
  for(const date of ['2026-11-26','2026-11-27']){
   await app.configure({H2H_LOCAL:'true',APP_ORIGIN:'https://app.example',H2H_WORKFLOW_NOW:String(Date.parse(`${date}T12:00:00Z`))})
   const settings=(await app.call(`/api/widget/settings?widgetKey=${workspace.widgetKey}`,{headers:{Origin:'https://widget.example'},status:200})).data
   assert.equal(settings.availability.available,false,`${date}: a holiday or closure overrides opening hours that say open`)
   assert.equal(settings.availability.opensAt,Date.parse('2026-11-28T00:00:00Z'),'the next opening skips both Thanksgiving and the closure')
   const contact=await visitor(),ticket=await conversation(contact)
   await write(contact,ticket.id,`calendar-${date}`,'When will someone reply?',0)
   assert.match((await transcript(ticket.id))[1].content,/back Saturday at 12:00 AM UTC/,'the public conversation uses the same calendar as the widget')
  }
  await manage(`/workflow-calendars/${calendar.id}`,{closures:[],holidays:'none'},'PATCH')
  assert.equal((await state()).available,true,'removing the calendar exceptions restores availability')
  await manage(`/sla-policies/${policy.id}`,{active:false},'PATCH')
  assert.equal((await state()).available,true,'a nonmatching email policy leaves the widget opening hours in force')
  await availabilityPut(owner,{is_presence_away_enabled:false,is_availability_schedule_enabled:true,availability_schedule:{days:[1],time_from:'09:00',time_to:'17:00',message:''}})
  assert.equal((await state()).available,false,'without a matching SLA calendar, the legacy schedule still closes the widget')

 }finally{await app.close()}
}
