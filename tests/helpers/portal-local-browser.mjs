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
   await page.getByRole('status').filter({hasText:'No sign-in link will arrive'}).waitFor()
   assert.equal(await page.getByRole('button',{name:'Email a sign-in link',exact:true}).count(),0)
   await page.getByRole('link',{name:'Browse the Help Center',exact:true}).click()
   await page.waitForURL(url=>url.pathname.startsWith('/help/'))
   assert.ok(new URL(page.url()).pathname.startsWith('/help/'),'local customer can continue to public help')
  }
  passed=true
 }finally{await context.close();await runtime.close(passed)}
}
