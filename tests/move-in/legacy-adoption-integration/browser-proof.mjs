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
   await page.addScriptTag({content:axe})
   const result=await page.evaluate(async()=>{const r=await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return {width:innerWidth,violations:r.violations.filter(v=>['serious','critical'].includes(v.impact)).map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})),overflow:document.documentElement.scrollWidth>innerWidth+1}})
   assert.deepEqual(result.violations,[]);assert.equal(result.overflow,false)
   await page.screenshot({path:join(shots,name+'.png'),fullPage:true});checks.push({name,...result})
   if(result.width===1440){await page.setViewportSize({width:390,height:1000});await page.screenshot({path:join(shots,name.replace(/1440$/,'390')+'.png'),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.setViewportSize({width:1440,height:1000})}
  }
  await legacyPackageBrowserFlow({page,runtime,project,inspect})
  assert.deepEqual(errors,[]);success=true;return {checks,errors}
 }finally{await writeFile(join(root,'browser-receipt.json'),JSON.stringify({success,checks,errors},null,2)+'\n');await browser.close();await runtime.close(success)}
}
if(process.argv[1]===new URL(import.meta.url).pathname)console.log(JSON.stringify(await browserProof()))
