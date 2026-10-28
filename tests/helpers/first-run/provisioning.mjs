import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {startApp} from '../../journeys/kit/app.mjs'

// Workspace provisioning through public routes on the real application: the starter assistant, mailbox and proposed
// sender every new workspace starts with, the spend it reports and the Setup tables an upgrade adds. Only the network
// edge is faked: OpenAI answers a streamed reply, Resend accepts mail and nothing else is reachable.
const setupToken='synthetic-provisioning-setup-token'
const edge=(log,s)=>async(request,{url,body})=>{
 const {host,pathname}=new URL(url)
 if(host==='cloudflare-dns.com'){
  const name=new URL(url).searchParams.get('name'),value=name.startsWith('_dmarc.')?'v=DMARC1; p=none':name.includes('._domainkey.')?'v=DKIM1; p=synthetic-public-key':'v=spf1 include:fixture.test ~all'
  return Response.json({Status:0,Answer:[{type:16,data:JSON.stringify(value)}]})
 }
 if(host==='api.resend.com'&&pathname==='/domains')return Response.json({data:['example.test','acme-outdoors.example'].map(name=>({id:name,name})),has_more:false})
 if(host==='api.resend.com'&&pathname.startsWith('/domains/'))return Response.json({id:pathname.split('/').pop(),name:pathname.split('/').pop(),status:s.dns,records:[{record:'SPF',name:'send',type:'TXT',value:'v=spf1 include:fixture.test ~all',status:s.dns},{record:'DKIM',name:'resend._domainkey',type:'TXT',value:'p=fixture',status:s.dns}]})
 if(host==='api.resend.com'&&pathname.startsWith('/emails/')){const id=pathname.split('/').pop(),sent=s.sent.get(id);return Response.json({id,to:sent.to,from:sent.from,last_event:s.event})}
 if(host==='api.openai.com'&&pathname.startsWith('/v1/models/'))return Response.json({id:decodeURIComponent(pathname.split('/').pop())},{status:s.modelStatus})
 if(host==='api.openai.com'){
  log.push({provider:'openai',path:pathname})
  const text='Our help article says returns are free within 30 days.'
  const events=[{type:'response.output_text.delta',item_id:'msg1',delta:text},{type:'response.output_text.done',item_id:'msg1',text},{type:'response.completed',response:{usage:{input_tokens:5,output_tokens:9,total_tokens:14,input_tokens_details:{cached_tokens:0,cache_write_tokens:0},output_tokens_details:{reasoning_tokens:0}}}}]
  return new Response(events.map(event=>`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),{headers:{'content-type':'text/event-stream'}})
 }
 if(host==='api.resend.com'&&pathname==='/emails'){s.attempts++;const sent=JSON.parse(body);log.push({provider:'resend',to:sent.to,text:sent.text});if(s.lost)throw new TypeError('Synthetic lost send acknowledgement');const id=`fixture-${log.length}`;s.sent.set(id,sent);return Response.json({id})}
 log.push({unreachable:host});return new Response('Not reachable from this test',{status:503})
}
const ok=(response,status=200)=>{assert.equal(response.status,status,JSON.stringify(response.data));return response.data}

async function installation(bindings,{claim=true}={}){
 const observations={sent:new Map(),attempts:0,lost:false,event:'sent',dns:'verified',modelStatus:200},log=[],app=await startApp({bindings:{H2H_SETUP_TOKEN:setupToken,RATE_LIMITS:JSON.stringify({projectsPerAccountDay:100,projectsPerIpDay:100,registrationsPerIpDay:100,widgetSessionsPerIpHour:100}),...bindings},outbound:edge(log,observations)})
 const call=(path,{origin,...options}={})=>app.call(path,{...options,headers:{Origin:origin||app.origin,...options.headers}})
 const owner=claim?ok(await call('/api/identity/bootstrap',{body:{name:'Owner workspace',email:'owner@provisioning.example',password:'synthetic-provisioning-owner-password-123',allowedOrigin:'https://owner.example',setupToken}}),201):null
 const settingsOf=async(token,projectId)=>ok(await call(`/api/management/projects/${projectId}/settings`,{token})).data
 const assistantsOf=async(token,projectId)=>ok(await call(`/api/management/projects/${projectId}/ais`,{token})).data
 const mailboxOf=async(token,projectId)=>ok(await call(`/api/management/projects/${projectId}/email-settings`,{token})).data
 const newWorkspace=async(token,name,origin)=>ok(await call('/api/management/projects',{body:{name,allowed_origin:origin},token}),201)
 // One enabled starter, the default for visitors and signed-in users, and a marker that records exactly what it was created with.
 const assertStarter=async(token,projectId)=>{
  const assistants=await assistantsOf(token,projectId);assert.equal(assistants.length,1,'exactly one assistant')
  const [starter]=assistants;assert.equal(starter.is_enabled,1)
  for(const field of ['name','role','prompt','model'])assert.ok(String(starter[field]).trim(),`starter ${field}`)
  const settings=await settingsOf(token,projectId)
  for(const key of ['default_visitor_ai_id','default_responder','default_verified_user_ai_id'])assert.equal(settings[key],starter.id,key)
  assert.deepEqual(settings.starter_ai,{id:starter.id,seed:{name:starter.name,role:starter.role,prompt:starter.prompt,model:starter.model,is_enabled:true}})
  assert.equal('ai_reply_mode' in settings,false,'the starter answers by itself; there is no reply mode')
  return {starter,settings}
 }
 const visitor=async(token,projectId,origin)=>{
  const workspace=ok(await call('/api/management/projects',{token})).data.find(row=>row.id===projectId)
  const session=ok(await call('/api/identity/widget/session',{body:{widgetKey:workspace.widget_key,name:'Visitor'},origin}),201)
  const conversation=ok(await call('/api/conversations',{body:{projectId},token:session.token,origin}),201)
  const say=async content=>{const transcript=ok(await call(`/api/conversations/${conversation.id}/messages`,{token:session.token,origin}));return ok(await call(`/api/conversations/${conversation.id}/messages`,{body:{localId:content,content,expectedRevision:transcript.revision},token:session.token,origin}))}
  return {conversation,session,say}
 }
 return {app,log,observations,call,owner,settingsOf,assistantsOf,mailboxOf,newWorkspace,assertStarter,visitor,close:()=>app.close()}
}

export async function provisioningJourney(){
 const i=await installation({INBOUND_EMAIL_TOKEN:'a'.repeat(64)})
 try{
  await withoutKey(i)
  await i.app.configure({OPENAI_API_KEY:'test-only-openai-key',AI_DAILY_CEILINGS:JSON.stringify({repliesPerProject:1}),EMAIL_API_KEY:'test-only-resend-key',EMAIL_FROM:'HappyToHelp <hello@app.example>',APP_ORIGIN:'https://app.example',REGISTRATION_ENABLED:'true',INBOUND_EMAIL_DOMAIN:'replies.app.example'})
  await keyedRegistration(i)
  // Leave the hosted inbound-domain override behind when entering a local trial.
  await i.app.configure({OPENAI_API_KEY:undefined,EMAIL_API_KEY:undefined,INBOUND_EMAIL_DOMAIN:undefined,H2H_LOCAL:'true',EMAIL_PROVIDER:'development',APP_ORIGIN:'http://127.0.0.1:8787',EMAIL_FROM:'HappyToHelp <owner-mail@localhost.test>'})
  await localInstall(i)
  await i.app.configure({H2H_LOCAL:undefined,EMAIL_PROVIDER:'resend',APP_ORIGIN:undefined,EMAIL_FROM:undefined,ANTHROPIC_API_KEY:'test-only-anthropic-key',INBOUND_EMAIL_TOKEN:undefined,AI_DAILY_CEILINGS:JSON.stringify({repliesPerProject:2,repliesPerInstallation:3,spendUsdPerProject:1,contextRunsPerProject:2})})
  await installedProvider(i)
 }finally{await i.close()}
}

// Without an AI key a new workspace is set up, keeps visitors with the team and fails nothing.
async function withoutKey(i){
 const {app,call,log}=i
  const token=i.owner.token,origin='https://www.acme-outdoors.example'
  const first=await i.newWorkspace(token,'Acme Outdoors',origin),{starter}=await i.assertStarter(token,first.id)
  // Its mailbox is on the website's own domain and stays off until this installation can send mail.
  const mailbox=await i.mailboxOf(token,first.id)
  assert.equal(mailbox.email_to_address,'acme-outdoors@in.acme-outdoors.example');assert.equal(mailbox.is_enabled,0)
  // Without an installation sender nothing can be sent; the row holds the website's own address, also proposed.
  assert.equal(mailbox.from_address,'support@acme-outdoors.example');assert.equal((await i.settingsOf(token,first.id)).proposed_sender,'support@acme-outdoors.example')
  // A same-name workspace gets its own mailbox inside its creation, never a conflict.
  const twin=await i.newWorkspace(token,'Acme Outdoors',origin),twinMailbox=await i.mailboxOf(token,twin.id)
  assert.ok(twinMailbox.email_to_address.endsWith('@in.acme-outdoors.example'));assert.notEqual(twinMailbox.email_to_address,mailbox.email_to_address)
  // The AI page names the key the starter waits for, and nothing about the key itself.
  const readiness=ok(await call(`/api/management/projects/${first.id}/ai`,{token})).data
  assert.equal(readiness.assistant.id,starter.id);assert.equal(readiness.ready,false);assert.match(readiness.secretName,/^[A-Z]+_API_KEY$/)
  // A visitor's conversation stays with the humans: no assistant takes it, no reply is requested, nothing fails.
  const chat=await i.visitor(token,first.id,origin),sent=await chat.say('Can I return my tent?')
  assert.equal(sent.accepted,true);assert.equal(sent.generationError,undefined)
  assert.equal((await app.first('SELECT count(*) n FROM ai_generations WHERE conversation_id=?',chat.conversation.id)).n,0)
  assert.equal(await app.first('SELECT ai_id FROM conversation_ai WHERE conversation_id=?',chat.conversation.id),null)
  const counts=ok(await call(`/api/dashboard/projects/${first.id}/conversations/counts`,{token})).data;assert.equal(counts.unassigned,1);assert.equal(counts.ai,0)
  // Asking for AI explicitly still fails explicitly, naming the missing secret.
  const operator=ok(await call('/api/identity/switch-project',{body:{projectId:first.id},token})).token
  const revision=ok(await call(`/api/conversations/${chat.conversation.id}/messages`,{token:operator})).revision
  const suggestion=await call(`/api/ai-support/projects/${first.id}/conversations/${chat.conversation.id}/suggestions`,{body:{expectedRevision:revision},token:operator})
  assert.equal(suggestion.status,409);assert.match(suggestion.data.error,new RegExp(`CONFIGURATION_REQUIRED: ${readiness.secretName}`))
  const reply=await call(`/api/ai-support/projects/${first.id}/conversations/${chat.conversation.id}/generations`,{body:{expectedRevision:revision},token:operator})
  assert.equal(reply.status,409);assert.match(reply.data.error,/CONFIGURATION_REQUIRED/)
  assert.ok(!log.some(entry=>entry.provider==='openai'),'no provider request without a key')
  // The site read is queued after creation and its record joins the settings without displacing the defaults.
  const read=await app.until(async()=>{const settings=await i.settingsOf(token,first.id);return settings.site_read&&!['queued','running'].includes(settings.site_read.state)&&settings},{timeout:15000,message:'the site read'})
  assert.equal(read.default_visitor_ai_id,starter.id)
  // Owner edits stand: the marker still records what was created, so an edited starter is told apart from an untouched one.
  ok(await call(`/api/management/projects/${first.id}/ais/${starter.id}`,{method:'PUT',body:{prompt:'Answer in the owner\'s own words.'},token}))
  ok(await call(`/api/management/projects/${first.id}/ai`,{method:'PUT',body:{default_visitor_ai_id:'-'},token}))
  const edited=await i.settingsOf(token,first.id)
  assert.equal(edited.default_visitor_ai_id,null);assert.equal(edited.starter_ai.seed.prompt,starter.prompt)
  assert.equal((await i.assistantsOf(token,first.id))[0].prompt,'Answer in the owner\'s own words.')
  ok(await call(`/api/management/projects/${first.id}/ais/${starter.id}`,{method:'PUT',body:{model:'gpt-5-mini'},token}))
  ok(await call(`/api/management/projects/${first.id}/ai`,{method:'PUT',body:{default_visitor_ai_id:starter.id},token}))
  const {setupObservation}=await import('./setup-observation.mjs')
  await setupObservation(i,{id:first.id,origin})
}

// With a key and mail, a registered workspace answers visitors by itself within the daily ceiling.
async function keyedRegistration(i){
 const {app,call,log}=i
  // Each sign-up mails its own verification link.
  const register=async(email,projectName,allowedOrigin)=>{
   const mails=log.length
   ok(await call('/api/identity/register',{body:{email,name:'Rae',password:'synthetic-registered-owner-password-123',projectName,allowedOrigin}}),202)
   const mail=await app.until(()=>log.slice(mails).find(entry=>entry.provider==='resend'&&entry.to.includes(email)),{message:'verification mail'})
   return new URL(mail.text.match(/https:\S+/)[0]).searchParams.get('token')
  }
  const totals=async()=>Object.fromEntries(await Promise.all(['projects','ai_profiles','email_settings','project_settings'].map(async table=>[table,(await app.first(`SELECT count(*) n FROM ${table}`)).n])))
  // A creation that fails leaves nothing behind: two pending sign-ups for one email, and the second verification fails.
  const firstToken=await register('rae@bakery.example','Rae Bakes','https://rae-bakes.example')
  const secondToken=await register('rae@bakery.example','Rae Bakes again','https://rae-bakes.example')
  assert.notEqual(secondToken,firstToken)
  const verified=ok(await call('/api/identity/verify-email',{body:{token:firstToken}})),before=await totals()
  assert.equal((await call('/api/identity/verify-email',{body:{token:secondToken}})).status,500)
  assert.equal((await call('/api/identity/verify-email',{body:{token:firstToken}})).status,400)
  assert.deepEqual(await totals(),before,'a failed or repeated creation provisions nothing')
  const token=ok(await call('/api/identity/login',{body:{email:'rae@bakery.example',password:'synthetic-registered-owner-password-123'}})).token,projectId=verified.projectId,origin='https://rae-bakes.example'
  const {starter}=await i.assertStarter(token,projectId)
  const readiness=ok(await call(`/api/management/projects/${projectId}/ai`,{token})).data
  assert.equal(readiness.ready,true);assert.equal(readiness.secretName,'OPENAI_API_KEY','the starter uses the provider whose key is installed')
  const mailbox=await i.mailboxOf(token,projectId)
  assert.equal(mailbox.email_to_address,'rae-bakes@replies.app.example');assert.equal(mailbox.is_enabled,1,'enabled because this installation sends mail')
  // Mail goes out from the installation sender until the workspace's own domain is verified.
  assert.equal(mailbox.from_address,'hello@app.example');assert.equal((await i.settingsOf(token,projectId)).proposed_sender,'support@rae-bakes.example')
  // A later same-name workspace of the same owner gets its own enabled mailbox.
  const twin=await i.newWorkspace(token,'Rae Bakes',origin),twinMailbox=await i.mailboxOf(token,twin.id)
  assert.notEqual(twinMailbox.email_to_address,mailbox.email_to_address);assert.equal(twinMailbox.is_enabled,1);assert.equal(twinMailbox.from_address,'hello@app.example')
  await i.assertStarter(token,twin.id)
  // The starter takes the visitor's conversation and answers it by itself.
  const chat=await i.visitor(token,projectId,origin),asked=await chat.say('Do you deliver on Sundays?');assert.equal(asked.generationError,undefined)
  const answered=await app.until(async()=>ok(await call(`/api/conversations/${chat.conversation.id}/messages`,{token:chat.session.token,origin})).messages.find(message=>message.actor_role==='ai'),{timeout:15000,message:'the starter reply'})
  assert.match(answered.content,/returns are free/)
  assert.equal((await app.first("SELECT ai_id FROM ai_generations WHERE conversation_id=? AND state='completed'",chat.conversation.id)).ai_id,starter.id)
  // The daily ceiling holds: the next automatic reply is skipped and recorded, never sent to the provider.
  const providerCalls=log.filter(entry=>entry.provider==='openai').length
  const again=await chat.say('And on holidays?');assert.equal(again.generationError,undefined)
  const skipped=await app.until(()=>app.first("SELECT state,error FROM ai_generations WHERE conversation_id=? AND state='failed'",chat.conversation.id),{timeout:15000,message:'the ceiling decision'})
  assert.match(skipped.error,/^AI_REPLY_CEILING: .*repliesPerProject/)
  await new Promise(resolve=>setTimeout(resolve,500));assert.equal(log.filter(entry=>entry.provider==='openai').length,providerCalls)
}

// The installed provider chooses the starter model; no inbound token seeds no mailbox; demo inboxes are never provisioned.
// The workspace's spend is reported from persisted receipts, scoped to it and its day, known apart from unknown.
async function installedProvider(i){
 const {app,call}=i
  const token=i.owner.token,workspace=await i.newWorkspace(token,'Northwind','https://northwind.example'),{starter}=await i.assertStarter(token,workspace.id)
  const readiness=ok(await call(`/api/management/projects/${workspace.id}/ai`,{token})).data
  assert.deepEqual([readiness.ready,readiness.secretName],[true,'ANTHROPIC_API_KEY'])
  assert.equal((await i.mailboxOf(token,workspace.id)).email_to_address,null)
  assert.equal((await i.settingsOf(token,workspace.id)).proposed_sender,'support@northwind.example','proposed without a mailbox')
  const demo=ok(await call('/api/dashboard/demo-inbox',{body:{},token}),201),demoSettings=await i.settingsOf(token,demo.id)
  assert.equal(demoSettings.is_demo,true);assert.equal('starter_ai' in demoSettings,false);assert.equal('proposed_sender' in demoSettings,false)
  assert.ok((await i.assistantsOf(token,demo.id)).every(assistant=>assistant.prompt!==starter.prompt),'no starter in a demo inbox')
  assert.equal((await i.mailboxOf(token,demo.id)).email_to_address,null)
  await spend(i)
}

async function spend(i){
 const {app,call,log}=i,owner=i.owner,endpoint=`/api/dashboard/projects/${owner.projectId}/ai-spend`,outbound=log.length
 assert.equal((await call(endpoint)).status,401)
 const read=async(token=owner.token)=>{const response=await call(endpoint,{token});assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');return response.data.data}
 const empty=await read();assert.equal(empty.spend.state,'empty');assert.equal(empty.spend.knownUsd,null)
 assert.equal(empty.resetsAt,new Date(Date.parse(empty.day+'T00:00:00Z')+86400000).toISOString())
 const other=ok(await call('/api/management/projects',{body:{name:'Other',allowed_origin:'https://other.example'},token:owner.token}),201)
 assert.equal((await call(`/api/dashboard/projects/${other.id}/ai-spend`,{token:owner.token})).status,403)
 // Receipts as the provider edge recorded them: exact costs, an estimate, an unknown cost.
 const now=new Date().toISOString()
 const seed=async(id,project,usage,when=now)=>app.db.batch([
  app.db.prepare("INSERT INTO ai_generations(id,project_id,conversation_id,state,source_revision,actor_json,model,ai_id,ai_profile_json,created_at,updated_at) VALUES(?,?,?,'completed',0,?,'model','ai','{}',?,?)").bind(id,project,'conversation',JSON.stringify({role:'operator'}),when,when),
  app.db.prepare("INSERT INTO ai_attempts(id,generation_id,state,started_at) VALUES(?,?,'completed',?)").bind(id+'-a',id,when),
  app.db.prepare('INSERT INTO ai_round_usage(attempt_id,request_id,usage_json,observed) VALUES(?,?,?,1)').bind(id+'-a','provider-request',JSON.stringify(usage)),
 ])
 const cost=value=>({cost:value,metadata:{source:'xai',provider_cost_ticks:typeof value==='number'?value*1e10:undefined}})
 await seed('zero',owner.projectId,cost(0));assert.equal((await read()).spend.knownUsd,0,'a known zero is known')
 await seed('paid',owner.projectId,cost(.025));await seed('foreign',other.id,cost(800))
 await seed('yesterday',owner.projectId,cost(500),new Date(Date.parse(empty.day+'T00:00:00Z')-1).toISOString())
 assert.equal((await read()).spend.knownUsd,.025,'only this workspace and this day count')
 await app.db.prepare("UPDATE ai_round_usage SET usage_json=? WHERE attempt_id='paid-a' AND request_id='provider-request'").bind(JSON.stringify(cost(.03))).run()
 const updated=await read();assert.equal(updated.spend.knownUsd,.03);assert.equal(updated.spend.rounds,2)
 // An estimate or an unknown cost makes the total partial, never a guessed amount.
 await seed('estimate',owner.projectId,{cost:1,metadata:{source:'xai',provider_cost_ticks:1e10,estimated_cost:true}});await seed('unknown',owner.projectId,cost(null))
 const partial=(await read()).spend;assert.equal(partial.state,'partial');assert.equal(partial.knownUsd,.03)
 const stored=await app.sql('SELECT * FROM ai_round_usage ORDER BY attempt_id,request_id');await read();await read()
 assert.deepEqual(await app.sql('SELECT * FROM ai_round_usage ORDER BY attempt_id,request_id'),stored,'reading spend writes nothing')
 // Ceilings reached are reported as such, without the installation-wide count.
 const start=Math.floor(Date.now()/86400000)*86400000
 for(const [name,key,count] of [['ai:replies-per-project',owner.projectId,2],['ai:replies-per-installation','installation',3],['ai:reply-spend-micro-usd',owner.projectId,1000000],['ai:reply-ceiling-skips',owner.projectId,4],['ai:context-runs-per-project',owner.projectId,2]])
  await app.db.prepare('INSERT INTO abuse_counters(key,window_start,used,expires_at) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET window_start=excluded.window_start,used=excluded.used,expires_at=excluded.expires_at').bind(name+':'+createHash('sha256').update(key).digest('hex'),start,count,start+86400000).run()
 const blocked=await read()
 assert.equal(blocked.automatic.replyCeilingReached,true);assert.equal(blocked.automatic.installationCeilingReached,true);assert.equal(blocked.automatic.skippedReplies,4);assert.equal(blocked.contextRuns.ceilingReached,true)
 assert.equal('installationUsed' in blocked.automatic,false)
 // A visitor cannot read it; an owner whose membership was removed is signed out of it.
 const project=ok(await call('/api/identity/projects/'+owner.projectId,{token:owner.token}))
 const visitor=ok(await call('/api/identity/widget/session',{body:{widgetKey:project.widget_key},origin:'https://owner.example'}),201)
 assert.equal((await call(endpoint,{token:visitor.token})).status,403)
 await app.db.prepare('DELETE FROM memberships WHERE project_id=? AND user_id=?').bind(owner.projectId,owner.userId).run()
 assert.equal((await call(endpoint,{token:owner.token})).status,401)
 assert.deepEqual(log.slice(outbound).filter(entry=>entry.provider),[],'spend makes no provider request (a new workspace only looks up its website)')
}

// A local install seeds its mailbox on localhost.test, sends from the installation sender and still records the proposed sender.
async function localInstall(i){
 const {call}=i
  const token=i.owner.token,workspace=await i.newWorkspace(token,'Northstar Outfitters','https://www.northstar.example')
  await i.assertStarter(token,workspace.id)
  const mailbox=await i.mailboxOf(token,workspace.id)
  assert.equal(mailbox.email_to_address,'northstar-outfitters@localhost.test')
  assert.equal(mailbox.is_enabled,1,'local mail is validated and suppressed, so the mailbox remains available')
  assert.equal(mailbox.from_address,'owner-mail@localhost.test')
  assert.equal((await i.settingsOf(token,workspace.id)).proposed_sender,'support@northstar.example')
}
