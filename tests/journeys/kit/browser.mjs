import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {chromium} from 'playwright'

// Headless Chromium with the default arguments plus a mock keychain, so a local run never touches the login keychain.
export const launchBrowser=()=>chromium.launch({headless:true,...((process.env.H2H_CHROMIUM_PATH||process.env.H2H_CHROMIUM_EXECUTABLE_PATH)?{executablePath:(process.env.H2H_CHROMIUM_PATH||process.env.H2H_CHROMIUM_EXECUTABLE_PATH)}:{}),args:['--use-mock-keychain','--password-store=basic',...((process.env.H2H_CHROMIUM_PATH||process.env.H2H_CHROMIUM_EXECUTABLE_PATH)?['--no-sandbox']:[])]})
export const viewports={desktop:{width:1440,height:900},mobile:{width:390,height:844}}
// Screenshots and receipts go to the CI evidence directory, or test-results locally.
export async function evidence(name){const directory=resolve(process.env.H2H_EVIDENCE_DIR||'test-results',name);await mkdir(directory,{recursive:true});return file=>join(directory,file)}

// Audit the screens a surviving journey actually uses; no generated viewport matrix.
export async function auditPage(page,path){
 await page.addScriptTag({path:resolve('node_modules/axe-core/axe.min.js')})
 const violations=await page.evaluate(async()=>(await window.axe.run()).violations.filter(v=>['serious','critical'].includes(v.impact)).map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})))
 assert.deepEqual(violations,[],'no serious or critical accessibility violations')
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'screen fits its viewport')
 if(path)await page.screenshot({path,fullPage:true})
}
