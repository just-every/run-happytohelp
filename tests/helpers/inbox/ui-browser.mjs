import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createRuntime} from '../emitted-runtime.mjs';
import {verifySettingsParity,verifyManagementParity,verifyMobileNavigation,verifyKnowledgeParity,verifyAssistantParity} from '../ui-parity.mjs';
import {mkdir,mkdtemp} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {launchBrowser} from '../../journeys/kit/browser.mjs'

export async function uiBrowser(){
const evidenceRoot=process.env.H2H_EVIDENCE_DIR?resolve(process.env.H2H_EVIDENCE_DIR):await mkdtemp(join(tmpdir(),'h2h-ui-evidence-'));
const evidenceDir=join(evidenceRoot,'ui-native');
console.log('UI browser evidence:',evidenceDir);
const runtime=await createRuntime();const origin=runtime.origin;let success=false;
const call=async(path,body,token,headers={})=>{const r=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`} :{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});assert.ok(r.ok,`${path}: ${r.status}`);return r.json();};
const f={email:'ui-test@example.test',password:'synthetic-native-ui-test-password-2026'};
const setup=await call('/api/identity/bootstrap',{password:f.password,name:'UI Acceptance Workspace',email:f.email,allowedOrigin:origin});f.projectId=setup.projectId;

const owner=await call('/api/identity/login',{email:f.email,password:f.password});
const project=await call(`/api/identity/projects/${f.projectId}`,undefined,owner.token);
const contact=await call('/api/identity/widget/session',{widgetKey:project.widget_key,name:'Browser Visitor',email:'visitor@example.test'},undefined,{Origin:origin});
const conversation=await call('/api/conversations',{projectId:f.projectId},contact.token);f.conversationId=conversation.id;
await call(`/api/conversations/${f.conversationId}/messages`,{localId:'ui-initial-message',content:'Can you help me update my account?',expectedRevision:0},contact.token);
await mkdir(evidenceDir,{recursive:true});
const browser=await launchBrowser();const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[],failed=[],checks=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)failed.push({status:r.status(),path:new URL(r.url()).pathname});});
try{
 await page.goto(origin+'/login?returnTo='+encodeURIComponent(`/projects/${f.projectId}/conversations`));await page.getByLabel('Email',{exact:true}).fill(f.email);await page.getByLabel('Password',{exact:true}).fill(f.password);await page.getByRole('button',{name:'Login',exact:true}).click();await page.waitForURL('**/conversations');
 await page.goto(`${origin}/projects/${f.projectId}/conversations/${f.conversationId}`);await page.locator('.transcript-message-content').getByText('Can you help me update my account?',{exact:true}).waitFor();
 assert.equal(await page.getByRole('link',{name:'Billing',exact:true}).count(),0);
 assert.equal((await page.request.get(`${origin}/projects/${f.projectId}/billing`)).status(),404);
 checks.push('billing navigation and document route removed');
 await page.locator('nav[data-testid="inbox-views"] a[href*="view=open"]').click();await page.getByRole('link').filter({hasText:'Browser Visitor'}).first().waitFor();checks.push('all-open shows persisted visitor conversation');
 // Keep the frontier read pending long enough to expose premature acknowledgement.
 // A text-only locator also matches React's controlled textarea before Send.
 await page.route('**/api/conversations/*/messages',async route=>{if(route.request().method()==='GET')await new Promise(resolve=>setTimeout(resolve,300));await route.continue();});
 const reply='Browser verified operator response '+Date.now();
 const transcriptReply=()=>page.locator('.transcript-message-content').getByText(reply,{exact:true});
 await page.getByPlaceholder('Type your reply…').fill(reply);
 assert.equal(await transcriptReply().count(),0);
 const acceptedResponse=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/conversations/${f.conversationId}/messages`&&response.request().method()==='POST');
 await page.getByRole('button',{name:'Send',exact:true}).click();
 const sent=await acceptedResponse;assert.equal(sent.status(),200);assert.equal((await sent.json()).accepted,true);
 await transcriptReply().waitFor();await page.reload();await transcriptReply().waitFor();
 await page.unroute('**/api/conversations/*/messages');
 checks.push('operator send waits for durable acceptance and survives reload');
 await page.getByRole('button',{name:'Actions',exact:true}).click();await page.getByRole('menuitem',{name:'Internal note',exact:true}).click();console.log('DIALOG',await page.getByRole('dialog').innerText());
 const note=`Internal browser regression note ${Date.now()}`; await page.getByRole('dialog').getByRole('textbox').fill(note);await page.getByRole('dialog').getByRole('button',{name:/Save|Add/}).click();await page.locator('.transcript-note-content').getByText(note,{exact:true}).waitFor();checks.push('internal note persisted');
 await page.screenshot({path:join(evidenceDir,'inbox.png'),fullPage:true});
 await page.goto(`${origin}/projects/${f.projectId}/macros/create`);await page.getByLabel('Title',{exact:true}).fill('Browser saved reply');await page.getByLabel('Content',{exact:true}).fill('Saved reply content from native UI.');await page.getByRole('button',{name:/^(Save|Update|Create)$/,exact:true}).click();await page.waitForURL(url=>url.pathname.includes('/macros/')&&!url.pathname.endsWith('/create'));await page.reload();assert.equal(await page.getByLabel('Content',{exact:true}).inputValue(),'Saved reply content from native UI.');checks.push('saved reply creation survives reload');
 await page.goto(`${origin}/projects/${f.projectId}/edit`);await page.getByLabel('Website',{exact:true}).fill('https://example.test');await page.getByRole('button',{name:/^(Save|Update|Create)$/,exact:true}).click();await page.getByRole('status').waitFor();await page.reload();assert.equal(await page.getByLabel('Website',{exact:true}).inputValue(),'https://example.test');checks.push('project settings persist');
 await verifySettingsParity(page,{origin,projectId:f.projectId,checks});
 await page.getByRole('button',{name:'Appearance',exact:true}).click();
 await page.locator('input[type=file]').setInputFiles({name:'native-brand.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhZkAAAAASUVORK5CYII=','base64')});await page.getByAltText('Workspace brand',{exact:true}).waitFor();await page.getByRole('button',{name:/^(Save|Update|Create)$/,exact:true}).click();await page.getByRole('status').waitFor();await page.reload();await page.getByRole('button',{name:'Appearance',exact:true}).click();await page.getByAltText('Workspace brand',{exact:true}).waitFor();checks.push('brand image upload persists');
 await verifyManagementParity(page,{origin,projectId:f.projectId,checks});
 await verifyAssistantParity(page,{origin,projectId:f.projectId,checks});
 await verifyKnowledgeParity(page,{origin,projectId:f.projectId,checks});
 for(const section of ['insights','contacts','ais','datasets','articles','categories','agents','email-settings','local-agent']){await page.goto(`${origin}/projects/${f.projectId}/${section}`);await page.waitForTimeout(250);checks.push(section+' route opened');}
 await page.setViewportSize({width:390,height:844});await page.goto(`${origin}/projects/${f.projectId}/conversations/${f.conversationId}`);await page.getByPlaceholder('Type your reply…').waitFor();await page.waitForTimeout(600);const composer=await page.getByPlaceholder('Type your reply…').boundingBox();assert.ok(composer.x>=0&&composer.x+composer.width<=391);await page.screenshot({path:join(evidenceDir,'mobile.png'),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));checks.push('mobile conversation no horizontal overflow');await verifyMobileNavigation(page,{origin,projectId:f.projectId,checks});assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);success=true;
}finally{await writeFile(join(evidenceDir,'result.json'),JSON.stringify({checks,errors,failed},null,2));console.log(JSON.stringify({checks,errors,failed}));await browser.close();await runtime.close(success);}

}
