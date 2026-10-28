import test from 'node:test'
import {createRuntime} from '../helpers/emitted-runtime.mjs'
import {homepageJourney} from '../homepage-browser.mjs'
import {launchBrowser,viewports,evidence} from './kit/browser.mjs'

test('a new owner finds the source and installation guide from the public product page, and recovers from a missing documentation page',async()=>{
 const runtime=await createRuntime(),browser=await launchBrowser()
 let passed=false
 try{
  const context=await browser.newContext({viewport:viewports.desktop}),page=await context.newPage()
  await homepageJourney({page,origin:runtime.origin,shot:await evidence('public')})
  passed=true
 }finally{await browser.close();await runtime.close(passed)}
})

import assert from 'node:assert/strict'
import {domainsBrowserJourney} from '../helpers/knowledge/domains-browser.mjs'
import {proposalsBrowserJourney} from '../helpers/knowledge/proposals-browser.mjs'
test('a lead publishes two approved help hosts, scoped reviewed translations and a cited editorial proposal, with an attributed request template',async()=>{
 const retainedSlug='retained-browser-help'
 const runtime=await createRuntime({vars:{APP_ORIGIN:'http://127.0.0.1',PUBLIC_HELP_HOSTS:JSON.stringify({localhost:retainedSlug,'second.localhost':'second-browser-help'})}}),browser=await launchBrowser()
 let passed=false
 try{
  const fixture=await runtime.seedTenant({name:'Help Center Fixture',email:'help-center-fixture@example.test',allowedOrigin:runtime.origin})
  await runtime.execute(`INSERT INTO public_project_aliases(slug,project_id) VALUES('${retainedSlug}','${fixture.projectId}')`)
  const write=async(path,body,method='POST')=>{const response=await fetch(runtime.origin+path,{method,headers:{Authorization:'Bearer '+fixture.token,'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(response.status,method==='PUT'?200:201);return response.json()}
  await write(`/api/knowledge/${fixture.projectId}/articles`,{slug:'quick-start',title:'Quick start',content:'Start here.',status:'published'})
  await write(`/api/forms/projects/${fixture.projectId}/forms`,{title:'Ask support',description:'Tell us what went wrong.',locale:'en',enabled:true,fields:[]})
  await write(`/api/knowledge/${fixture.projectId}/experience`,{defaultLocale:'en',locales:['en'],templates:{request:'Before request {{title}}\n{{content}}\nAfter request'}},'PUT')
  const shot=await evidence('knowledge'),context=await browser.newContext({viewport:viewports.desktop}),page=await context.newPage()
  try{
   await page.goto(`${runtime.origin}/help/${fixture.projectId}/quick-start`)
   await page.getByRole('link',{name:'Submit a request',exact:true}).click()
   assert.match(page.url(),/afterReading=[a-f0-9-]{36}/)
   await page.getByRole('heading',{name:'Ask support',exact:true}).waitFor()
   assert.match(await page.locator('.help-center-content').innerText(),/Before request Ask support/)
   assert.match(await page.locator('#customer-request').getAttribute('data-after-reading'),/^[a-f0-9-]{36}$/)
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'request form fits the viewport')
   for(const width of [1440,390]){await page.setViewportSize({width,height:900});await page.screenshot({path:shot(`request-template-${width}.png`),fullPage:true})}
  }finally{await context.close()}
  await domainsBrowserJourney({runtime,browser,fixture,viewport:viewports.desktop,shot});await proposalsBrowserJourney({runtime,browser,shot});passed=true
 }finally{await browser.close();await runtime.close(passed)}
})
