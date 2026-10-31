import assert from 'node:assert/strict'
import {createHmac} from 'node:crypto'
import {evidence,viewports} from '../../journeys/kit/browser.mjs'

export async function campaignOutcomes(f){
 const {app,p,owner,settings,open,transcript}=f
 const shot=await evidence('widget-outcomes')
 const proof=async(page,name)=>{
  await page.screenshot({path:shot(name+'-1440.png'),fullPage:true})
  await page.setViewportSize(viewports.mobile);await page.screenshot({path:shot(name+'-390.png'),fullPage:true});await page.setViewportSize(viewports.desktop)
 }
 const report=async()=>(await app.ok(`/api/dashboard/projects/${p}/reports?period=30`,{token:owner})).campaigns.find(r=>r.id==='browser-checkout')
 const noRequest=async v=>{
  assert.equal((await transcript(v)).messages.length,0,'a proactive offer never sends a visitor message')
  const all=await app.ok('/api/conversations',{token:v.token,headers:f.headers})
  assert.equal(all.conversations.length,1,'no campaign-created extra conversation')
 }
 const localDecline=await open({collector:false})
 try{
  await localDecline.page.getByRole('button',{name:'Allow proactive help',exact:true}).click()
  const v=await localDecline.session();await localDecline.page.evaluate(()=>window.h2h('close'))
  await localDecline.page.waitForTimeout(21000)
  assert.equal(await localDecline.page.getByRole('region',{name:'Help before you ask'}).count(),0,'an installation collector refusal wins over workspace and visitor consent')
  assert.equal(localDecline.requests.filter(r=>r.action==='campaignEvaluate'||r.action==='collector').length,0)
  await noRequest(v)
  await localDecline.page.evaluate(()=>window.h2h('settings',{settings:{collector:{enabled:true}}}))
  const card=localDecline.page.getByRole('region',{name:'Help before you ask'});await card.waitFor()
  await localDecline.page.evaluate(()=>window.h2h('settings',{settings:{collector:{enabled:false}}}))
  await card.waitFor({state:'hidden'})
  await localDecline.page.evaluate(()=>window.h2h('open'));await proof(localDecline.page,'collector-declined')
  await f.event(v,'contextConsent',{consent:false})
 }finally{await localDecline.close()}
 const ui=await open({collector:true})
 try{
  await ui.page.getByRole('button',{name:'Allow proactive help',exact:true}).click()
  const v=await ui.session()
  await ui.page.evaluate(()=>window.h2h('close'))
  const offer=ui.page.getByRole('region',{name:'Help before you ask'})
  assert.equal(await offer.count(),0)
  await offer.waitFor({timeout:30000})
  const evaluations=ui.requests.filter(r=>r.action==='campaignEvaluate')
  assert.ok(evaluations.length);assert.ok(evaluations.every(r=>r.data.elapsedSeconds>=20),'installed widget does not evaluate before twenty seconds')
  assert.equal(await offer.locator('strong').textContent(),'Morgan from Support')
  await offer.getByText('Checkout Care',{exact:true}).waitFor()
  await offer.getByText('Need a hand finishing your order?',{exact:true}).waitFor()
  await noRequest(v)
  await proof(ui.page,'checkout-offer')
  await offer.getByRole('button',{name:'Dismiss',exact:true}).click();await offer.waitFor({state:'hidden'})
  await app.until(async()=>(await report()).dismissals===1,{message:'dismiss report'})
  await ui.reload();await ui.session();await ui.page.evaluate(()=>window.h2h('close'))
  const count=ui.requests.filter(r=>r.action==='campaignEvaluate').length
  await app.until(()=>ui.requests.filter(r=>r.action==='campaignEvaluate').length>count,{timeout:35000,message:'reload cap evaluation'})
  assert.equal(await offer.count(),0,'dismissed daily offer stays absent after reload')
  await noRequest(v)
  assert.deepEqual(ui.errors,[])
 }finally{await ui.close()}
 // A different consenting visitor opens the same message; only their deliberate
 // send counts as a resulting conversation, and native resolution reaches Reports.
 const next=await open({collector:true})
 try{
  await next.page.getByRole('button',{name:'Allow proactive help',exact:true}).click()
  const v=await next.session();await next.page.evaluate(()=>window.h2h('close'))
  const offer=next.page.getByRole('region',{name:'Help before you ask'})
  await offer.waitFor({timeout:30000});await offer.getByRole('button',{name:'Open chat',exact:true}).click()
  await next.page.locator('textarea[name=content]').waitFor()
  assert.equal(await next.page.locator('textarea[name=content]').inputValue(),'','open is an empty composer')
  await noRequest(v)
  await app.until(async()=>(await report()).opens===1,{message:'open report'})
  assert.equal((await report()).conversations,0)
  await next.page.locator('textarea[name=content]').fill('Please help with this order.');await next.page.locator('button[name=submit]').click()
  await app.until(async()=>(await report()).conversations===1,{message:'real visitor conversation attribution'})
  await app.ok(`/api/dashboard/projects/${p}/conversations/${v.conversationId}`,{token:owner,method:'PUT',body:{resolved:true}})
  const row=await report()
  assert.deepEqual({impressions:row.impressions,opens:row.opens,dismissals:row.dismissals,conversations:row.conversations,resolutions:row.resolutions},{impressions:2,opens:1,dismissals:1,conversations:1,resolutions:1})
  assert.deepEqual(next.errors,[])
 }finally{await next.close()}
 const declined=await open({collector:true})
 try{
  await declined.page.getByRole('button',{name:'No thanks',exact:true}).click()
  const v=await declined.session();await declined.page.evaluate(()=>window.h2h('close'))
  await declined.page.waitForTimeout(21000)
  assert.equal(await declined.page.getByRole('region',{name:'Help before you ask'}).count(),0)
  assert.equal(declined.requests.filter(r=>r.action==='campaignEvaluate'||r.action==='collector').length,0,'declined consent sends no campaign or collection data')
  await noRequest(v)
 }finally{await declined.close()}
 await settings({is_contact_tracking_enabled:false})
 const disabled=await open({collector:false})
 try{
  const v=await disabled.session();await disabled.page.evaluate(()=>window.h2h('close'))
  await disabled.page.waitForTimeout(21000)
  assert.equal(await disabled.page.getByRole('region',{name:'Help before you ask'}).count(),0)
  assert.equal(disabled.requests.filter(r=>r.action==='campaignEvaluate'||r.action==='collector').length,0)
  await noRequest(v)
 }finally{await disabled.close()}
 const awaiting=await open({consent:false})
 try{
  await awaiting.page.evaluate(()=>window.h2h('consent',{provided:false}))
  assert.equal(await awaiting.page.locator('#happytohelp').count(),0)
  assert.deepEqual(awaiting.apiRequests,[],'declined installation consent sends no visitor data to the API')
  assert.equal(await awaiting.page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('rer-widget:')).length),0,'declined installation consent creates no visitor identity')
 }finally{await awaiting.close()}
}

