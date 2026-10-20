import {createServer} from 'node:net'
import {createRuntime} from '../emitted-runtime.mjs'
import assert from 'node:assert/strict'
import {seedTriageDataset} from './triage-dataset.mjs'
export async function triageBrowserJourney({runtime,browser,shot,fixture}){
 const ownsRuntime=!runtime
 if(!runtime){const reservation=createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));runtime=await createRuntime({port,queueConsumers:true,vars:{APP_ORIGIN:`http://127.0.0.1:${port}`,OPENAI_API_KEY:'sk-test',H2H_LOCAL:'true',EMAIL_PROVIDER:'development',EMAIL_FROM:'support@localhost.test'},outboundFixture:new URL('./triage-network.mjs',import.meta.url).href})}
 const f=fixture??await seedTriageDataset(runtime.origin).catch(async error=>{if(ownsRuntime)await runtime.close(false);throw error}),context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[]
 await context.addCookies([{name:'h2h_session',value:f.token,url:runtime.origin}]);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());page.setDefaultTimeout(20000)
 const capture=async(name,selector)=>{
  await page.addScriptTag({path:'node_modules/axe-core/axe.min.js'})
  const violations=await page.evaluate(async selector=>(await window.axe.run({include:[selector]},{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}})).violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})),selector)
  assert.deepEqual(violations,[],name+' accessibility');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' overflow');await page.screenshot({path:shot(name+'.png'),fullPage:true})
 }
 try{
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:width===390?844:1000})
  await page.goto(`${runtime.origin}/projects/${f.projectId}/workflow-settings`)
  await page.getByRole('button',{name:'Triage',exact:true}).click();await page.getByRole('heading',{name:'Intelligent triage',exact:true}).waitFor()
  await page.getByLabel('Enable triage',{exact:true}).waitFor();await capture(`triage-settings-${width}`,'.triage-settings')
  await page.getByLabel('I reviewed accuracy by intent',{exact:true}).check();await page.getByLabel('Use predictions for routing',{exact:true}).check();await page.getByRole('button',{name:'Save triage settings',exact:true}).click();await page.getByText('Saved.',{exact:true}).waitFor()
  assert.equal((await f.settings()).routing_enabled,true)
  // Reset through the real settings door so each viewport proves explicit approval.
  await f.api(f.base+'/triage-settings',{...await f.settings(),routing_enabled:false},'PUT')
  await page.goto(`${runtime.origin}/projects/${f.projectId}/conversations/${f.tickets[0].id}`)
  const show=page.getByRole('button',{name:'Show conversation panel',exact:true});if(await show.isVisible())await show.click()
  await page.getByRole('tab',{name:'Details',exact:true}).click()
  await page.locator('.triage-panel').scrollIntoViewIfNeeded();await page.locator('.triage-prediction').first().waitFor();await capture(`triage-ticket-${width}`,'.triage-panel')
  await page.getByLabel('Field to correct',{exact:true}).selectOption('sentiment');await page.getByLabel('Correct sentiment',{exact:true}).selectOption('neutral');await page.getByRole('button',{name:'Save correction',exact:true}).click();await page.getByText('Triage correction saved.',{exact:true}).waitFor();await capture(`triage-correction-${width}`,'.triage-panel')
 }
 assert.deepEqual(errors,[])
 }finally{await context.close();if(ownsRuntime)await runtime.close(true)}
 return f
}
