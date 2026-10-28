import test,{before,after} from 'node:test'
import assert from 'node:assert/strict'
import {readFile,writeFile} from 'node:fs/promises'
import {randomBytes} from 'node:crypto'
import {createRuntime} from '../helpers/emitted-runtime.mjs'
import {generate} from '../move-in/generator.mjs'
import {launchBrowser,evidence} from './kit/browser.mjs'

// Move in in a real browser against the emitted Worker: one owner workspace, every
// screen axe-checked for serious findings and horizontal overflow at its width.
let runtime,browser,context,page,request,project,token,base,shot,success=true
const errors=[],results=[],owner={email:'move-in-browser@example.test',password:randomBytes(24).toString('base64url')}
const axe=await readFile(new URL('../../node_modules/axe-core/axe.min.js',import.meta.url),'utf8')
async function inspect(name){await page.addScriptTag({content:axe});const result=await page.evaluate(async()=>{const scan=await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return {violations:scan.violations.filter(v=>['serious','critical'].includes(v.impact)).map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),overflow:document.documentElement.scrollWidth>innerWidth+1}});assert.deepEqual(result.violations,[],name);assert.equal(result.overflow,false,name);await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:shot(`${name}.png`),fullPage:true});results.push({name,...result})}
before(async()=>{
 runtime=await createRuntime({queueConsumers:true});shot=await evidence('move-in')
 request=async(path,{body,method=body===undefined?'GET':'POST',token}={})=>{const response=await fetch(runtime.origin+path,{method,headers:{...(token?{Authorization:`Bearer ${token}`}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});assert.ok(response.ok,`${method} ${path} ${response.status}`);return response.json()}
 const setup=await request('/api/identity/bootstrap',{body:{...owner,name:'Import Owner',allowedOrigin:runtime.origin}});project=setup.projectId;token=(await request('/api/identity/login',{body:owner})).token;base=`/projects/${project}`
 browser=await launchBrowser();context=await browser.newContext({viewport:{width:1440,height:1000},bypassCSP:true});page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));page.on('dialog',async dialog=>{errors.push('Unexpected script dialog');await dialog.dismiss()})
 await page.goto(runtime.origin+'/login?returnTo='+encodeURIComponent(base+'/conversations'));await page.getByLabel('Email',{exact:true}).fill(owner.email);await page.getByLabel('Password',{exact:true}).fill(owner.password);await page.getByRole('button',{name:'Login',exact:true}).click();await page.waitForURL('**/conversations')
})
after(async()=>{await writeFile(shot('checks.json'),JSON.stringify({checks:results,errors},null,2)).catch(()=>{});await browser?.close();await runtime?.close(success)})
const guarded=body=>async()=>{try{await body();assert.deepEqual(errors,[])}catch(error){success=false;throw error}}

async function vendorJourney(width,vendor){
  const label=`${vendor}-${width}`,content=generate(vendor,6,width),filename=`${label}.jsonl`;await page.setViewportSize({width,height:1000});await page.goto(runtime.origin+base+'/move-in');
  await page.getByLabel('Export format',{exact:true}).selectOption(vendor);await page.getByLabel('Export file',{exact:true}).setInputFiles({name:filename,mimeType:'application/octet-stream',buffer:Buffer.from(content)});await page.getByRole('button',{name:'Upload and review',exact:true}).click();
  await page.getByRole('heading',{name:`Ready for review: ${filename}`,exact:true}).waitFor({timeout:120000});assert.match(await page.locator('.move-in-page').innerText(),/Articles: 1 will be published, 1 will stay a draft/);await inspect(`${label}-plan`);
  await page.getByRole('button',{name:'Approve and import',exact:true}).click();await page.getByRole('heading',{name:`Importing: ${filename}`,exact:true}).waitFor();assert.match(await page.locator('.move-in-page').innerText(),/\d+ of \d+ source records processed/);await inspect(`${label}-progress`);
  await page.getByRole('heading',{name:`Complete: ${filename}`,exact:true}).waitFor({timeout:120000});await page.getByRole('heading',{name:'Imported records',exact:true}).scrollIntoViewIfNeeded();await inspect(`${label}-report`);
  assert.equal(await page.getByRole('link',{name:/^Open conversation /}).count(),6);assert.equal(await page.getByRole('link',{name:/^Open article /}).count(),2);assert.equal(await page.getByRole('link',{name:/^Open contact /}).count(),6);assert.equal(await page.getByRole('link',{name:/^Open saved reply /}).count(),1);
  await page.getByRole('button',{name:'Upload and review',exact:true}).click();await page.getByText('This export was already processed.',{exact:false}).waitFor();
  await page.getByRole('link',{name:/^Open conversation /}).first().click();const details=page.getByRole('tab',{name:'Ticket',exact:true}),panelToggle=page.getByRole('button',{name:'Show conversation panel',exact:true});await details.or(panelToggle).first().waitFor();if(!await details.isVisible())await panelToggle.click();await details.click();await page.getByText(`Imported from ${vendor}; source 10001, open. Excluded from Reports.`,{exact:true}).waitFor();await page.locator('.transcript-message-time').first().waitFor({state:'attached'});
  assert.ok(await page.locator('.transcript-message-time').count()>0);
  const input=page.getByRole('textbox',{name:'New tag',exact:true});await input.fill('Review me');await input.locator('..').getByRole('button',{name:'Add',exact:true}).click();const remove=page.getByRole('button',{name:'Remove tag Review me',exact:true});await remove.waitFor();await inspect(`${label}-tag-added`);await remove.click();await remove.waitFor({state:'hidden'});await inspect(`${label}-tag-removed`);
  await page.goto(runtime.origin+base+'/conversations');await page.getByRole('button',{name:'Filters',exact:true}).click();const filter=page.getByRole('combobox',{name:'Filter conversations by tag'});await filter.waitFor();await page.locator('.conversation-item').first().waitFor();
  // Imported closed history is in Closed, so the Open view already shows only the three Priority rows.
  // Mark them: a new filter starts from an empty list, so only rows rendered for the filter lack the mark.
  await page.evaluate(()=>document.querySelectorAll('.conversation-item').forEach(row=>{row.dataset.beforeFilter='1'}));await filter.selectOption({label:'Priority'});
  await page.waitForFunction(()=>document.querySelectorAll('.conversation-item').length===3&&!document.querySelector('.conversation-item[data-before-filter]')&&[...document.querySelectorAll('.conversation-item .conversation-tag')].filter(tag=>tag.textContent.includes('Priority')).length===3);
  assert.equal(await page.locator('.conversation-item').count(),3);assert.equal(await page.locator('.conversation-item .conversation-tag').filter({hasText:'Priority'}).count(),3);await inspect(`${label}-tag-filter`);
  await page.goto(runtime.origin+base+'/move-in');await page.getByRole('button',{name:`${filename} — Complete`,exact:true}).click();await page.getByRole('button',{name:'Undo whole import',exact:true}).click();await page.getByRole('heading',{name:`Undone: ${filename}`,exact:true}).waitFor({timeout:120000});await inspect(`${label}-undone`);
  const listed=await request(`/api/dashboard/projects/${project}/conversations?view=all`,{token});assert.equal(listed.meta.pagination.total,0);

}

test('an owner reviews a Zendesk export, imports its history, opens and filters imported tickets, detects a repeat and undoes the complete import',guarded(async()=>{
 await page.goto(runtime.origin+base+'/settings')
 await page.getByRole('link',{name:'Move in existing support history',exact:true}).click()
 await page.getByRole('heading',{name:'Move in',exact:true}).waitFor()
 await vendorJourney(1440,'zendesk')
}))
