import assert from 'node:assert/strict'
import {createRuntime} from '../emitted-runtime.mjs'
import {launchBrowser} from '../../journeys/kit/browser.mjs'

export async function localEmailSetupBrowser(){
 const runtime=await createRuntime({vars:{H2H_LOCAL:'true',APP_ORIGIN:'http://127.0.0.1',EMAIL_PROVIDER:'development',EMAIL_FROM:'support@localhost.test'}}),browser=await launchBrowser()
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
  await context.close();passed=true
 }finally{await browser.close();await runtime.close(passed)}
}
