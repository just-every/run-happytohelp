import {readFile,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chromium} from '/home/agent/rer-consolidation/work/hh-stranger3-docs-1/repo/node_modules/playwright/index.mjs';
const packet='/home/agent/rer-consolidation/work/hh-stranger3-docs-1/packet';
const log=await readFile(process.env.HH_DEV_LOG||'/tmp/hh-dev-private.log','utf8');
const url=log.split('\n').findLast(l=>l.includes('RER_OPEN ')).match(/https?:\/\/[^\s"]+/)[0];
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
const phase=process.argv[2]||'before',prefix=process.env.HH_PROOF_PREFIX||phase;
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.setDefaultTimeout(20000);
 await page.goto(url);await page.waitForURL(/projects\//,{timeout:60000});
 const origin=new URL(page.url()).origin,p=page.url().match(/projects\/([^/]+)/)[1];
 await writeFile('/tmp/hh-project.json',JSON.stringify({origin,projectId:p}));
 await page.goto(`${origin}/projects/${p}/widget-settings`);await page.getByRole('tab',{name:'Settings',exact:true}).click();
 await page.getByLabel('Require email',{exact:true}).waitFor();
 console.log('helper',await page.locator('.settings-note').allTextContents());
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.getByLabel('Require email',{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:`${packet}/${prefix}-widget-settings-${width}.png`,fullPage:true});}
 console.log('requireEmail',await page.getByLabel('Require email',{exact:true}).isChecked());
 if(phase==='after'){
  await page.setViewportSize({width:1440,height:1000});
  await page.getByLabel('Require email',{exact:true}).uncheck();await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByRole('status').filter({hasText:'Saved.'}).waitFor();
  await page.reload();await page.getByRole('tab',{name:'Settings',exact:true}).click();assert.equal(await page.getByLabel('Require email',{exact:true}).isChecked(),false,'explicit saved off survives reload');
  await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByRole('status').filter({hasText:'Saved.'}).waitFor();await page.reload();await page.getByRole('tab',{name:'Settings',exact:true}).click();assert.equal(await page.getByLabel('Require email',{exact:true}).isChecked(),false,'saving without edits preserves off');
  await page.getByLabel('Require email',{exact:true}).check();await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByRole('status').filter({hasText:'Saved.'}).waitFor();
  console.log('savedChoiceRetained true; restored fresh ask true');
 }
 if(process.argv.includes('--inspect'))console.log((await page.locator('body').innerText()).slice(0,6000));
 await writeFile(`${packet}/${prefix}-widget.json`,JSON.stringify({phase,sourceHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),savedChoiceRetained:phase==='after',requireEmail:await page.getByLabel('Require email',{exact:true}).isChecked(),helper:await page.locator('.settings-note').allTextContents()},null,2));
}finally{await browser.close()}
