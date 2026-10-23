import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createRuntime} from '../emitted-runtime.mjs';
import {post} from '../../first-run/browser-kit.mjs';
import {inspectState,keyboardScroll,assertAudits} from '../../first-run/qualification-kit.mjs';
import {launchBrowser} from '../../journeys/kit/browser.mjs';

export async function dashboardBrowser(){
 const evidence=resolve(process.env.H2H_EVIDENCE_DIR||'test-results/dashboard-first-run');await mkdir(evidence,{recursive:true});
 const runtime=await createRuntime(),records=[],checks=[],failures=[];let success=false,browser;
 const run=async(name,fn)=>{try{checks.push({name,...await fn()});}catch(error){failures.push({name,error:error.message});}};
 try{
  browser=await launchBrowser();
  const password=randomBytes(24).toString('base64url'),owner=await post(runtime.origin,'/api/identity/bootstrap',{name:'Route workspace',ownerName:'Route operator',email:'routes@example.test',password,allowedOrigin:runtime.origin});
  const second=await post(runtime.origin,'/api/management/projects',{name:'Second route workspace',allowed_origin:runtime.origin},owner.token);
  for(const width of [1440,390]){
   const context=await browser.newContext({viewport:{width,height:844},bypassCSP:true,permissions:['clipboard-read','clipboard-write']}),page=await context.newPage();page.setDefaultTimeout(12000);
   await context.addCookies([{name:'h2h_session',value:owner.token,url:runtime.origin}]);
   try{
    await page.goto(runtime.origin+`/projects/${owner.projectId}/reports`);await page.getByRole('heading',{name:'Daily volume',exact:true}).waitFor();
    await page.getByLabel('Range',{exact:true}).selectOption('90');await page.getByRole('button',{name:'Apply range',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.reports-daily li').length===90);
    await inspectState(page,records,evidence,`${width}-reports-90-days`);
    await run(`${width}-reports-keyboard`,()=>keyboardScroll(page,page.locator('.reports-daily'),'Daily volume'));
    await page.goto(runtime.origin+`/projects/${owner.projectId}/widget-settings`);await page.getByRole('heading',{name:'Install the widget',exact:false}).waitFor();
    await run(`${width}-advanced-verification`,async()=>{
     await page.locator('.widget-code__advanced > summary').click();
     await page.getByRole('button',{name:'Reveal server secret',exact:true}).click();
     const secret=await page.locator('.widget-code__secret-value code').textContent();assert.ok(/^[a-f0-9]{64}$/.test(secret));
     await page.getByRole('button',{name:'Copy server secret',exact:true}).click();
     await page.waitForFunction(async secret=>await navigator.clipboard.readText()===secret,secret);
     await page.getByRole('button',{name:'Hide server secret',exact:true}).click();assert.ok((await page.locator('.widget-code__secret-value code').textContent()).includes('•'));
     const languages=['PHP','Node.js','Python','Ruby','Go','C#'];
     for(const language of languages){
      const tab=page.getByRole('tab',{name:language,exact:true});await tab.click();assert.equal(await tab.getAttribute('aria-selected'),'true');
      const code=await page.locator('#widget-code-verification-example pre').innerText();assert.equal(code.includes(secret),false);
      await page.getByRole('button',{name:`Copy ${language} verification example`,exact:true}).click();await page.waitForFunction(async code=>await navigator.clipboard.readText()===code,code);
     }
     return {languages:6,revealCopyHide:true,clientSecretDisclosures:0};
    });
    const navigation=page.getByRole('navigation',{name:'Main navigation'});
    await navigation.getByRole('button',{name:/Switch workspace:/}).click();await navigation.getByRole('button',{name:'Second route workspace',exact:true}).click();
    await page.getByRole('button',{name:'Switch workspace: Second route workspace',exact:true}).waitFor();assert.ok(new URL(page.url()).pathname.includes(second.id));
    await page.reload();await page.getByRole('button',{name:'Switch workspace: Second route workspace',exact:true}).waitFor();await inspectState(page,records,evidence,`${width}-switched-reloaded`);
    await page.goto(runtime.origin+`/projects/${owner.projectId}/conversations`);const start=page.locator('[data-testid="inbox-start"]:visible');await start.getByTestId('inbox-demo').waitFor();
    assert.ok((await start.getByTestId('inbox-setup-link').getAttribute('href')).endsWith('/activation'));
    await start.getByTestId('inbox-primary-action').click();await page.waitForURL('**/widget-settings');await page.getByRole('heading',{name:'Widget',level:1}).waitFor();
    await page.goto(runtime.origin+`/projects/${owner.projectId}/conversations`);await start.getByTestId('inbox-demo').waitFor();
    await inspectState(page,records,evidence,`${width}-empty-actions`);
    // Observe the genuine enabled transition frame by frame; never pause motion,
    // change styles, or settle past unreadable intermediate frames.
    await page.evaluate(()=>{
     window.__demoFrames=[];window.__demoSampling=true;
     const sample=()=>{const button=document.querySelector('.demo-workspace-banner button');if(button&&!button.disabled){const style=getComputedStyle(button);window.__demoFrames.push({color:style.color,background:style.backgroundColor,opacity:style.opacity});}if(window.__demoSampling)requestAnimationFrame(sample)};requestAnimationFrame(sample);
    });
    await page.getByRole('button',{name:'Try a demo inbox',exact:true}).click();await page.waitForURL(/\/projects\/demo-[^/]+\/conversations/);
    await page.getByRole('button',{name:'Back to your workspace',exact:true}).waitFor();await page.locator('.demo-workspace-banner button:not(:disabled)').waitFor();
    await inspectState(page,records,evidence,`${width}-demo-from-empty`);
    const frames=await page.evaluate(()=>{window.__demoSampling=false;return window.__demoFrames});
    await writeFile(join(evidence,`${width}-demo-frames.json`),JSON.stringify(frames,null,2));
    await run(`${width}-demo-transition`,async()=>{
     assert.ok(frames.length>0);
     const rgb=color=>color.match(/[\d.]+/g).map(Number),lum=values=>values.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0);
     for(const frame of frames){const fg=rgb(frame.color),bg=rgb(frame.background),alpha=(bg[3]??1)*Number(frame.opacity),effective=bg.slice(0,3).map(v=>v*alpha+255*(1-alpha)),a=lum(fg),b=lum(effective);assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,'enabled demo return text stays readable through every observed frame');}
     return {enabledFrames:frames.length};
    });
    await page.getByRole('button',{name:'Back to your workspace',exact:true}).click();await page.waitForURL(new RegExp('/projects/'+owner.projectId+'/conversations'));
   }finally{await context.close();}
  }
  await writeFile(join(evidence,'checks.json'),JSON.stringify({checks,failures},null,2));assertAudits(records);assert.deepEqual(failures,[]);success=true;console.log(`Dashboard: ${records.length} axe audits and ${checks.length} journeys at 1440/390 passed.`);
 }finally{await writeFile(join(evidence,'checks.json'),JSON.stringify({checks,failures},null,2));await browser?.close();await runtime.close(success);}
}
