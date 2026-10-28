import {managedFirstRunJourney} from './managed-mail.mjs'
import {managedReadOnlyJourney} from './managed-mail-observation.mjs'
import assert from 'node:assert/strict'
import {startApp} from '../../journeys/kit/app.mjs'
import {openaiStream} from '../openai-stream.mjs'
import {demoOnboarding} from './demo.mjs'

// One installation moves from a local first owner to configured support. Only
// model metadata/completion, mail acceptance/status and the website are edges.
export async function provisioningJourney(){
 const mail=[],modelCalls=[],state={delivered:false,uncertain:false,modelStatus:200}
 const app=await startApp({origin:'http://127.0.0.1:8787',captureQueue:true,bindings:{H2H_LOCAL:'true',H2H_SETUP_TOKEN:'synthetic-happytohelp-1',APP_ORIGIN:'http://127.0.0.1:8787',EMAIL_FROM:'support@local.test',EMAIL_PROVIDER:'development',INBOUND_EMAIL_TOKEN:'synthetic-happytohelp-2'},outbound:async(request)=>{
  const url=new URL(request.url)
  if(url.hostname==='api.openai.com'){
   if(url.pathname.startsWith('/v1/models/'))return Response.json(state.modelStatus===200?{id:decodeURIComponent(url.pathname.split('/').at(-1)),object:'model'}:{error:'Rejected model credential'},{status:state.modelStatus})
   modelCalls.push(await request.json());return openaiStream('Returns are free within 30 days.',{input_tokens:5,output_tokens:9})
  }
  if(url.hostname==='api.resend.com'){
   if(request.method==='POST'){mail.push(await request.json());if(state.uncertain)throw new Error('Connection lost after mail acceptance');return Response.json({id:'mail-'+mail.length})}
   if(url.pathname==='/domains')return Response.json({data:[],has_more:false})
   const sent=mail[Number(url.pathname.split('-').at(-1))-1]
   assert.ok(sent,'status is read only for an accepted message')
   return Response.json({id:url.pathname.split('/').at(-1),to:sent.to,from:sent.from,last_event:state.delivered?'delivered':'sent'})
  }
  if(url.hostname==='cloudflare-dns.com')return Response.json({Status:0,Answer:[{type:1,data:'93.184.216.34'}]})
  if(url.hostname==='owner.example'){if(url.pathname==='/robots.txt')return new Response('User-agent: *\nAllow: /');return new Response('<html><head><title>Returns help</title></head><body><main><h1>Returns help</h1><a href="/help/returns">Returns guide</a><p>Returnmarker: returns are free within 30 days. Start a return from your order history and print the prepaid label. Pack the tent with its original accessories, attach the label to the parcel, and take it to your nearest collection point. Our support team can help locate your order and track the refund after the parcel arrives.</p></main></body></html>',{headers:{'Content-Type':'text/html'}})}
  throw new Error('Unexpected first-run provider '+url.hostname)
 }})
 try{
  const owner=(await app.call('/api/identity/bootstrap',{body:{name:'Returns desk',email:'owner@owner.example',password:'synthetic-happytohelp-6',allowedOrigin:'https://owner.example',setupToken:'synthetic-happytohelp-1'},status:201})).data
  const p=owner.projectId,token=owner.token,manage=`/api/management/projects/${p}`
  const get=async suffix=>(await app.call(manage+suffix,{token,status:200})).data.data
  const setup=async(suffix='',body)=>getSetup(suffix,body)
  const getSetup=async(suffix='',body)=>(await app.call(manage+'/activation'+suffix,{token,body,status:200})).data.data
  const row=(data,id)=>data.steps.find(item=>item.id===id)
  const settings=await get('/settings'),assistants=await get('/ais'),mailbox=await get('/email-settings')
  assert.equal(assistants.length,1);const starter=assistants[0]
  assert.ok(starter.is_enabled);assert.equal(settings.default_visitor_ai_id,starter.id);assert.equal(settings.default_responder,starter.id)
  assert.ok(mailbox.inbound_address,'the workspace has a provisioned mailbox; local transport suppression is checked through sends below')
  assert.equal((await get('/ai')).ready,false)
  const before=app.requests.length,fresh=await setup()
  assert.ok(fresh.steps.every(item=>item.state==='not_checked'));assert.equal(app.requests.length,before,'Setup GET has no provider effects')
  assert.equal(row(await setup('/test-mail',{}),'owner_mail').state,'pending');assert.equal(mail.length,0,'local mail is suppressed')
  const publicRead=await app.call(manage+'/activation');assert.equal(publicRead.status,401)
  const other=await app.seedWorkspace('first-run-other')
  await demoOnboarding(app,owner,other)
  assert.equal((await get('/settings')).default_visitor_ai_id,starter.id)
  const skipped=await setup('/skip',{step:'widget_seen',skipped:true})
  assert.equal(row(skipped,'widget_seen').state,'not_checked');assert.equal(row(skipped,'widget_seen').placement,'skipped')
  assert.equal(row(await setup('/skip',{step:'widget_seen',skipped:false}),'widget_seen').placement,'needs_you')
  assert.equal((await app.call(manage+'/activation/check',{token:other.tokens.owner,body:{}})).status,403)

  const second=(await app.call('/api/management/projects',{token,body:{name:'Wholesale support',allowed_origin:'https://wholesale.example'},status:201})).data
  const secondSettings=(await app.call(`/api/management/projects/${second.id}/settings`,{token,status:200})).data.data
  assert.ok(secondSettings.default_visitor_ai_id);assert.notEqual(secondSettings.default_visitor_ai_id,starter.id)
  assert.equal((await app.call(`/api/management/projects/${second.id}/activation`,{token,status:200})).data.data.done,0)
  const session=(await app.call('/api/identity/widget/session',{body:{widgetKey:(await app.first('SELECT widget_key FROM projects WHERE id=?',p)).widget_key,email:'customer@owner.example'},headers:{Origin:'https://owner.example'},status:201})).data
  const conversation=(await app.call('/api/conversations',{token:session.token,body:{projectId:p},status:201})).data
  const transcript=async()=>(await app.call(`/api/conversations/${conversation.id}/messages`,{token:session.token,status:200})).data
  const say=async content=>{const current=await transcript();return (await app.call(`/api/conversations/${conversation.id}/messages`,{token:session.token,body:{localId:crypto.randomUUID(),content,expectedRevision:current.revision,expectedLastMessageId:current.lastMessageId},status:200})).data}
  await say('Can I return my tent?');await app.drainJobs()
  assert.equal((await get('/settings')).site_read.state,'done')
  const source=(await app.call(`/api/knowledge/${p}/search?q=Returnmarker`,{token,status:200})).data.citations;assert.ok(source.some(item=>item.url==='https://owner.example/help/returns'))
  const localHead=await transcript();await app.call(`/api/conversations/${conversation.id}/messages`,{token,body:{localId:'local-owner-reply',content:'A local teammate reply',expectedRevision:localHead.revision,expectedLastMessageId:localHead.lastMessageId},status:200})
  await app.scheduled(undefined,{after:61000})
  assert.equal((await app.first('SELECT count(*) n FROM email_deliveries')).n,0,'development sends store no delivery records')
  assert.equal(modelCalls.length,0);assert.equal((await transcript()).messages.filter(item=>item.actor_role==='ai').length,0)

  // The owner installs a provider and turns on the actual mailbox. Prior local
  // observations do not become hosted delivery receipts.
  await app.configure({H2H_LOCAL:undefined,APP_ORIGIN:'https://app.example',OPENAI_API_KEY:'synthetic-happytohelp-3',EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'synthetic-happytohelp-4',EMAIL_FROM:'support@example.test',AI_DAILY_CEILINGS:JSON.stringify({repliesPerProject:1})})
  await app.call(manage+'/email-settings',{token,method:'PUT',body:{from_name:'Returns desk',from_address:'support@example.test',inbound_address:'help@example.test',is_enabled:true},status:200})
  assert.equal((await get('/ai')).ready,true)
  assert.equal(row(await setup('/check',{step:'model_key'}),'model_key').state,'done')
  state.modelStatus=401;assert.equal(row(await setup('/check',{step:'model_key'}),'model_key').state,'failed');state.modelStatus=200
  assert.equal(row(await setup('/check',{step:'model_key'}),'model_key').state,'done')
  await app.db.prepare("UPDATE activation_receipts SET checked_at=? WHERE project_id=? AND step_id='model_key'").bind(Date.now()-16*60*1000,p).run()
  const pureRead=app.requests.length;assert.equal(row(await setup(),'model_key').state,'unknown');assert.equal(app.requests.length,pureRead)
  const checked=app.requests.length;await setup('/check',{auto:true});const settled=app.requests.length;await setup('/check',{auto:true});assert.equal(app.requests.length,settled,'fresh automatic checks repeat no provider work');assert.ok(settled>=checked)
  const waiting=await setup('/test-mail',{})
  assert.equal(row(waiting,'owner_mail').state,'pending');assert.equal(mail.length,1)
  await setup('/test-mail',{});assert.equal(mail.length,1)
  state.delivered=true;assert.equal(row(await setup('/check',{step:'owner_mail'}),'owner_mail').state,'done')
  assert.equal(row(await setup('/check',{step:'inbound_address'}),'inbound_address').state,'pending')
  await app.call('/api/integrations/email/inbound',{token:'synthetic-happytohelp-2',body:{messageId:'first-run-check',to:'help@example.test',from:'customer@example.test',subject:'First support email',text:'Please check my return.',headers:{'Auto-Submitted':'auto-generated'}},status:201})
  assert.equal(row(await setup('/check',{step:'inbound_address'}),'inbound_address').state,'done')
  await app.call(`/api/conversations/${conversation.id}/widget-events`,{token:session.token,headers:{Origin:'https://owner.example'},body:{action:'pingActive',data:{opened:true}},status:200})
  assert.equal(row(await setup('/check',{step:'widget_seen'}),'widget_seen').state,'done')

  // A fresh visitor is answered by the provisioned assistant. A second turn
  // stays durable when the configured daily allowance is consumed.
  const next=(await app.call('/api/identity/widget/session',{body:{widgetKey:(await app.first('SELECT widget_key FROM projects WHERE id=?',p)).widget_key},headers:{Origin:'https://owner.example'},status:201})).data
  const chat=(await app.call('/api/conversations',{token:next.token,body:{projectId:p},status:201})).data
  const read=async()=>(await app.call(`/api/conversations/${chat.id}/messages`,{token:next.token,status:200})).data
  const post=async content=>{const current=await read();return app.call(`/api/conversations/${chat.id}/messages`,{token:next.token,body:{localId:crypto.randomUUID(),content,expectedRevision:current.revision,expectedLastMessageId:current.lastMessageId},status:200})}
  await post('What is the return period?');await app.drainJobs()
  assert.equal((await read()).messages.filter(item=>item.actor_role==='ai').length,1);assert.equal(modelCalls.length,1)
  await post('Does that include holidays?');const jobs=await app.takeJobs();await app.runJobs(jobs);await app.runJobs(jobs)
  assert.equal(modelCalls.length,1)
  assert.ok((await read()).messages.some(item=>item.content==='Does that include holidays?'))
  assert.match((await app.first("SELECT error FROM ai_generations WHERE conversation_id=? AND state='failed'",chat.id)).error,/AI_REPLY_CEILING/)
  const spend=(await app.call(`/api/dashboard/projects/${p}/ai-spend`,{token,status:200})).data.data
  assert.equal(spend.automatic.replyCeilingReached,true);assert.equal(spend.spend.knownUsd,null,'unpriced provider usage is unknown')
  assert.equal((await app.call(`/api/dashboard/projects/${p}/ai-spend`,{token:next.token})).status,403)

  state.uncertain=true;await app.configure({EMAIL_API_KEY:'synthetic-happytohelp-7'})
  assert.equal(row(await setup('/test-mail',{}),'owner_mail').state,'unknown')
  const sent=mail.length;await setup('/test-mail',{});await setup('/check',{step:'owner_mail'});assert.equal(mail.length,sent,'uncertain welcome work never resends')
  // The configuration's real origin, rather than a stale receipt, governs access.
  await app.db.prepare('UPDATE projects SET allowed_origin=? WHERE id=?').bind('https://changed.example',p).run()
  assert.equal(row(await setup(),'widget_seen').state,'unknown')
 }finally{await app.close()}
 await managedFirstRunJourney();await managedReadOnlyJourney()
}
