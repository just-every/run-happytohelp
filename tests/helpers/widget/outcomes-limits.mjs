import assert from 'node:assert/strict'
import {createHmac} from 'node:crypto'

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
