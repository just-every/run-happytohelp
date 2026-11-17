import assert from 'node:assert/strict'
import {createRuntime} from './emitted-runtime.mjs'

// Extends the existing portal journey: a local visitor never waits for suppressed mail.
export async function localPortalBrowser({browser,shot}){
 const runtime=await createRuntime({vars:{APP_ORIGIN:'http://127.0.0.1',H2H_LOCAL:'true',EMAIL_PROVIDER:'development',EMAIL_FROM:'support@localhost.test'}})
 const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage()
 let passed=false
 try{
  const tenant=await runtime.seedTenant({name:'Local trial support',email:'synthetic-happytohelp-11@example.test',allowedOrigin:runtime.origin})
  for(const suffix of ['', '?sent=1']){
   await page.goto(`${runtime.origin}/portal/${tenant.projectId}/requests${suffix}`)
   await page.getByRole('status').waitFor()
   assert.equal(await page.getByRole('button',{name:'Email a sign-in link',exact:true}).count(),0)
   await page.getByRole('link',{name:'Browse the Help Center',exact:true}).click()
   await page.waitForURL(url=>url.pathname.startsWith('/help/'))
   assert.ok(new URL(page.url()).pathname.startsWith('/help/'),'local customer can continue to public help')
  }

  // A local request preview never offers an impossible customer verification submission.
  const response=await fetch(runtime.origin+`/api/forms/projects/${tenant.projectId}/forms`,{method:'POST',headers:{Authorization:'Bearer '+tenant.token,'Content-Type':'application/json'},body:JSON.stringify({title:'Local help request',enabled:true,fields:[]})})
  assert.equal(response.status,201);const {data:form}=await response.json()
  await page.goto(`${runtime.origin}/help/${tenant.projectId}/requests/${form.id}`)
  assert.equal(await page.locator('#customer-request').count(),0,'the unavailable local form is replaced by a chat route')
  assert.doesNotMatch(await page.locator('main').innerText(),/mail outbox|hosted installation|spam protection/,'customer copy contains no installation instructions')
  assert.equal(await page.locator('.request-identity a').count(),0,'local preview has no impossible email verification action')
  assert.equal(await page.locator('.cf-turnstile').count(),0,'local preview cannot challenge for an unavailable submission')
  const chat=page.locator('.request-unavailable a[href="#launch-chat"]');assert.equal(await chat.count(),1)
  await chat.click();await page.getByLabel('Your email, so we can reply',{exact:true}).waitFor()
  assert.equal(await page.locator('.happytohelp-interact').count(),1,'the request page mounts its own workspace chat, including a secondary workspace')
  passed=true
 }finally{await context.close();await runtime.close(passed)}
}
