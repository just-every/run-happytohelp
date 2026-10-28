import test from 'node:test'
import assert from 'node:assert/strict'
import {createRuntime} from '../helpers/emitted-runtime.mjs'
import {launchBrowser,evidence} from './kit/browser.mjs'
// One phone smoke for the main workspace screens; behavioural journeys own their assertions.
test('at 390px an owner reaches their workspace and answers a widget visitor using the compact inbox',{timeout:90_000},async()=>{
 const browser=await launchBrowser(),runtime=await createRuntime(),shot=await evidence('phone-smoke');let passed=false,context
 try{
  const owner=await runtime.seedTenant({name:'Phone smoke',email:'synthetic-happytohelp-1@example.test',allowedOrigin:runtime.origin})
  context=await browser.newContext({viewport:{width:390,height:844}});await context.addCookies([{name:'h2h_session',value:owner.token,url:runtime.origin}])
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.goto(runtime.origin);await page.getByRole('heading',{level:1}).waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:shot('homepage-390.png'),fullPage:true})
  for(const screen of ['activation','conversations','reports','widget-settings']){
   const response=await page.goto(`${runtime.origin}/projects/${owner.projectId}/${screen}`)
   assert.equal(response.status(),200,screen+' renders')
   await page.locator('#workspace-main').waitFor();await page.locator('#workspace-main h1').first().waitFor({state:'attached'});await page.evaluate(()=>document.fonts.ready)
   assert.ok((await page.locator('#workspace-main').innerText()).trim().length,screen+' has content')
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),screen+' has no horizontal scroll')
   await page.screenshot({path:shot(screen+'-390.png'),fullPage:true})
  }
  const visitor=await browser.newContext({viewport:{width:390,height:844}}),widget=await visitor.newPage()
  try{
   const project=await (await context.request.get(runtime.origin+`/api/identity/projects/${owner.projectId}`)).json()
   await widget.goto(runtime.origin+`/help/${owner.projectId}`);await widget.addScriptTag({url:runtime.origin+'/widget.js'})
   await widget.evaluate(options=>window.h2h('init',options),{widgetKey:project.widget_key,apiOrigin:runtime.origin,open:true,settings:{collector:{enabled:false}}})
   await widget.locator('textarea[name=content]').fill('A question from my phone');await widget.locator('button[name=submit]').click()
   const key=`rer-widget:${runtime.origin}:${project.widget_key}`
   await widget.waitForFunction(key=>JSON.parse(localStorage.getItem(key)||'null')?.conversationId,key)
   const conversationId=await widget.evaluate(key=>JSON.parse(localStorage.getItem(key)).conversationId,key)
   await page.goto(runtime.origin+`/projects/${owner.projectId}/conversations/${conversationId}`)
   await page.locator('p').filter({hasText:/^A question from my phone$/}).waitFor()
   await page.getByRole('button',{name:'Show conversation panel',exact:true}).click();await page.getByRole('tab',{name:'Ticket',exact:true}).click()
   await page.keyboard.press('Escape');await page.locator('#conversation-assistant').waitFor({state:'hidden'})
   await page.getByRole('textbox',{name:'Reply to conversation',exact:true}).fill('Your phone request reached our team.')
   await page.getByRole('button',{name:'Send',exact:true}).click();await widget.getByText('Your phone request reached our team.',{exact:true}).waitFor()
   await widget.reload();await widget.addScriptTag({url:runtime.origin+'/widget.js'});await widget.evaluate(options=>window.h2h('init',options),{widgetKey:project.widget_key,apiOrigin:runtime.origin,open:true,settings:{collector:{enabled:false}}})
   await widget.getByText('Your phone request reached our team.',{exact:true}).waitFor()
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
   await page.screenshot({path:shot('reply-390.png')});await widget.screenshot({path:shot('widget-390.png')})
  }finally{await visitor.close()}
  assert.deepEqual(errors,[],'main phone screens have no page errors');passed=true
 }finally{await context?.close();await browser.close();await runtime.close(passed)}
})
