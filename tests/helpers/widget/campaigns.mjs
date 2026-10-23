import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {startApp} from '../../journeys/kit/app.mjs'

// Configurable offers through the same public widget command door; no provider fake or message fixture.
export async function campaignsJourney(){
 const app=await startApp()
 try{
  const w=await app.seedWorkspace('campaigns'),other=await app.seedWorkspace('campaigns-other'),p=w.projectId,owner=w.tokens.owner
  const endpoint=`/api/management/projects/${p}/widget-campaigns`
  const visitor=await app.ok('/api/identity/widget/session',{body:{widgetKey:w.widgetKey},headers:{Origin:w.allowedOrigin}})
  const conversation=await app.ok('/api/conversations',{token:visitor.token,body:{projectId:p}})
  const command=(action,data={},status=200,token=visitor.token,id=conversation.id)=>app.call(`/api/conversations/${id}/widget-events`,{token,body:{action,data},status})
  const context={path:'/checkout',elapsedSeconds:20,scrollPercent:50,exitIntent:true,visitId:randomUUID(),cartValue:100}
  let serial=0
  const base={name:'Checkout help',enabled:true,sender:'Alex · Support',brand:'Synthetic shop',message:'Need checkout help?',pathPrefix:'/checkout',trigger:{type:'time',seconds:20},audience:'all',delaySeconds:20,dailyCap:1,timezone:'America/New_York',quietHours:{enabled:false,start:20,end:8}}
  const save=async(config=base,id=`campaign-${++serial}`,revision=0,token=owner,status=200)=>(await app.call(endpoint+'/'+id,{token,method:'PUT',body:{...config,revision},status})).data
  const disable=async c=>{const {id,revision,...config}=c;return save({...config,enabled:false},id,revision)}
  const first=await save()
  assert.equal(first.revision,1)
  await save(base,first.id,0,owner,409)
  await save(base,first.id,1,w.tokens.operator,403)
  await save(base,first.id,1,other.tokens.owner,403)
  await save({...base,timezone:'Not/AZone'},'bad-zone',0,owner,400)
  await save({...base,pathPrefix:'/checkout?email=private'},'bad-url',0,owner,400)
  await save({...base,dailyCap:0},'bad-cap',0,owner,400)
  assert.equal((await app.first("SELECT count(*) n FROM audit_events WHERE action='widget.campaign.saved'")).n,1,'stale/refused writes add no success audit')
  const settings=()=>app.ok(`/api/management/projects/${p}/settings`,{token:owner,method:'PUT',body:{is_contact_tracking_enabled:true,proactive_help_enabled:true}})
  assert.equal((await command('campaignEvaluate',context)).data.offer,null,'workspace off')
  await settings()
  assert.equal((await command('campaignEvaluate',context)).data.offer,null,'no consent')
  await command('contextConsent',{consent:false})
  assert.equal((await command('campaignEvaluate',context)).data.offer,null,'declined')
  assert.equal((await app.first('SELECT count(*) n FROM widget_campaign_visits')).n,0)
  await command('contextConsent',{consent:true})
  for(const input of [{...context,elapsedSeconds:19.99},{...context,path:'/account'}])assert.equal((await command('campaignEvaluate',input)).data.offer,null)
  const attempts=await Promise.all([command('campaignEvaluate',context),command('campaignEvaluate',context)])
  const offers=attempts.map(r=>r.data.offer).filter(Boolean)
  assert.equal(offers.length,1,'racing tabs share one daily slot')
  const offer=offers[0];assert.equal(offer.sender,base.sender);assert.equal(offer.brand,base.brand)
  const report=()=>app.ok(`/api/dashboard/projects/${p}/reports?period=30`,{token:owner})
  const row=async id=>(await report()).campaigns.find(c=>c.id===id)
  assert.equal((await row(first.id)).impressions,0,'reservation is not a display')
  await command('campaignEvent',{id:offer.id,event:'show'})
  await command('campaignEvent',{id:offer.id,event:'show'})
  await command('campaignEvent',{id:offer.id,event:'open'})
  await command('campaignEvent',{id:offer.id,event:'open'})
  assert.equal((await app.first('SELECT count(*) n FROM messages')).n,0,'offer and open do not send a visitor message')
  assert.deepEqual(await row(first.id),{id:first.id,name:base.name,impressions:1,opens:1,dismissals:0,conversations:0,resolutions:0})
  await command('campaignEvent',{id:offer.id,event:'dismiss'})
  await command('campaignEvent',{id:offer.id,event:'dismiss'})
  assert.equal((await row(first.id)).dismissals,1)
  const foreignVisitor=await app.ok('/api/identity/widget/session',{body:{widgetKey:w.widgetKey},headers:{Origin:w.allowedOrigin}})
  const foreignConversation=await app.ok('/api/conversations',{token:foreignVisitor.token,body:{projectId:p}})
  await command('contextConsent',{consent:true},200,foreignVisitor.token,foreignConversation.id)
  await command('campaignEvent',{id:offer.id,event:'show'},404,foreignVisitor.token,foreignConversation.id)
  await command('campaignEvaluate',context,404,visitor.token,foreignConversation.id)
  await command('campaignEvent',{id:offer.id,event:'resolve'},400)
  await command('campaignEvent',{id:offer.id,event:'open',content:'never sent'},400)
  await app.presenceAwayOff(p)
  await app.ok(`/api/conversations/${conversation.id}/messages`,{token:visitor.token,body:{localId:'synthetic-happytohelp-1',content:'I chose to ask for help',expectedRevision:0}})
  assert.equal((await row(first.id)).conversations,1)
  await app.ok(`/api/dashboard/projects/${p}/conversations/${conversation.id}`,{token:owner,method:'PUT',body:{resolved:true}})
  assert.equal((await row(first.id)).resolutions,1)
  await app.configure({})
  assert.equal((await command('campaignEvaluate',context)).data.offer,null,'cap survives restart')
  await disable(first)
  await command('campaignEvent',{id:offer.id,event:'open'})
  assert.equal((await app.first('SELECT count(*) n FROM messages')).n,1)
  // Each trigger and audience is configured through the lead route, evaluated through the visitor route,
  // with a negative boundary and a matching boundary. No new test registrations.
  await app.db.prepare('UPDATE contacts SET metadata_json=? WHERE id=?').bind(JSON.stringify({plan:'plus'}),visitor.contactId).run()
  for(const [trigger,miss,hit] of [
   [{type:'page'},{path:'/other'},{}],
   [{type:'time',seconds:25},{elapsedSeconds:24},{elapsedSeconds:25}],
   [{type:'scroll',percent:75},{scrollPercent:74},{scrollPercent:75}],
   [{type:'exit'},{exitIntent:false},{}],
   [{type:'attribute',key:'plan',value:'plus'},{},{}],
   [{type:'returning'},{visitId:context.visitId},{visitId:randomUUID()}],
   [{type:'cart',minimum:120},{cartValue:119},{cartValue:120}],
  ]){
   const c=await save({...base,trigger})
   if(trigger.type==='attribute')await app.db.prepare('UPDATE contacts SET metadata_json=? WHERE id=?').bind('{"plan":"basic"}',visitor.contactId).run()
   assert.equal((await command('campaignEvaluate',{...context,...miss})).data.offer,null,`${trigger.type} negative`)
   if(trigger.type==='attribute')await app.db.prepare('UPDATE contacts SET metadata_json=? WHERE id=?').bind('{"plan":"plus"}',visitor.contactId).run()
   assert.ok((await command('campaignEvaluate',{...context,...hit})).data.offer,`${trigger.type} positive`)
   await disable(c)
  }
  for(const audience of ['new','returning']){
   const c=await save({...base,audience})
   const result=(await command('campaignEvaluate',{...context,visitId:randomUUID()})).data
   assert.equal(!!result.offer,audience==='returning',`${audience} audience`)
   if(audience==='new')assert.ok((await command('campaignEvaluate',{...context,visitId:randomUUID()},200,foreignVisitor.token,foreignConversation.id)).data.offer,'new audience admits a first visit')
   await disable(c)
  }
  const hour=Number(new Intl.DateTimeFormat('en',{timeZone:'America/New_York',hour:'numeric',hourCycle:'h23'}).format(new Date()))
  const quiet=await save({...base,quietHours:{enabled:true,start:hour,end:(hour+1)%24}})
  assert.equal((await command('campaignEvaluate',context)).data.offer,null,'quiet local hour including overnight')
  await disable(quiet)
  const fullDay=await save({...base,quietHours:{enabled:true,start:0,end:0}})
  assert.equal((await command('campaignEvaluate',context)).data.offer,null,'equal quiet bounds silence all day')
  await disable(fullDay)
  // A new local day resets the daily fence; the fixture changes only stored time, not answers.
  const daily=await save(base)
  assert.ok((await command('campaignEvaluate',context)).data.offer)
  await app.db.prepare("UPDATE widget_campaign_impressions SET day='2000-01-01' WHERE campaign_id=?").bind(daily.id).run()
  assert.ok((await command('campaignEvaluate',context)).data.offer)
  await command('contextConsent',{consent:false})
  assert.equal((await command('campaignEvaluate',context)).data.offer,null)
  assert.equal((await app.first('SELECT count(*) n FROM widget_campaign_impressions WHERE contact_id=?',visitor.contactId)).n,0,'revocation erases campaign attribution')
  assert.ok((await app.first('SELECT count(*) n FROM widget_campaign_impressions')).n>0)
  await app.scheduled({}, {after:31*86400000})
  assert.equal((await app.first('SELECT count(*) n FROM widget_campaign_impressions')).n,0,'scheduled expiry removes campaign identifiers after 30 days')
  assert.equal((await app.first('SELECT count(*) n FROM widget_campaign_visits')).n,0)
 }finally{await app.close()}
}
