import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createRuntime} from '/home/agent/rer-consolidation/work/hh-stranger3-docs-1/repo/tests/helpers/emitted-runtime.mjs';
import {chromium} from '/home/agent/rer-consolidation/work/hh-stranger3-docs-1/repo/node_modules/playwright/index.mjs';
const packet='/home/agent/rer-consolidation/work/hh-stranger3-docs-1/packet';
const runtime=await createRuntime({vars:{H2H_LOCAL:'true',EMAIL_PROVIDER:'development'}});
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
let passed=false;
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),rows=[];
 for(const [slug,selector,needle] of [['install','.docs-prose li','Fresh installs ask widget visitors'],['reports','.docs-prose p','Incoming tickets were created']]){
  const response=await page.goto(runtime.origin+'/docs/'+slug);assert.equal(response.status(),200);await page.locator('.docs-prose').waitFor();
  const target=page.locator(selector).filter({hasText:needle}).last();await target.waitFor();rows.push({slug,status:response.status(),visibleText:await target.innerText()});
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await target.scrollIntoViewIfNeeded();await page.screenshot({path:`${packet}/after-docs-${slug}-${width}.png`});}
 }
 await writeFile(`${packet}/docs-browser-receipt.json`,JSON.stringify({sourceHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),builtFromCurrentSavedSource:true,browser:'/usr/bin/chromium',widths:[1440,390],pages:rows},null,2)+'\n');
 console.log('Published install and reports docs: 200; screenshots 1440 and 390.');passed=true;
}finally{await browser.close();await runtime.close(passed)}
