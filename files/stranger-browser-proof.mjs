import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chromium} from '/home/agent/rer-consolidation/work/hh-stranger3-docs-1/repo/node_modules/playwright/index.mjs';
const packet='/home/agent/rer-consolidation/work/hh-stranger3-docs-1/packet',phase=process.argv[2]||'before',prefix=process.env.HH_PROOF_PREFIX||phase;
const log=await readFile(process.env.HH_DEV_LOG||'/tmp/hh-dev-private.log','utf8'),url=log.split('\n').findLast(l=>l.includes('RER_OPEN ')).match(/https?:\/\/[^\s"]+/)[0];
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
let page;
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}});page=await context.newPage();page.setDefaultTimeout(25000);
 await page.goto(url);await page.waitForURL(/projects\//,{timeout:60000});
 const origin=new URL(page.url()).origin,p=page.url().match(/projects\/([^/]+)/)[1],base=`/api/dashboard/projects/${p}`;
 const api=async(path,body,method=body===undefined?'GET':'POST')=>{const r=await page.request.fetch(origin+path,{method,data:body});assert.ok(r.ok(),`${method} ${path}: ${r.status()} ${(await r.text()).slice(0,200)}`);return r.json()};
 const owner=(await api('/api/management/bootstrap')).currentAgent;
 if(phase==='before'){
 if(!process.argv.includes('--resume')){
  const settings=await api(`/api/management/projects/${p}/widget-settings`),key=(settings.data||settings).widgetKey;
  const visitorContext=await browser.newContext({viewport:{width:1440,height:900}}),visitor=await visitorContext.newPage();
  await visitor.goto(origin+`/help/${p}`);await visitor.addScriptTag({url:origin+'/widget.js'});
  await visitor.evaluate(options=>window.h2h('init',options),{widgetKey:key,apiOrigin:origin,open:true});
  await visitor.locator('textarea[name=content]').waitFor();
  await visitor.locator('textarea[name=content]').fill('Synthetic stranger widget question');
  // Sending opens the required-email collector on this widget.
  if(!await visitor.locator('input[name=email]').isVisible())await visitor.locator('button[name=submit]').click();
  await visitor.locator('input[name=email]').waitFor();
  for(const width of [1440,390]){await visitor.setViewportSize({width,height:900});await visitor.screenshot({path:`${packet}/${prefix}-visitor-email-${width}.png`,fullPage:true});}
  await visitor.locator('input[name=email]').fill('synthetic-stranger@example.test');
  if(await visitor.locator('input[name=name]').isVisible())await visitor.locator('input[name=name]').fill('Synthetic stranger');
  if(await visitor.locator('textarea[name=content]').isVisible())await visitor.locator('textarea[name=content]').fill('Synthetic stranger widget question');
  const submit=visitor.locator('button[name=submit]');if(await submit.isVisible())await submit.click();
  const storageKey=`rer-widget:${origin}:${key}`;
  await visitor.waitForFunction(k=>JSON.parse(localStorage.getItem(k)||'null')?.conversationId,storageKey);
  const session=await visitor.evaluate(k=>JSON.parse(localStorage.getItem(k)),storageKey);
  await api(`${base}/conversations/${session.conversationId}`,{agent_id:owner.id,ai_id:null},'PUT');
  await visitorContext.close();
 }
  await page.goto(`${origin}/projects/${p}/conversations`);
  await page.getByRole('button',{name:'New ticket',exact:true}).click();
  await page.getByLabel('First comment',{exact:true}).selectOption('internal');
  await page.getByLabel('Find requester by name, email or phone').fill('synthetic-stranger@example.test');
  await page.getByRole('button',{name:/synthetic-stranger@example.test/}).click();
  await page.getByLabel('Subject',{exact:true}).fill('Synthetic internal-only ticket');
  await page.getByLabel('Internal note',{exact:true}).fill('Synthetic private work for the existing requester.');
  await page.getByRole('button',{name:'Create ticket',exact:true}).click();
  await page.getByRole('dialog').waitFor({state:'hidden'});
  await page.goto(`${origin}/projects/${p}/conversations`);await page.getByRole('button',{name:'New ticket',exact:true}).click();
  await page.getByLabel('Ticket type').selectOption('call');await page.getByLabel('Requester email',{exact:true}).fill('synthetic-call@example.test');await page.getByLabel('Requester name',{exact:true}).fill('Synthetic call requester');
  await page.getByLabel('Subject',{exact:true}).fill('Synthetic call log');await page.getByLabel('Call notes',{exact:true}).fill('Synthetic phone follow-up. No public message.');
  await page.getByRole('button',{name:'Log call',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});
 }
 await page.goto(`${origin}/projects/${p}/conversations`);
 console.log('inbox', (await page.locator('body').innerText()).slice(0,1700));
 // The ordinary Yours view shows all three assigned work items.
 const yours=page.getByRole('link',{name:/^Yours/});if(await yours.count())await yours.click();
 await page.getByText('Synthetic call log',{exact:false}).first().waitFor();
 await page.screenshot({path:`${packet}/${prefix}-inbox-1440.png`,fullPage:true});
 await page.goto(`${origin}/projects/${p}/reports`);await page.getByRole('heading',{name:'Incoming tickets',exact:true}).waitFor();
 const report=await api(`${base}/reports/team?period=30`);assert.equal(report.denominators.cohort,1);assert.equal(report.backlog.total,1);assert.equal(report.workload.agent.find(r=>r.id===owner.id).incoming,1);
 const receipt={phase,sourceHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),cohort:report.denominators.cohort,backlog:report.backlog.total,ownerWorkload:report.workload.agent.find(r=>r.id===owner.id),scope:await page.locator('.team-report-scope').innerText(),firstResponse:report.breakdowns.agent.find(r=>r.id===owner.id).firstResponse,firstResolution:report.breakdowns.agent.find(r=>r.id===owner.id).firstResolution};
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.screenshot({path:`${packet}/${prefix}-reports-${width}.png`,fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
 await writeFile(`${packet}/${prefix}-reports.json`,JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
} catch(e){if(page){console.log((await page.locator('body').innerText()).slice(-5000));await page.screenshot({path:`${packet}/debug-trip.png`,fullPage:true});}throw e}finally{await browser.close()}
