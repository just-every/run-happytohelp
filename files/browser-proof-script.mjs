import assert from 'node:assert/strict'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createRuntime} from '/home/agent/rer-consolidation/work/hh-importer-adoption-wire-2/repo/tests/helpers/emitted-runtime.mjs'
import {launchBrowser} from '/home/agent/rer-consolidation/work/hh-importer-adoption-wire-2/repo/tests/journeys/kit/browser.mjs'
import {legacyPackageBrowserFlow} from '/home/agent/rer-consolidation/work/hh-importer-adoption-wire-2/repo/tests/move-in/legacy-adoption-integration/browser.mjs'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {packageFixture} from '/home/agent/rer-consolidation/work/hh-importer-adoption-wire-2/repo/tests/move-in/legacy-adoption-integration/fixture.mjs'
export async function browserProof(){
 const extra=await mkdtemp(join(tmpdir(),'legacy-proof-collision-'))
 const root=resolve(process.env.H2H_EVIDENCE_DIR||'test-results/legacy-adoption'),shots=join(root,'screens');await mkdir(shots,{recursive:true})
 const runtime=await createRuntime({queueConsumers:true}),browser=await launchBrowser(),page=await browser.newPage({viewport:{width:1440,height:1000},bypassCSP:true}),checks=[],errors=[]
 let success=false
 try{
  const owner={email:'synthetic-browser-owner@example.test',password:'Synthetic browser password 42!'},r=await fetch(runtime.origin+'/api/identity/bootstrap',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...owner,name:'Synthetic historical support',allowedOrigin:runtime.origin})})
  assert.equal(r.status,201,await r.clone().text());const {projectId:project}=await r.json()
  page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(20000)
  await page.goto(runtime.origin+'/login?returnTo='+encodeURIComponent(`/projects/${project}/conversations`));await page.getByLabel('Email',{exact:true}).fill(owner.email);await page.getByLabel('Password',{exact:true}).fill(owner.password);await page.getByRole('button',{name:'Login',exact:true}).click();await page.waitForURL('**/conversations')
  const axe=await readFile('/home/agent/rer-consolidation/work/hh-importer-adoption-wire-2/repo/node_modules/axe-core/axe.min.js','utf8')
  const inspect=async name=>{
   if(name.includes('approved'))await page.getByRole('button',{name:'Renew owner approval',exact:true}).focus()
   await page.addScriptTag({content:axe})
   const result=await page.evaluate(async()=>{const r=await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return {width:innerWidth,violations:r.violations.filter(v=>['serious','critical'].includes(v.impact)).map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})),overflow:document.documentElement.scrollWidth>innerWidth+1}})
   const targets=await page.locator('.legacy-package button,.legacy-package input[type=file]').evaluateAll(elements=>elements.filter(e=>e.getClientRects().length).map(e=>({label:e.textContent||e.getAttribute('aria-label')||e.id,height:e.getBoundingClientRect().height})));assert.ok(targets.every(t=>t.height>=44));result.targets=targets
   assert.deepEqual(result.violations,[]);assert.equal(result.overflow,false)
   await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:join(shots,name+'.png'),fullPage:true});checks.push({name,...result})
   if(result.width===1440){await page.setViewportSize({width:390,height:1000});await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:join(shots,name.replace(/1440$/,'390')+'.png'),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.setViewportSize({width:1440,height:1000})}

   if(name==='legacy-queued-1440'){
    await page.getByRole('button',{name:'Stop import',exact:true}).click();await page.getByText(/^stopped ·/).waitFor();await inspect('legacy-stopped-1440')
    await page.getByRole('button',{name:'Resume import',exact:true}).click();await inspect('legacy-worker-resumed-1440')
   }
   if(name==='legacy-replayed-1440'){
    const status=await page.evaluate(async()=>{const sha=new URL(location.href).searchParams.get('legacyPackage'),project=location.pathname.split('/')[2];return (await fetch(`/api/move-in/projects/${project}/legacy-import/${sha}/discard`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status});assert.ok(status>=200&&status<300)
    await page.getByText(/^Source: (invalidated|purging|purged)/).waitFor({timeout:30000});assert.equal(await page.getByRole('button',{name:'Replay verification',exact:true}).count(),0);await inspect('legacy-invalidated-1440')
   }
   if(name==='legacy-policy-refused-1440'){
    const collision=await packageFixture(join(extra,'collision'),project);await page.getByLabel('Export folder',{exact:true}).setInputFiles(collision.root);await page.getByRole('button',{name:/^(Upload package|Continue upload)$/}).click();await page.getByText('All required package files are uploaded.',{exact:false}).waitFor({timeout:120000});await page.getByText('Destination unavailable. Existing workspace data cannot be adopted or overwritten.',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Approve this destination',exact:true}).isDisabled(),true);await inspect('legacy-adoption-refused-1440')
   }
  }
  await legacyPackageBrowserFlow({page,runtime,project,inspect})
  assert.deepEqual(errors,[]);success=true;return {checks,errors}
 }finally{await writeFile(join(root,'browser-receipt.json'),JSON.stringify({success,checks,errors},null,2)+'\n');await browser.close();await runtime.close(success);await rm(extra,{recursive:true,force:true})}
}
if(process.argv[1]===new URL(import.meta.url).pathname)console.log(JSON.stringify(await browserProof()))
