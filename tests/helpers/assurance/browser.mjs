import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {createRuntime} from '../emitted-runtime.mjs'
import {evidence,viewports} from '../../journeys/kit/browser.mjs'
import {resolve} from 'node:path'
import {writeFile} from 'node:fs/promises'
export async function assuranceBrowserJourney(browser,viewport=viewports.desktop){
 const runtime=await createRuntime({vars:{INTEGRATION_ENCRYPTION_KEY:randomBytes(32).toString('base64')}}),shot=await evidence('assurance');let passed=false
 try{
 {
  const owner=await runtime.seedTenant({name:'Regulated deployment '+viewport.width,email:`synthetic-happytohelp-${viewport.width}@example.test`,allowedOrigin:runtime.origin}),context=await browser.newContext({viewport});await context.addCookies([{name:'h2h_session',value:owner.token,url:runtime.origin}]);const page=await context.newPage();page.setDefaultTimeout(25000)
  try{
   const path=`/api/assurance/projects/${owner.projectId}`,inspect=async name=>{assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'qualification fits viewport');await page.screenshot({path:shot(`${viewport.width}-${name}.png`),fullPage:true})}
   await page.goto(runtime.origin+`/projects/${owner.projectId}/assurance`);await page.getByRole('heading',{name:'Regulated deployment',level:2,exact:true}).waitFor();await page.getByText('Health-data support is not enabled.',{exact:true}).waitFor();await inspect('missing-controls')
   await page.getByLabel('Qualification partner / provider',{exact:true}).fill('US provider / independent qualification partner');await page.getByLabel('Isolated deployment reference',{exact:true}).fill('synthetic-happytohelp-5-isolated-deployment');await page.getByLabel('IANA calendar timezone',{exact:true}).fill('America/New_York');await page.getByLabel('I confirm this is a qualification preview, with health-data processing disabled.',{exact:true}).check();await inspect('qualification-profile');await page.getByRole('button',{name:'Request qualification review',exact:true}).click();await page.getByText('Qualification profile saved. Health-data activation remains disabled.',{exact:true}).waitFor();await page.reload();await page.getByRole('button',{name:'Save qualification profile',exact:true}).waitFor()
   for(const [kind,label] of [['dpa','Executed DPA'],['baa','Executed BAA'],['subprocessor','Approved subprocessor / model provider']]){
    await page.getByLabel('Agreement or control',{exact:true}).selectOption(kind);await page.getByLabel('Provider or independent verifier',{exact:true}).fill('US synthetic provider');await page.getByLabel('Executed agreement or passing receipt URL',{exact:true}).fill('https://evidence.example.com/qualification/'+kind);await page.getByLabel('Expires on (UTC)',{exact:true}).fill('2027-10-23');await page.getByRole('button',{name:'Record verified evidence',exact:true}).click();await page.locator('.assurance-evidence').getByText(label,{exact:true}).waitFor();await inspect('evidence-'+kind)
   }
   await page.getByRole('button',{name:'Check health-data activation',exact:true}).click();await page.getByRole('alert').filter({hasText:'independent partner review'}).waitFor();await inspect('activation-blocked')
   await page.getByRole('button',{name:'Revoke Executed BAA',exact:true}).click();await page.getByText('Evidence revoked. Health-data support remains blocked.',{exact:true}).waitFor();await page.getByText('Required executed BAA is missing, expired or revoked.',{exact:true}).waitFor();await inspect('baa-revoked')
   const download=await context.request.get(runtime.origin+path+'/report');assert.equal(download.status(),200);const record=await download.json();assert.equal(record.data.health_data_enabled,false);assert.equal(record.data.recording_enabled,false)
   await page.addScriptTag({path:resolve('node_modules/axe-core/axe.min.js')});const violations=await page.evaluate(async()=>(await axe.run(document.querySelector('.assurance-page'))).violations.filter(v=>['serious','critical'].includes(v.impact)).map(v=>v.id));assert.deepEqual(violations,[])
   await writeFile(shot(viewport.width+'-proof.json'),JSON.stringify({viewport,profile:true,agreements:['dpa','baa'],providerSettings:true,independentActivationHold:true,revokedBAABlocks:true,qualificationExport:true,healthDataEnabled:false,violations},null,2))
  }catch(error){await page.screenshot({path:shot(viewport.width+'-failure.png'),fullPage:true}).catch(()=>{});throw error}finally{await context.close()}
 }
 passed=true
 }finally{await runtime.close(passed)}
}
