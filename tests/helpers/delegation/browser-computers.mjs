import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {viewports} from '../../journeys/kit/browser.mjs'
import {providerFixture} from '../../provider-helpers/fixture.mjs'
import {checkAdditionalBrowserFailures} from '../../provider-helpers/browser-failures.mjs'
import {LocalRunner} from '../../../local-agent/lib/runner.mjs'
import {newConfig} from '../../../local-agent/lib/config.mjs'

// Local computers in the emitted Worker and a real browser: connecting, authorizing, and a provider failure.
export async function computersBrowserJourney({runtime,browser,shot}){
 const origin=runtime.origin,tenant=await runtime.seedTenant({name:'Local computers',email:'owner@computers.test',allowedOrigin:origin}),project=tenant.projectId
 const context=await browser.newContext({viewport:viewports.desktop}),page=await context.newPage(),errors=[];let fixture
 page.on('pageerror',error=>errors.push(error.message))
 try{
  await context.addCookies([{name:'h2h_session',value:tenant.token,url:origin}])
  // The Connect computer dialog is styled on the Local computers page, which is not the inbox, at both widths.
  for(const [name,size] of Object.entries(viewports)){
   await page.setViewportSize(size);await page.goto(`${origin}/projects/${project}/local-agent`)
   await page.getByRole('button',{name:'Connect computer'}).click();await page.locator('.delegation-setup-modal').waitFor();await page.waitForTimeout(600)
   const dialog=await page.evaluate(()=>{const style=(selector,property)=>{const element=document.querySelector(selector);return element?getComputedStyle(element)[property]:null}
    return {bodyClass:document.body.className,listStyle:style('.delegation-setup-steps','listStyleType'),providerBorder:style('.delegation-provider-options button','borderStyle'),inputWidth:parseFloat(style('.delegation-provider-picker input','width')),modalWidth:document.querySelector('.delegation-setup-modal .modal-content').getBoundingClientRect().width,providerText:document.querySelector('.delegation-provider-options').innerText}})
   assert.ok(!dialog.bodyClass.includes('conversation-workspace'),`the Local computers page is not the inbox (${name})`);assert.equal(dialog.listStyle,'none',`steps have no browser numbering (${name})`)
   assert.notEqual(dialog.providerBorder,'outset','provider choices are not raw browser buttons');assert.ok(dialog.inputWidth>=dialog.modalWidth*.6,`Computer name fills the dialog (${name})`)
   assert.match(dialog.providerText,/Codex\s+Recommended/);assert.match(dialog.providerText,/Claude\s+Alternate/)
   await page.screenshot({path:shot(`connect-${size.width}.png`)});await page.keyboard.press('Escape');await page.locator('.delegation-setup-modal').waitFor({state:'detached'})
  }
  await page.setViewportSize(viewports.desktop)

  // Authorizing a computer shows the recorded decision; the code cannot be used twice.
  const device=async n=>(await (await context.request.post(origin+'/api/local-agents/device-authorizations',{data:{name:'Computer '+n,client_session_id:'pages-'+n,capabilities:[]}})).json()).data
  const exchange=d=>context.request.post(origin+'/api/local-agents/device-authorizations/token',{data:{device_code:d.device_code}})
  const approved=await device('approve');await page.goto(`${origin}/local-agent/authorize?user_code=${approved.user_code}`)
  const code=page.getByLabel('Authorization code');assert.equal(await code.inputValue(),approved.user_code)
  await page.getByRole('button',{name:'Approve',exact:true}).click();const outcome=page.getByRole('status').filter({hasText:'Computer approved'});await outcome.waitFor();assert.match(await outcome.innerText(),new RegExp(approved.user_code))
  assert.equal(await code.inputValue(),'');assert.ok(await page.getByRole('button',{name:'Approve',exact:true}).isDisabled());assert.equal((await exchange(approved)).status(),200,'the server recorded the approval')
  const denied=await device('deny');await code.fill(denied.user_code);await page.getByRole('button',{name:'Deny',exact:true}).click()
  await page.getByRole('status').filter({hasText:'Request denied'}).waitFor();assert.equal((await exchange(denied)).status(),403,'the server recorded the denial')
  await code.fill(approved.user_code);await page.getByRole('button',{name:'Approve',exact:true}).click()
  await page.getByRole('alert').filter({hasText:'not valid'}).waitFor();assert.equal(await outcome.count(),0,'a failed attempt clears the previous outcome')

  // A provider failure on a paired computer: one attempt, the real status and a redacted reason after reload, nothing to send or retry.
  const contact=randomUUID(),conversation=randomUUID()
  await runtime.execute(`INSERT INTO contacts(id,project_id,name,email,created_at) VALUES('${contact}','${project}','Provider test customer','customer@native.test',1); INSERT INTO conversations(id,project_id,contact_id,revision,created_at,updated_at) VALUES('${conversation}','${project}','${contact}',0,1,1);`)
  const pairing=await context.request.post(origin+`/api/projects/${project}/local-agents/pairings`,{data:{}});assert.equal(pairing.status(),200)
  const paired=await fetch(origin+'/api/local-agents/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:(await pairing.json()).data.code,name:'Error proof computer',provider:'codex',capabilities:['terminal']})});assert.equal(paired.status,200);const computer=(await paired.json()).data
  fixture=await providerFixture({beforeResponse:true,error:{message:'Invalid schema for response_format. Missing attachment_ids. api_key=PRIVATE_API\nprompt: PRIVATE_CUSTOMER_CONTEXT',codexErrorInfo:{httpConnectionFailed:{httpStatusCode:400}},additionalDetails:'PRIVATE_DETAILS'},stderr:'Bearer PRIVATE_STDERR'})
  const runner=new LocalRunner(newConfig({server:origin,token:computer.token,device:computer.device,provider:'codex',name:'Error proof computer',workingDirectory:fixture.directory}),{configPath:join(fixture.directory,'connector.json')})
  await runner.run({once:true})
  const location=`${origin}/projects/${project}/conversations/${conversation}`
  const openLocal=async()=>{await page.goto(location);await page.locator('.conversation-assistant-toggle').waitFor();const show=page.getByRole('button',{name:'Show conversation panel',exact:true});if(await show.isVisible())await show.click();await page.locator('#conversation-assistant[aria-hidden=false]').waitFor();await page.getByRole('tab',{name:'Delegate',exact:true}).click()}
  await openLocal()
  await page.locator('#delegation-device').selectOption(computer.device.id);await page.locator('#delegation-mode').selectOption('resolve');await page.locator('#delegation-instructions').fill('Inspect the configuration; do not send a customer message.')
  await page.getByRole('button',{name:/^(Send|Queue) task$/}).click();await page.locator('.delegation-job.is-queued').waitFor()
  await assert.rejects(runner.run({once:true}),error=>error.provider_error?.http_status===400);await runner.run({once:true})
  assert.equal((await readFile(fixture.path+'.calls','utf8')).trim(),'turn/start','one provider turn, never replayed')
  const jobsPath=`${origin}/api/projects/${project}/conversations/${conversation}/delegations`,jobs=(await (await context.request.get(jobsPath)).json()).data
  assert.equal(jobs.length,1);assert.equal(jobs[0].status,'failed');assert.equal(jobs[0].result.provider_error.http_status,400)
  for(const viewport of Object.values(viewports)){
   await page.setViewportSize(viewport);await page.reload();await openLocal()
   const failure=page.locator('.delegation-job.is-failed');await failure.locator('.delegation-job__provider-error').waitFor()
   const text=await failure.innerText();assert.match(text,/HTTP 400/);assert.match(text,/Missing attachment_ids/);assert.match(text,/Review the error before starting another task/);assert.doesNotMatch(text,/PRIVATE_/)
   assert.equal(await failure.getByRole('button',{name:/Send|Retry|Use/}).count(),0);await page.screenshot({path:shot(`provider-error-${viewport.width}.png`),fullPage:true})
  }
  await checkAdditionalBrowserFailures({runtime,context,page,jobsPath,device:computer,fixture,runner,openLocal,evidence:shot('')})
  assert.equal((await (await context.request.get(`${origin}/api/conversations/${conversation}/messages`)).json()).messages.length,0,'no customer message')
  const stored=await runtime.execute(`SELECT result FROM local_jobs WHERE id='${jobs[0].id}'; SELECT payload FROM local_events WHERE job_id='${jobs[0].id}';`);assert.doesNotMatch(stored,/PRIVATE_/);assert.match(stored,/attachment_ids/)
  assert.deepEqual(errors,[])
 }finally{await fixture?.close();await context.close()}
}
