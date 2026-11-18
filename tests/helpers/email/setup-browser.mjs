import {mailboxHistoryBrowser} from './history-browser.mjs'
import assert from 'node:assert/strict'
import {developerHandoffFlow} from '../developer-handoff.mjs'
import {createRuntime} from '../emitted-runtime.mjs'
import {launchBrowser} from '../../journeys/kit/browser.mjs'

export async function localEmailSetupBrowser(){
 const runtime=await createRuntime({queueConsumers:true,outboundFixture:new URL('./history-browser-edge.mjs',import.meta.url).href,vars:{INTEGRATION_ENCRYPTION_KEY:Buffer.alloc(32,7).toString('base64'),H2H_LOCAL:'true',APP_ORIGIN:'http://127.0.0.1',EMAIL_PROVIDER:'development',EMAIL_FROM:'support@localhost.test'}}),browser=await launchBrowser()
 let passed=false
 try{
  const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage()
  page.setDefaultTimeout(25000)
  const response=await context.request.post(runtime.origin+'/api/identity/bootstrap',{data:{name:'Local email trial',email:'synthetic-happytohelp-email@example.test',password:'synthetic-happytohelp-email-password',allowedOrigin:runtime.origin}})
  assert.equal(response.status(),201)
  const owner=await response.json()
  assert.equal(owner.welcomeEmail,'suppressed')
  const settings=`${runtime.origin}/api/management/projects/${owner.projectId}/email-settings`
  assert.equal((await context.request.put(settings,{data:{from_name:'Local email trial',from_address:'support@localhost.test',inbound_address:'support@localhost.test',is_enabled:true}})).status(),200)
  await page.goto(`${runtime.origin}/projects/${owner.projectId}/email-settings`)
  await page.locator('[data-receiving="local"]').waitFor()
  const trialAddress=await page.getByLabel('Receiving address',{exact:true}).inputValue(),guide=page.locator('[data-guide="receiving"]')
  if(await guide.getAttribute('open')===null)await guide.locator('summary').click()
  assert.equal(await guide.locator('ol,li').count(),0,'a local trial offers no DNS or mail-routing steps')
  assert.ok(!(await guide.innerText()).includes(trialAddress.split('@')[1]),'the reserved trial domain is never offered as a routing target')
  await guide.getByRole('link').click()
  assert.equal(new URL(page.url()).pathname.startsWith('/docs/'),true,'the local guide opens on-site hosted setup instructions')
  assert.equal((await context.request.get(page.url())).status(),200,'hosted setup documentation is available')
  await page.goto(`${runtime.origin}/projects/${owner.projectId}/email-settings`)
  await page.getByRole('button',{name:'Add mailbox',exact:true}).click()
  await page.getByLabel('Connection',{exact:true}).selectOption('gmail')
  const editor=page.locator('.email-editor')
  await editor.locator('.developer-handoff').waitFor()
  assert.equal(await editor.getByRole('button',{name:'Authorize mailbox',exact:true}).count(),0,'no authorization door until provider configuration is ready')
  await developerHandoffFlow(page,editor.locator('.developer-handoff'))
  await page.getByRole('button',{name:'Cancel',exact:true}).click()
  await page.getByRole('link',{name:'Business hours',exact:true}).click()
  await page.getByLabel('Opening time',{exact:true}).fill('08:15')
  await page.getByLabel('Closing time',{exact:true}).fill('17:30')
  await page.getByRole('button',{name:'Update',exact:true}).click()
  await page.getByRole('status').filter({hasText:'Saved.'}).waitFor()
  await page.reload()
  assert.equal(await page.getByLabel('Opening time',{exact:true}).inputValue(),'08:15','top-level hours retain the native save behavior')
  assert.equal(await page.getByLabel('Closing time',{exact:true}).inputValue(),'17:30')
  const advanced=page.locator('.nav-settings-advanced')
  assert.equal(await advanced.getAttribute('open'),null,'advanced navigation starts collapsed on everyday pages')
  await advanced.locator('summary').click()
  await advanced.getByRole('link',{name:'Cutover',exact:true}).click()
  await page.getByRole('heading',{name:'Cutover',exact:true}).waitFor()
  await page.getByRole('link',{name:'AI',exact:true}).click()
  const ai=page.locator('[data-testid="ai-key-status"] .developer-handoff')
  await ai.waitFor();await developerHandoffFlow(page,ai)
  await mailboxHistoryBrowser({runtime,page,owner:{...owner,userId:owner.userId||owner.actor?.id}})
  await context.close();passed=true
 }finally{await browser.close();await runtime.close(passed)}
}
