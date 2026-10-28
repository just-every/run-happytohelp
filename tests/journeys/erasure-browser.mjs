import test,{before,after} from 'node:test'
import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {createRuntime} from '../helpers/emitted-runtime.mjs'
import {launchBrowser,viewports,evidence} from './kit/browser.mjs'

// The complete erasure journey runs once; the seed-wide phone smoke checks rendering separately.
let browser
before(async()=>{browser=await launchBrowser()})
after(async()=>{await browser?.close()})
test(`at 1440px an owner erases a contact only after typing ERASE; identity, content and attachment are gone, the session is revoked and other visitors are untouched`,async()=>{
 const viewport=viewports.desktop
 const shot=await evidence('contact-erasure'),runtime=await createRuntime(),origin=runtime.origin;let success=false
 const request=async(path,{token,body,method=body===undefined?'GET':'POST',headers={},raw=false}={})=>{const response=await fetch(origin+path,{method,headers:{...(body!==undefined&&!(body instanceof Uint8Array)?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{}),...headers},body:body===undefined?undefined:body instanceof Uint8Array?body:JSON.stringify(body)});if(raw)return response;assert.ok(response.ok,`${method} ${path}: ${response.status} ${await response.clone().text()}`);return response.json();};
 try{
 const owner={email:'erasure-owner@example.test',password:'synthetic-native-erasure-test-password-2026'};
 const setup=await request('/api/identity/bootstrap',{body:{...owner,name:'Erasure Workspace',allowedOrigin:origin}}),projectId=setup.projectId;
 // The visitors write while nobody has the dashboard open and this team answers anyway, so presence-based away is off.
 await runtime.presenceAwayOff(projectId);
 const login=await request('/api/identity/login',{body:owner}),project=await request(`/api/identity/projects/${projectId}`,{token:login.token});
 const secret='Please delete my account, my phone is 0400 123 456';
 const visitor=await request('/api/identity/widget/session',{body:{widgetKey:project.widget_key,name:'Erasure Visitor',email:'erase-me@example.test'},headers:{Origin:origin}});
 const kept=await request('/api/identity/widget/session',{body:{widgetKey:project.widget_key,name:'Kept Visitor',email:'keep-me@example.test'},headers:{Origin:origin}});
 const conversation=await request('/api/conversations',{token:visitor.token,body:{projectId}}),keptConversation=await request('/api/conversations',{token:kept.token,body:{projectId}});
 const upload=await request(`/api/conversations/${conversation.id}/media`,{token:visitor.token,body:new TextEncoder().encode('scan of a passport'),headers:{'Content-Type':'text/plain','X-Filename':'passport.txt'}});
 assert.equal((await request(`/api/conversations/${conversation.id}/messages`,{token:visitor.token,body:{localId:'erase-1',content:secret,expectedRevision:0,mediaIds:[upload.id]}})).accepted,true);
 assert.equal((await request(`/api/conversations/${keptConversation.id}/messages`,{token:kept.token,body:{localId:'keep-1',content:'I am staying',expectedRevision:0}})).accepted,true);

 const page=await browser.newPage({viewport});const errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/login?returnTo='+encodeURIComponent(`/projects/${projectId}/conversations`));await page.getByLabel('Email',{exact:true}).fill(owner.email);await page.getByLabel('Password',{exact:true}).fill(owner.password);await page.getByRole('button',{name:'Login',exact:true}).click();await page.waitForURL('**/conversations');
 await page.goto(`${origin}/projects/${projectId}/contacts`);await page.getByRole('link',{name:'Erasure Visitor',exact:true}).click();
 await page.waitForURL(`**/projects/${projectId}/contacts/${visitor.contactId}`);await page.getByRole('heading',{name:'Erasure Visitor'}).waitFor();
 const start=page.getByRole('button',{name:'Erase personal data…',exact:true});await start.click();
 const confirm=page.getByRole('button',{name:'Permanently erase',exact:true}),typed=page.getByLabel('Type ERASE to confirm');
 assert.equal(await confirm.isDisabled(),true);await typed.fill('erase');assert.equal(await confirm.isDisabled(),true,'confirmation is exact');
 await page.getByRole('button',{name:'Cancel',exact:true}).click();await start.waitFor();assert.equal(await confirm.count(),0);
 assert.equal((await request(`/api/management/projects/${projectId}/contacts/${visitor.contactId}`,{token:login.token})).data.name,'Erasure Visitor','cancel erases nothing');
 checks.push('erasure requires an exact typed confirmation and cancel changes nothing');
 await start.click();await typed.fill('ERASE');await page.screenshot({path:shot(`${viewport.width}-confirm.png`),fullPage:true});
 const erased=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/management/projects/${projectId}/contacts/${visitor.contactId}/erase`);
 await confirm.click();const response=await erased;assert.equal(response.status(),200);
 await page.getByText('Personal data erased.',{exact:false}).waitFor();assert.equal(await page.getByText('Erasure Visitor').count(),0);await page.screenshot({path:shot(`${viewport.width}-erased.png`),fullPage:true});
 checks.push('dashboard control erases the contact and shows the erased record');

 const record=(await request(`/api/management/projects/${projectId}/contacts/${visitor.contactId}`,{token:login.token})).data;
 assert.deepEqual([record.name,record.email,JSON.parse(record.metadata_json).is_erased],[null,null,1]);
 const transcript=await request(`/api/conversations/${conversation.id}/messages`,{token:login.token});
 assert.deepEqual(transcript.messages.map(m=>[m.content,Boolean(m.erased_at),m.media.length]),[['',true,0]]);assert.equal(transcript.revision,1);
 assert.equal((await request(`/api/conversations/${conversation.id}/media/${upload.id}`,{token:login.token,raw:true})).status,404);
 assert.equal((await request(`/api/conversations/${conversation.id}/messages`,{token:visitor.token,raw:true})).status,401);
 const keptTranscript=await request(`/api/conversations/${keptConversation.id}/messages`,{token:kept.token});assert.equal(keptTranscript.messages[0].content,'I am staying');
 checks.push('D1/R2 state: identity, content and attachment gone; session revoked; other visitor intact');

 await page.goto(`${origin}/projects/${projectId}/contacts`);await page.getByRole('link',{name:'Kept Visitor',exact:true}).waitFor();assert.equal(await page.getByRole('link',{name:'Erasure Visitor',exact:true}).count(),0);
 await page.goto(`${origin}/projects/${projectId}/conversations/${conversation.id}`);await page.getByText('Message erased',{exact:true}).waitFor();
 assert.equal(await page.getByText(secret).count(),0);assert.ok(await page.getByText('Erased contact').count()>0);await page.screenshot({path:shot(`${viewport.width}-transcript.png`),fullPage:true});
 checks.push('contact list hides the erased contact; transcript shows erased messages without content');
 assert.deepEqual(errors,[]);
 await writeFile(shot(`${viewport.width}-result.json`),JSON.stringify({checks},null,2));
 console.log(`Contact erasure browser passed: ${checks.length} checks.\n- ${checks.join('\n- ')}`);success=true;
}finally{await runtime.close(success)}
})