export const campaign={name:'Checkout help',enabled:true,sender:'Morgan from Support',brand:'Checkout Care',message:'Need a hand finishing your order?',pathPrefix:'/checkout',trigger:{type:'time',seconds:20},audience:'all',delaySeconds:20,dailyCap:1,timezone:'UTC',quietHours:{enabled:false,start:20,end:8}}

export async function campaignLimits(f){
 const {app,w,p,owner,manage,headers,settings,event,transcript}=f
 const endpoint=manage+'/widget-campaigns'
 const secret=(await app.ok(manage+'/widget-settings',{token:owner})).verificationSecret
 await settings({is_contact_tracking_enabled:true,proactive_help_enabled:true})
 const visitor=async(metadata={})=>{
  const v=await app.ok('/api/identity/widget/session',{headers,body:{widgetKey:w.widgetKey,metadata:{...metadata,hash:createHmac('sha256',secret).update(JSON.stringify(metadata)).digest('hex')}}})
  const c=await app.ok('/api/conversations',{token:v.token,body:{projectId:p}})
  return {...v,conversationId:c.id}
 }
 const save=(id,body,revision=0)=>app.ok(endpoint+'/'+id,{token:owner,method:'PUT',body:{...body,revision}})
 const visit=(path,extra={})=>({path,elapsedSeconds:20,scrollPercent:0,exitIntent:false,visitId:crypto.randomUUID(),...extra})
 const evaluate=(v,context)=>event(v,'campaignEvaluate',context)
 const v=await visitor(),checkout=visit('/checkout')
 const saved=await save('checkout',campaign)
 assert.equal((await app.call(endpoint+'/checkout',{token:w.tokens.operator,method:'PUT',body:{...campaign,revision:saved.revision}})).status,403)
 assert.equal((await app.call(endpoint+'/checkout',{token:owner,method:'PUT',body:{...campaign,revision:0}})).status,409,'stale edit cannot replace a campaign')
 assert.equal((await evaluate(v,checkout)).offer,null,'consent is required')
 await event(v,'contextConsent',{consent:true})
 await settings({is_contact_tracking_enabled:false})
 assert.equal((await evaluate(v,checkout)).offer,null,'workspace collector refusal wins over visitor consent')
 await settings({is_contact_tracking_enabled:true,proactive_help_enabled:false})
 assert.equal((await evaluate(v,checkout)).offer,null,'proactive policy refusal stays silent')
 await settings({proactive_help_enabled:true})
 assert.equal((await evaluate(v,visit('/account'))).offer,null,'URL must match')
 assert.equal((await evaluate(v,{...checkout,elapsedSeconds:19.999})).offer,null,'twenty seconds is a real boundary')
 const before=await transcript(v),conversations=await app.sql('SELECT id FROM conversations WHERE contact_id=?',v.contactId)
 const offers=(await Promise.all([evaluate(v,checkout),evaluate(v,checkout)])).map(r=>r.offer).filter(Boolean)
 assert.equal(offers.length,1,'concurrent tabs reserve only one daily slot')
 assert.deepEqual({sender:offers[0].sender,brand:offers[0].brand,message:offers[0].message},{sender:campaign.sender,brand:campaign.brand,message:campaign.message})
 for(const action of ['show','show','dismiss','dismiss','open','open'])await event(v,'campaignEvent',{id:offers[0].id,event:action})
 assert.deepEqual(await transcript(v),before,'offers never post on behalf of a visitor')
 assert.deepEqual(await app.sql('SELECT id FROM conversations WHERE contact_id=?',v.contactId),conversations,'offers never create an additional conversation')
 assert.equal((await evaluate(v,visit('/checkout'))).offer,null,'new visit/reload is capped')
 await app.configure({})
 assert.equal((await evaluate(v,visit('/checkout'))).offer,null,'cap survives a Worker restart')
 // Historical state is aged at rest, as the preceding UTC day. Re-enter the
 // same public command after restarting; today's cap must not count yesterday.
 const yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10)
 await app.db.prepare('UPDATE widget_campaign_impressions SET day=? WHERE contact_id=?').bind(yesterday,v.contactId).run()
 await app.configure({})
 assert.ok((await evaluate(v,visit('/checkout'))).offer,'a retained prior-day slot does not consume the new day')
 assert.equal((await evaluate(v,visit('/checkout'))).offer,null,'the new day is capped independently')
 await save('checkout',{...campaign,enabled:false},saved.revision)
 // Every configured trigger has both a refused and accepted public evaluation.
 const cases=[['page',{type:'page'},{path:'/wrong'},{}],['time',{type:'time',seconds:20},{elapsedSeconds:19},{elapsedSeconds:20}],['scroll',{type:'scroll',percent:70},{scrollPercent:69},{scrollPercent:70}],['exit',{type:'exit'},{exitIntent:false},{exitIntent:true}],['attribute',{type:'attribute',key:'tier',value:'gold'},null,{}],['returning',{type:'returning'},null,{}],['cart',{type:'cart',minimum:100},{cartValue:99},{cartValue:100}]]
 for(const [name,trigger,miss,hit] of cases){
  const path='/limits/'+name,who=await visitor({tier:'gold'}),context=visit(path),id='trigger-'+name
  await event(who,'contextConsent',{consent:true})
  await save(id,{...campaign,pathPrefix:path,trigger,delaySeconds:0})
  if(name==='attribute'){
   assert.equal((await evaluate(v,context)).offer,null,'nonmatching visitor attribute')
  }else if(name==='returning'){
   assert.equal((await evaluate(who,context)).offer,null,'first visit is not returning')
  }else assert.equal((await evaluate(who,{...context,...miss})).offer,null,name+' lower boundary refuses')
  assert.ok((await evaluate(who,{...context,...hit,...(name==='returning'?{visitId:crypto.randomUUID()}:{})})).offer,name+' trigger offers')
 }
 for(const audience of ['new','returning']){
  const who=await visitor(),path='/audience/'+audience,id='audience-'+audience
  await event(who,'contextConsent',{consent:true})
  await save(id,{...campaign,pathPrefix:path,trigger:{type:'page'},delaySeconds:0,audience})
  const first=await evaluate(who,visit(path))
  assert.equal(Boolean(first.offer),audience==='new','first visit audience')
  const second=await evaluate(who,visit(path))
  assert.equal(Boolean(second.offer),audience==='returning','returning visit audience')
 }
 const quiet=await visitor();await event(quiet,'contextConsent',{consent:true})
 const hour=new Date().getUTCHours(),quietConfig={...campaign,pathPrefix:'/quiet',trigger:{type:'page'},delaySeconds:0,quietHours:{enabled:true,start:hour,end:(hour+1)%24}}
 const q=await save('quiet',quietConfig)
 assert.equal((await evaluate(quiet,visit('/quiet'))).offer,null,'current hour is quiet even across midnight')
 await save('quiet',{...quietConfig,quietHours:{enabled:true,start:(hour+2)%24,end:(hour+3)%24}},q.revision)
 assert.ok((await evaluate(quiet,visit('/quiet'))).offer,'outside quiet hours offers')
 const other=await app.seedWorkspace('campaign-other',{allowedOrigin:w.allowedOrigin})
 await app.ok(`/api/management/projects/${other.projectId}/widget-campaigns/foreign`,{token:other.tokens.owner,method:'PUT',body:{...campaign,pathPrefix:'/foreign',trigger:{type:'page'},delaySeconds:0,revision:0}})
 const foreign=await visitor();await event(foreign,'contextConsent',{consent:true})
 assert.equal((await evaluate(foreign,visit('/foreign'))).offer,null,'other brands never leak their offers')
 assert.equal((await app.call(endpoint,{token:other.tokens.owner})).status,403)
 // Isolate the installed checkout flow from the earlier trigger fixtures.
 for(const {id,revision,...config} of (await app.ok(endpoint,{token:owner})).campaigns)if(config.enabled)await save(id,{...config,enabled:false},revision)
 await save('browser-checkout',campaign)
}
