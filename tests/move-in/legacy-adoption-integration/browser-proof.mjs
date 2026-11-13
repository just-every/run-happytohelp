import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createRuntime} from '../../helpers/emitted-runtime.mjs'
import {launchBrowser} from '../../journeys/kit/browser.mjs'
import {legacyPackageBrowserFlow} from './browser.mjs'
export async function browserProof(){
 const root=resolve(process.env.H2H_EVIDENCE_DIR||'test-results/legacy-adoption'),shots=join(root,'screens');await mkdir(shots,{recursive:true})
 const runtime=await createRuntime({queueConsumers:true}),browser=await launchBrowser(),page=await browser.newPage({viewport:{width:1440,height:1000},bypassCSP:true}),checks=[],errors=[]
 let success=false
 try{
  const owner={email:'synthetic-browser-owner@example.test',password:'Synthetic browser password 42!'},r=await fetch(runtime.origin+'/api/identity/bootstrap',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...owner,name:'Synthetic historical support',allowedOrigin:runtime.origin})})
  assert.equal(r.status,201,await r.clone().text());const {projectId:project}=await r.json()
  page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(20000)
  await page.goto(runtime.origin+'/login?returnTo='+encodeURIComponent(`/projects/${project}/conversations`));await page.getByLabel('Email',{exact:true}).fill(owner.email);await page.getByLabel('Password',{exact:true}).fill(owner.password);await page.getByRole('button',{name:'Login',exact:true}).click();await page.waitForURL('**/conversations')
  const axe=await readFile(new URL('../../../node_modules/axe-core/axe.min.js',import.meta.url),'utf8')
  const inspect=async name=>{
   if(name.includes('approved'))await page.getByRole('button',{name:'Renew owner approval',exact:true}).focus()
   const originalWidth=page.viewportSize().width
   for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))
    if(name.includes('history-assignment')){const show=page.getByRole('button',{name:'Show conversation panel',exact:true});if(await show.isVisible())await show.click();await page.getByRole('tab',{name:'Ticket',exact:true}).click();await page.getByText('Historical assignee: Retired billing manager',{exact:true}).scrollIntoViewIfNeeded()}
    if(name.includes('history-collapsed')||name.includes('history-expanded'))await page.locator('#conversation-assistant').waitFor({state:'hidden'})
    await page.addScriptTag({content:axe})
    const result=await page.evaluate(async()=>{const r=await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return {width:innerWidth,violations:r.violations.filter(v=>['serious','critical'].includes(v.impact)).map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})),overflow:document.documentElement.scrollWidth>innerWidth+1}})
    const targets=await page.locator('.legacy-package button,.legacy-package input[type=file]').evaluateAll(elements=>elements.filter(e=>e.getClientRects().length).map(e=>({label:e.textContent||e.getAttribute('aria-label')||e.id,height:e.getBoundingClientRect().height})));assert.ok(targets.every(t=>t.height>=44));result.targets=targets
    assert.deepEqual(result.violations,[]);assert.equal(result.overflow,false)
    const label=name.replace(/1440$/,String(width))
    await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:join(shots,label+'.png'),fullPage:true,animations:'disabled'})
    const region=page.getByRole('region',{name:'Source history reconciliation',exact:true})
    if(await region.count()){
     await region.focus();assert.equal(await region.evaluate(e=>e===document.activeElement),true)
     assert.equal(await region.evaluate(e=>getComputedStyle(e).outlineStyle),'solid')
     await region.evaluate(e=>{e.scrollLeft=0});await region.press('End');for(let n=0;n<8;n++)await region.press('ArrowRight');
     await page.waitForFunction(()=>{const e=document.querySelector('.legacy-result .legacy-table-scroll');return e.scrollWidth<=e.clientWidth||e.scrollLeft>0})
     result.table=await region.evaluate(e=>({width:e.clientWidth,scrollWidth:e.scrollWidth,scrollLeft:e.scrollLeft,focused:e===document.activeElement}))
     if(width===390)assert.ok(result.table.scrollLeft>0,'keyboard reaches the verification columns')
     await region.scrollIntoViewIfNeeded();await page.screenshot({path:join(shots,label+'-table-focus.png'),animations:'disabled'})
    }
    for(const [section,selector] of [['destination','.legacy-adoption'],['result','.legacy-result'],['authors','.buckets']]){
     const target=page.locator(selector).first();if(await target.count()&&await target.isVisible()){await target.scrollIntoViewIfNeeded();await page.screenshot({path:join(shots,label+'-'+section+'.png'),animations:'disabled'})}
    }
    checks.push({name:label,...result})
   }
   await page.setViewportSize({width:originalWidth,height:1000})
  }
  await legacyPackageBrowserFlow({page,runtime,project,inspect})
  assert.deepEqual(errors,[]);success=true;return {checks,errors}
 }finally{await writeFile(join(root,'browser-receipt.json'),JSON.stringify({success,checks,errors},null,2)+'\n');await browser.close();await runtime.close(success)}
}
if(process.argv[1]===new URL(import.meta.url).pathname)console.log(JSON.stringify(await browserProof()))
