import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {createRuntime} from './emitted-runtime.mjs'
import {launchBrowser,evidence} from '../journeys/kit/browser.mjs'

// Network edge only. This module also supplies the browser's isolated receiver.
let sends=0
export default async request=>{
 const url=new URL(request.url)
 if(url.origin==='https://receiver.example.com'){sends++;return new Response(null,{status:sends===1?400:sends===2?500:204})}
 if(url.origin==='https://api.helpscout.net'&&url.pathname==='/v2/oauth2/token')return new Response('',{status:429})
 throw Error('Unexpected connector browser egress')
}
export async function api001Browser(){
 const runtime=await createRuntime({vars:{INTEGRATION_ENCRYPTION_KEY:randomBytes(32).toString('base64')},outboundFixture:import.meta.url}),browser=await launchBrowser(),shot=await evidence('api001')
 let passed=false
 try{
  const owner=await runtime.seedTenant({name:'Connector operations',email:'api001-browser@example.test'}),root=`/api/management/projects/${owner.projectId}/connections`
  const api=async(path,method='GET',data)=>{const response=await fetch(runtime.origin+path,{method,headers:{Authorization:'Bearer '+owner.token,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});assert.ok(response.ok,path+': '+response.status+' '+await response.clone().text());return response.json()}
  const destination=await api(root+'/webhooks','POST',{name:'Browser receiver',url:'https://receiver.example.com/browser',events:['conversation.created']})
  await api(root+'/webhooks/'+destination.id+'/test','POST',{});await api(root+'/webhooks/'+destination.id+'/test','POST',{})
  await api(root+'/helpscout','PUT',{app_id:'browser-app',app_secret:'synthetic-browser-app',webhook_secret:'synthetic-browser-hook',mailbox_id:'1'})
  const context=await browser.newContext({viewport:{width:1440,height:1000}})
  try{
   await context.addCookies([{name:'h2h_session',value:owner.token,url:runtime.origin}]);const page=await context.newPage();page.setDefaultTimeout(20000)
   await page.goto(runtime.origin+`/projects/${owner.projectId}/delivery-log`)
   const section=page.getByRole('region',{name:'Connection health'});await section.getByRole('heading',{name:'Help Scout',exact:true}).waitFor()
   for(const name of ['API tokens','Webhooks','Slack','Zapier hooks','MCP','Help Scout'])assert.equal(await section.getByRole('heading',{name,exact:true}).count(),1)
   const webhooks=section.locator('li').filter({has:page.getByRole('heading',{name:'Webhooks',exact:true})})
   assert.match(await webhooks.innerText(),/failing/);assert.match(await webhooks.innerText(),/HTTP 400/);assert.match(await webhooks.innerText(),/Uncertain: 1/)
   assert.equal(await webhooks.getByRole('button',{name:'Resend uncertain webhook'}).count(),1)
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'catalog fits desktop')
   for(const width of [1440,390]){await page.setViewportSize({width,height:width===390?844:1000});await page.screenshot({path:shot('catalog-'+width+'.png'),fullPage:true})}
   await page.setViewportSize({width:1440,height:1000})
   const response=page.waitForResponse(r=>r.url().includes('/resend')&&r.request().method()==='POST');await webhooks.getByRole('button',{name:'Resend uncertain webhook'}).click();assert.equal((await response).status(),202)
   await section.getByText('Resend queued. Check delivery attempts for its result.',{exact:true}).waitFor()
   const pull=page.waitForResponse(r=>r.url().endsWith('/helpscout/pull'));await section.getByRole('button',{name:'Pull Help Scout now'}).click();assert.equal((await pull).status(),502)
   await section.getByRole('alert').waitFor();await section.getByRole('button',{name:'Refresh connection health'}).click()
   const scout=section.locator('li').filter({has:page.getByRole('heading',{name:'Help Scout',exact:true})});await scout.getByText(/rate_limited/).waitFor()
   assert.match(await scout.innerText(),/failing/)
   assert.ok(!/synthetic-browser|Browser receiver/.test(await section.innerText()))
  }finally{await context.close()}
  passed=true
 }finally{await browser.close();await runtime.close(passed)}
}
