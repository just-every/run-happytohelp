import assert from 'node:assert/strict'
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
