import {createServer} from 'node:http';
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {widgetFailedSendBrowser} from '../widget-failed-send-browser.mjs';
import {widgetRecoveryBrowser} from '../widget-recovery-browser.mjs';
import {awayWidget} from './away.mjs';
import {launchBrowser} from '../../journeys/kit/browser.mjs'

// The installed widget on a separate site origin against the emitted Worker: current and legacy installs and
// open modes, a failed send and its recovery, after hours (away.mjs), and a foreign conversation refused.
export async function installedWidget({api,origin,widgetKey,ownerToken,projectId,foreignConversation,evidence}){

if(!api||!origin||!widgetKey||!ownerToken)throw new Error('WIDGET_TEST_API, WIDGET_TEST_ORIGIN, WIDGET_TEST_KEY, WIDGET_TEST_OWNER_TOKEN required');
if(!['localhost','127.0.0.1'].includes(new URL(origin).hostname))throw new Error('Browser fixture host must be local');

const storageKey=`rer-widget:${api}:${widgetKey}`;
const server=createServer((req,res)=>{
 res.setHeader('Content-Type','text/html; charset=utf-8');
 const mode=new URL(req.url,origin).searchParams.get('legacy');
 const options={projectId:projectId,selector:'.launch-chat',settings:{collector:{enabled:false}}};
 const legacy=mode==='queue'?`<script>window.h2hQueue=[];function h2h(){h2hQueue.push(arguments)}h2h('init',${JSON.stringify(options)});h2h('close');h2h('open');h2h('update',{name:'Maya Chen',email:'maya@example.test',identifier:'legacy-maya',hash:'legacy-proof-requires-native-verification',metadata:{plan:'annual'},metadataHash:'legacy-metadata-proof'});</script><script src="${api}/widget.js"></script>`:
 mode==='consent'?`<script>window.h2hQueue=[];function h2h(){h2hQueue.push(arguments)}h2h('init',${JSON.stringify({...options,await_consent:true})});</script><script src="${api}/widget.js"></script>`:
 mode==='hascontext'?`<script>window.hasContextQueue=[];function hasContext(){hasContextQueue.push(arguments)}hasContext('init',${JSON.stringify(options)});</script><script src="${api}/widget.js"></script>`:
 mode?`<script src="${api}/widget.js" ${mode==='config'?`data-config="{'project_id':'${options.projectId}'}"`:`${mode}="${options.projectId}"`} data-api-origin="${api}"></script>`:null;
 res.end(`<html><head><meta charset="utf-8"></head><body style="background:#eee"><h1>Independent host page</h1><a class="launch-chat" href="#launch-chat">Contact support</a>${legacy||`<script src="${api}/widget.js"></script><script>h2h("init",${JSON.stringify({widgetKey,apiOrigin:api,open:true,settings:{collector:{enabled:false}}})})</script>`}</body></html>`);
});
await new Promise(resolve=>server.listen(Number(new URL(origin).port),new URL(origin).hostname,resolve));
const browser=await launchBrowser(),context=await browser.newContext({viewport:{width:1000,height:800}}),page=await context.newPage();const errors=[],failed=[];
page.on('pageerror',error=>{errors.push(error.message);console.error('BROWSER ERROR',error.stack)});page.on('response',response=>{if(response.status()>=400)failed.push({url:response.url(),status:response.status()});});
try{
 await page.goto(origin);await page.locator('textarea[name=content]').waitFor({state:'visible'});await page.waitForTimeout(600);
 const requestForm=page.getByRole('link',{name:'Submit a request form',exact:true});await requestForm.waitFor();
 assert.equal(await requestForm.getAttribute('href'),`${api}/help/${encodeURIComponent(projectId)}/requests?source=widget`);assert.equal(await requestForm.getAttribute('target'),'_blank');
 await page.locator('textarea[name=content]').fill('Native widget browser message');await page.locator('button[name=submit]').click();
 await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key)||'null')?.conversationId,storageKey);
 const session=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),storageKey);
 const headers={Authorization:`Bearer ${ownerToken}`,'Content-Type':'application/json'};
 let transcript;
 for(let i=0;i<40;i++){transcript=await(await fetch(`${api}/api/conversations/${session.conversationId}/messages`,{headers})).json();if(transcript.messages?.length)break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(transcript.messages[0]?.content,'Native widget browser message');
 const result=await(await fetch(`${api}/api/conversations/${session.conversationId}/messages`,{method:'POST',headers,body:JSON.stringify({localId:'operator-browser-proof',content:'Native operator socket reply',expectedRevision:transcript.revision,expectedLastMessageId:transcript.lastMessageId})})).json();assert.equal(result.accepted,true);
 await page.getByText('Native operator socket reply',{exact:true}).waitFor();
 await page.locator('input[type=file]').setInputFiles({name:'widget-proof.txt',mimeType:'text/plain',buffer:Buffer.from('Native attachment bytes')});
 await page.locator('textarea[name=content]').fill('Attachment from widget');await page.locator('button[name=submit]').click();
 await page.waitForTimeout(700);
 const before=await(await fetch(`${api}/api/conversations/${session.conversationId}/messages`,{headers})).json();assert.equal(before.messages.at(-1).media.length,1);
 const media=before.messages.at(-1).media[0];const downloaded=await fetch(`${api}/api/conversations/${session.conversationId}/media/${media.id}`,{headers});assert.equal(await downloaded.text(),'Native attachment bytes');
 await page.reload();await page.getByText('Native operator socket reply',{exact:true}).waitFor();await page.getByText('Attachment from widget',{exact:true}).waitFor();
 const resumed=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),storageKey);assert.equal(resumed.contactId,session.contactId);assert.equal(resumed.conversationId,session.conversationId);
 await context.setOffline(true);await page.waitForTimeout(200);await context.setOffline(false);await page.waitForTimeout(2500);
 const after=await(await fetch(`${api}/api/conversations/${session.conversationId}/messages`,{headers})).json();assert.equal(after.messages.length,before.messages.length);
 assert.equal(await page.locator('h1').textContent(),'Independent host page');
 const denied=await fetch(`${api}/api/widget/settings?widgetKey=${encodeURIComponent(widgetKey)}`,{headers:{Origin:'https://untrusted.example'}});assert.equal(denied.status,403);
 const foreign=await fetch(`${api}/api/conversations/${foreignConversation}/messages`,{headers:{Authorization:`Bearer ${session.token}`,Origin:origin}});assert.equal(foreign.status,404);
 await page.locator('input[name=email]').fill('visitor-updated@example.test');await page.locator('input[name=email]').press('Enter');await page.waitForTimeout(300);
 const updatedContact=await(await fetch(`${api}/api/management/projects/${session.projectId}/contacts/${session.contactId}`,{headers})).json();assert.equal(updatedContact.data.email,'visitor-updated@example.test');
 const browserContext=await page.evaluate(()=>({timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,language:navigator.language,user_agent:navigator.userAgent}));
 const observedContext=JSON.parse(updatedContact.data.metadata_json);
 assert.equal(observedContext.timezone,browserContext.timezone);assert.equal(observedContext.language,Intl.getCanonicalLocales(browserContext.language)[0]);assert.equal(observedContext.user_agent,browserContext.user_agent);assert.ok(Number.isFinite(new Date(observedContext.last_seen_at).getTime()));

 await page.setViewportSize({width:1440,height:900});await page.screenshot({path:`${evidence}/desktop.png`});
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(300);
 const panel=await page.locator('.happytohelp-interact').boundingBox();assert.ok(panel.width<=390);await page.screenshot({path:`${evidence}/mobile.png`});
 assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);
 const recoveryChecks=await widgetRecoveryBrowser({browser,origin,api,widgetKey,ownerToken});
 const failedSendChecks=await widgetFailedSendBrowser({browser,origin,api,widgetKey,ownerToken,evidence});
 const awayChecks=projectId?await awayWidget({browser,origin,api,ownerToken,projectId,evidence}):[];
 if(projectId){
  const legacyContext=await browser.newContext({viewport:{width:1440,height:900}}),legacyPage=await legacyContext.newPage();
  legacyPage.on('pageerror',error=>errors.push(error.message));
  for(const mode of ['queue','data-project','data-projectId','data-project-id','config','hascontext']){
   const apiName=mode==='hascontext'?'hasContext':'h2h';
   await legacyPage.goto(`${origin}/?legacy=${mode}#launch-chat`);
   await legacyPage.locator('textarea[name=content]').waitFor({state:'visible'});
   await legacyPage.waitForFunction(key=>JSON.parse(localStorage.getItem(key)||'null')?.conversationId,storageKey);
   const legacySession=await legacyPage.evaluate(key=>JSON.parse(localStorage.getItem(key)),storageKey);
   assert.equal(legacySession.projectId,projectId);
   assert.equal(legacySession.verified,false);
   await legacyPage.evaluate(name=>window[name]('close'),apiName);
   await legacyPage.locator('#happytohelp-root.happytohelp-closed').waitFor({state:'attached'});
   await legacyPage.locator('textarea[name=content]').waitFor({state:'hidden'});
   await legacyPage.locator('.launch-chat').click();
   await legacyPage.locator('#happytohelp-root.happytohelp-opened').waitFor({state:'attached'});
   await legacyPage.locator('textarea[name=content]').waitFor({state:'visible'});
   await legacyPage.evaluate(name=>window[name]('settings',{text:{message:{placeholder_message_chat:'Ask the team'}}}),apiName);
   if(mode==='queue'){
    const configurationError=await legacyPage.evaluate(async()=>{try{await h2h('ask',{message:'Can the assistant answer?'});return null}catch(error){return {message:error.message,status:error.status,code:error.code}}});
    assert.equal(configurationError?.status,503);assert.equal(configurationError?.code,'CONFIGURATION_REQUIRED');assert.match(configurationError.message,/^CONFIGURATION_REQUIRED:/);
    await legacyPage.locator('textarea[name=content]').fill('Can I keep my existing ChargeDesk support link?');
    await legacyPage.locator('button[name=submit]').click();
    await legacyPage.getByText('Can I keep my existing ChargeDesk support link?',{exact:true}).waitFor();
    await legacyPage.screenshot({path:`${evidence}/legacy-widget-1440.png`});
    await legacyPage.setViewportSize({width:390,height:844});
    await legacyPage.screenshot({path:`${evidence}/legacy-widget-390.png`});
    await legacyPage.setViewportSize({width:1440,height:900});
   }
  }
  const requests=[];legacyPage.on('request',request=>{if(request.url().startsWith(api+'/api/'))requests.push(request.url())});
  await legacyPage.goto(`${origin}/?legacy=consent#launch-chat`);await legacyPage.waitForTimeout(150);
  assert.deepEqual(requests,[],'consent gate starts no native network activity');
  await legacyPage.evaluate(()=>h2h('consent',{provided:true}));
  await legacyPage.locator('textarea[name=content]').waitFor({state:'visible'});
  assert.ok(requests.some(url=>url.includes('/api/widget/legacy-project')));
  await legacyPage.evaluate(()=>h2h('consent',{provided:false}));
  await legacyPage.locator('#happytohelp-root').waitFor({state:'detached'});
  await legacyPage.evaluate(()=>h2h('consent',{provided:true}));
  await legacyPage.locator('textarea[name=content]').waitFor({state:'visible'});
  await legacyPage.reload();await legacyPage.evaluate(()=>h2h('consent',{provided:true}));
  await legacyPage.getByText('Can I keep my existing ChargeDesk support link?',{exact:true}).waitFor();
  await legacyContext.close();assert.deepEqual(errors,[]);
 }
 const proof={checks:[...recoveryChecks,...failedSendChecks,...awayChecks,...(projectId?['legacy project resolver and queued init/open/close/settings/update','three legacy script attribute spellings and data-config','launch-chat initial fragment and repeated link opening','consent makes no requests before grant; revoke/remount resumes native conversation','legacy signatures never become verified native authority']:[]),'cross-origin settings/session CORS','Shadow DOM host isolation','widget message durable','operator socket delivery','attachment upload/authenticated download','reload identity/transcript resume','offline reconnect no duplicate','untrusted origin denied','cross-project transcript denied','contact form update','browser timezone/language and observed device context survive reload with collector disabled','mobile panel within viewport'],errors,failed,conversationId:session.conversationId,messages:after.messages.length};
 await writeFile(`${evidence}/browser.json`,JSON.stringify(proof,null,2));
}catch(error){await page.screenshot({path:`${evidence}/failed-attempt.png`});throw error;}finally{await browser.close();server.close();}

}
