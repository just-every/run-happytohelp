import assert from 'node:assert/strict'
import {createRuntime} from '../emitted-runtime.mjs'
import {launchBrowser,auditPage,viewports,evidence} from '../../journeys/kit/browser.mjs'

// The seed's only phone smoke performs useful work through the compact inbox.
export async function mobileInbox(){
 const runtime=await createRuntime(),browser=await launchBrowser(),shot=await evidence('phone-smoke')
 let passed=false
 try{
  const owner=await runtime.seedTenant({name:'Phone support',email:'phone@example.test',allowedOrigin:runtime.origin})
  await runtime.presenceAwayOff(owner.projectId)
  const context=await browser.newContext({viewport:viewports.mobile})
  await context.addCookies([{name:'h2h_session',value:owner.token,url:runtime.origin}])
  const project=await (await context.request.get(runtime.origin+`/api/identity/projects/${owner.projectId}`)).json()
  const customerResponse=await fetch(runtime.origin+'/api/identity/widget/session',{method:'POST',headers:{'Content-Type':'application/json',Origin:runtime.origin},body:JSON.stringify({widgetKey:project.widget_key,name:'Phone customer'})})
  assert.ok(customerResponse.ok)
  const customer=await customerResponse.json()
  const call=async(path,body)=>{
   const response=await fetch(runtime.origin+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+customer.token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)})
   assert.ok(response.ok,path+': '+response.status);return response.json()
  }
  const conversation=await call('/api/conversations',{projectId:owner.projectId})
  await call(`/api/conversations/${conversation.id}/messages`,{localId:'phone-request',content:'Can you help from the phone?',expectedRevision:0})
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(20000)
  await page.goto(runtime.origin+`/projects/${owner.projectId}/conversations?view=open`)
  await page.locator('.conversation-list-items').getByText('Phone customer',{exact:true}).click()
  await page.getByText('Can you help from the phone?',{exact:true}).first().waitFor()
  await page.getByPlaceholder('Type your reply…').fill('Yes, I can help from the phone.')
  const admitted=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/conversations/${conversation.id}/messages`&&response.request().method()==='POST')
  await page.getByRole('button',{name:'Send',exact:true}).click()
  const receipt=await admitted;assert.equal(receipt.status(),200)
  assert.equal((await receipt.json()).accepted,true,'the phone reply is durably admitted before readback')
  await page.getByText('Yes, I can help from the phone.',{exact:true}).first().waitFor()
  const transcript=await call(`/api/conversations/${conversation.id}/messages`)
  assert.equal(transcript.messages.filter(message=>message.content==='Yes, I can help from the phone.').length,1)
  await auditPage(page,shot('phone-reply.png'))
  await page.goto(runtime.origin+`/projects/${owner.projectId}/conversations?view=open`)
  await page.locator('.conversation-list-items').getByText('Phone customer',{exact:true}).waitFor()
  // A view switch whose workspace read is reset in transit waits as busy and then shows the view, never the alert:
  // the reply assigned the conversation to its sender, so Yours lists it.
  let resets=0,alerted=false
  await page.route(url=>url.pathname.startsWith('/_serverFn/'),route=>{resets++;return route.abort('connectionreset')},{times:1})
  await page.getByRole('button',{name:'Toggle navigation',exact:true}).click()
  await page.getByRole('navigation',{name:'Inbox views',exact:true}).getByRole('link',{name:/^Yours/}).click()
  const busy=page.locator('.dashboard-busy[role="status"]'),watch=async()=>{alerted||=await page.locator('[role="alert"]:visible').count()>0;await page.waitForTimeout(100)}
  for(const until=Date.now()+20000;Date.now()<until&&!await busy.isVisible();)await watch()
  assert.ok(await busy.isVisible(),'the reset read shows the workspace busy state')
  for(const until=Date.now()+30000;Date.now()<until&&await busy.isVisible();)await watch()
  assert.equal(await busy.isVisible(),false,'the busy state ends once the read answers')
  await page.waitForURL(url=>url.searchParams.get('view')==='mine')
  await page.locator('.conversation-list-items').getByText('Phone customer',{exact:true}).waitFor()
  assert.equal(resets,1);await watch();assert.equal(alerted,false,'a transport failure never shows the error alert')
  await page.getByRole('button',{name:'Toggle navigation',exact:true}).click()
  await page.getByRole('navigation',{name:'Main navigation',exact:true}).getByRole('link',{name:'Contacts',exact:true}).click()
  await page.getByRole('heading',{name:'Contacts',exact:true}).waitFor()
  await auditPage(page,shot('phone-contacts.png'))
  assert.deepEqual(errors,[]);passed=true
 }finally{await browser.close();await runtime.close(passed)}
}
