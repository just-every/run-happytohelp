import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,chmod} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {createRuntime} from '../emitted-runtime.mjs';
import {freePort,post} from '../../first-run/browser-kit.mjs';
import {inspectState,keyboardScroll,assertAudits} from '../../first-run/qualification-kit.mjs';
import {profileEffects,assertProfileReloadEffects} from '../../first-run/profile-effects.mjs';
import {launchBrowser} from '../../journeys/kit/browser.mjs';

export async function profileBrowser(){
 const evidence=resolve(process.env.H2H_EVIDENCE_DIR||'test-results/visitor-profile');await mkdir(evidence,{recursive:true});
 const port=await freePort(),origin=`http://127.0.0.1:${port}`;
 const runtime=await createRuntime({port,inspectorPort:0,vars:{H2H_LOCAL:'true',APP_ORIGIN:origin},outboundFixture:new URL('../mail-provider-network.mjs',import.meta.url).href});
 const records=[],checks=[],failures=[];let success=false,browser;
 const run=async(name,fn)=>{try{checks.push({name,...await fn()});}catch(error){failures.push({name,error:error.message});}};
 const api=async(path,token,body)=>{const response=await fetch(origin+path,{method:body?'POST':'GET',headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});assert.ok(response.ok,'Native request '+path+' returned '+response.status);return response.json();};
 // Change trusted private installation configuration, then restart the same
 // emitted Worker and D1 state. No request header or app fallback selects mail.
 async function mailMode(mode){
  const path=join(runtime.directory,'wrangler.json'),config=JSON.parse(await readFile(path,'utf8'));
  config.vars=mode==='local'?{EMAIL_PROVIDER:'development',EMAIL_FROM:'support@localhost.test'}:mode==='remote'?{EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'synthetic-fixture-mail-provider',EMAIL_FROM:'support@example.test'}:{};
  await chmod(path,0o600);await writeFile(path,JSON.stringify(config),{mode:0o600});await runtime.restart();
 }
 try{
  browser=await launchBrowser();
  const owner=await post(origin,'/api/identity/bootstrap',{name:'Profile workspace',ownerName:'Profile operator',email:'profile-owner@example.test',password:randomBytes(24).toString('base64url'),allowedOrigin:origin});
  const project=await api('/api/identity/projects/'+owner.projectId,owner.token);
  for(const startingMode of ['remote']){
   await mailMode(startingMode);
   for(const width of [1440,390]){
    const context=await browser.newContext({viewport:{width,height:844},bypassCSP:true}),page=await context.newPage();page.setDefaultTimeout(12000);
    try{
     const mount=async(reload=false)=>{if(reload)await page.reload();else await page.goto(origin+'/help/'+owner.projectId);await page.addScriptTag({url:origin+'/widget.js'});const ping=page.waitForResponse(response=>response.url().endsWith('/widget-events')&&response.request().postDataJSON()?.action==='pingActive');await page.evaluate(options=>window.h2h('init',options),{widgetKey:project.widget_key,apiOrigin:origin,open:true,settings:{collector:{enabled:false}}});assert.equal((await ping).status(),200);await page.locator('textarea[name=content]').waitFor();};
     await mount();const key=`rer-widget:${origin}:${project.widget_key}`;
     await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key)||'null')?.conversationId,key);
     const session=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);
     const submitted=page.waitForResponse(response=>response.url().endsWith(`/conversations/${session.conversationId}/messages`)&&response.request().method()==='POST');
     await page.locator('textarea[name=content]').fill('Please retain my saved details '+width+' '+startingMode);await page.locator('button[name=submit]').click();
     await page.locator('.happytohelp-collect-notify-email').waitFor();
     assert.match(await page.locator('.happytohelp-collect-notify-email').innerText(),/Receive an email/);
     const email=`saved-${startingMode}-${width}@example.test`;
     await page.locator('input[name=email]').fill(email);await page.locator('textarea[name=content]').click();
     await page.locator('.happytohelp-message-show-contact-container').getByText(email,{exact:true}).waitFor();
     // Optimistic transcript and profile UI can precede the request's notice.
     // The customer POST settles its mail/model/notification work before replying.
     const submission=await submitted;assert.equal(submission.status(),200);assert.equal((await submission.json()).accepted,true);
     const before=await api('/api/conversations/'+session.conversationId+'/messages',session.token),beforeEffects=await profileEffects(runtime,session.contactId,email);
     checks.push({name:`${startingMode}-${width}-saved-email-persisted`,savedInRealD1:true});
     await run(`${startingMode}-${width}-saved-profile-reload`,async()=>{
      await mount(true);await page.getByText('Please retain my saved details '+width+' '+startingMode,{exact:true}).waitFor();
      await page.locator('.happytohelp-message-show-contact-container').getByText(email,{exact:true}).waitFor();
      assert.equal(await page.locator('.happytohelp-collect-notify-email').count(),0);
      await page.locator('.happytohelp-message-show-contact-container button').click();assert.equal(await page.locator('input[name=email]').inputValue(),email);
      const stored=await page.evaluate(key=>localStorage.getItem(key),key);assert.equal(stored.includes(email),false,'saved profile email is not browser-cached');
      const after=JSON.parse(stored);assert.equal(after.contactId,session.contactId);assert.equal(after.conversationId,session.conversationId);assert.equal(after.token===session.token,true,'reload retains the owning visitor capability');
      assert.deepEqual((await api('/api/conversations/'+session.conversationId+'/messages',session.token)).messages,before.messages);
      assertProfileReloadEffects(await profileEffects(runtime,session.contactId,email),beforeEffects,'reload preserves saved contact and causes no mail, model, or notification effects');
      await inspectState(page,records,evidence,`${startingMode}-${width}-saved-reloaded`);
      return {sameContact:true,sameConversation:true,sameVisitorSession:true,sameTranscript:true,emailHydrated:true,emailCached:false,reloadSideEffects:0};
     });
     // Mail is intentionally unavailable during operator sends: this browser
     // check must never contact a remote provider with its synthetic config.
     await mailMode('unavailable');
     // Real operator messages create genuine transcript overflow; no DOM fixture.
     for(let index=0;index<24;index++){
      const transcript=await api('/api/conversations/'+session.conversationId+'/messages',owner.token);
      await api('/api/conversations/'+session.conversationId+'/messages',owner.token,{localId:`profile-${startingMode}-${width}-${index}`,content:`Update ${index+1}: This genuine support message remains available through keyboard scrolling and reload.`,expectedRevision:transcript.revision,expectedLastMessageId:transcript.lastMessageId});
     }
     await page.getByText('Update 24: This genuine support message remains available through keyboard scrolling and reload.',{exact:true}).waitFor();
     await inspectState(page,records,evidence,`${startingMode}-${width}-transcript`);
     await run(`${startingMode}-${width}-keyboard-transcript`,()=>keyboardScroll(page,page.locator('.happytohelp-chatlist-container'),'Conversation transcript'));
     for(const mode of ['unavailable','local',startingMode]){
      await mailMode(mode);
      await run(`${startingMode}-${width}-toggle-${mode}`,async()=>{
       const beforeEffects=await profileEffects(runtime,session.contactId,email);
       await mount(true);await page.getByText('Update 24: This genuine support message remains available through keyboard scrolling and reload.',{exact:true}).waitFor();
       await page.locator('.happytohelp-message-show-contact-container').getByText(email,{exact:true}).waitFor();assert.equal(await page.locator('.happytohelp-collect-notify-email').count(),0);
       const stored=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);assert.equal(stored.contactId,session.contactId);assert.equal(stored.conversationId,session.conversationId);assert.equal(stored.token===session.token,true);
       assertProfileReloadEffects(await profileEffects(runtime,session.contactId,email),beforeEffects);
       await inspectState(page,records,evidence,`${startingMode}-${width}-toggle-${mode}`);return {sameContact:true,emailHydrated:true};
      });
     }
    }finally{await context.close();}
   }
  }
  await writeFile(join(evidence,'checks.json'),JSON.stringify({checks,failures},null,2));assertAudits(records);assert.deepEqual(failures,[]);success=true;console.log(`Visitor profile: ${checks.length} journeys, ${records.length} axe audits at 1440/390 passed.`);
 }finally{await writeFile(join(evidence,'checks.json'),JSON.stringify({checks,failures},null,2));await browser?.close();await runtime.close(success);}
}
