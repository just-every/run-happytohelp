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

// Both operator creation doors use the emitted Worker and its real native
// session. The provider alone is a network fixture; no application API is routed.
export async function outboundTicketBrowser(){
 const evidenceDir=join(process.env.H2H_EVIDENCE_DIR?resolve(process.env.H2H_EVIDENCE_DIR):tmpdir(),'outbound-tickets')
 await mkdir(evidenceDir,{recursive:true})
 const runtime=await createRuntime({queueConsumers:true,vars:{RATE_LIMITS:JSON.stringify({outboundNoticesPerProjectMinute:2}),EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'synthetic-fixture-mail-provider',EMAIL_FROM:'support@example.test'},outboundFixture:new URL('../mail-provider-network.mjs',import.meta.url).href})
 const browser=await launchBrowser(),errors=[];let success=false
 try{
  const call=async(path,body,token)=>{
   const response=await fetch(runtime.origin+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)})
   const result=await response.json();assert.ok(response.ok,`${path}: ${response.status} ${JSON.stringify(result)}`);return result
  }
  const email='synthetic-happytohelp-owner@example.test',password='synthetic-happytohelp-password-1'
  const setup=await call('/api/identity/bootstrap',{email,password,name:'Synthetic parcel support',allowedOrigin:runtime.origin}),owner=await call('/api/identity/login',{email,password})
  const copies=()=>[...runtime.logs.matchAll(/MAIL_FIXTURE_RECEIPT (\{[^\n]+\})/g)].map(match=>JSON.parse(match[1]))
  const delivered=async(base,id,content)=>{
   for(let attempt=0;attempt<100;attempt++){
    const state=(await call(`${base}/conversations/${id}`,undefined,owner.token)).data.last_message?.email_status?.state
    if(state==='sent'){assert.equal(copies().filter(copy=>copy.text?.includes(content)).length,1,'one provider acceptance for this first comment');return}
    assert.ok(!['failed','uncertain'].includes(state),`first comment delivery is ${state}`)
    await new Promise(resolve=>setTimeout(resolve,100))
   }
   assert.fail('first comment did not settle as provider accepted')
  }
  for(const width of [1440,390]){
   const project=await call('/api/management/projects',{name:`Synthetic parcel support ${width}`,allowedOrigin:runtime.origin},owner.token),projectId=project.id,base=`/api/dashboard/projects/${projectId}`,management=`/api/management/projects/${projectId}`
   const session=await call('/api/identity/switch-project',{projectId},owner.token);owner.token=session.token;owner.actor=session.actor
   const mailbox=(await call(management+'/mailboxes',{provider:'forwarding',address:`synthetic-happytohelp-ticket-${width}@support.example`,displayName:''},owner.token)).data
   const reason=(await call(management+'/ticket-fields',{name:'Delivery reason',type:'dropdown',options:['replacement','question']},owner.token)).data
   const reference=(await call(management+'/ticket-fields',{name:'Delivery reference',type:'regex',required:true,validation:{pattern:'^DEL-[0-9]+$'}},owner.token)).data
   const parcels=(await call(management+'/ticket-fields',{name:'Parcel count',type:'number'},owner.token)).data
   const form=(await call(`/api/forms/projects/${projectId}/forms`,{title:'Replacement delivery',enabled:true,fields:[{fieldId:reason.id,required:true},{fieldId:reference.id,required:true,condition:{fieldId:reason.id,operator:'equals',value:'replacement'}},{fieldId:parcels.id}]},owner.token)).data
   const group=(await call(management+'/ticket-groups',{name:'Delivery team',members:[owner.actor.id]},owner.token)).data
   const other=await call('/api/management/projects',{name:`Synthetic empty brand ${width}`,allowedOrigin:runtime.origin},owner.token)
   const existingRequester=(await call(management+'/contacts',{name:'Synthetic parcel customer',email:`synthetic-happytohelp-${width}@customer.example`},owner.token)).data
   const context=await browser.newContext({viewport:{width,height:width===390?844:1000}})
   await context.addCookies([{name:'h2h_session',value:owner.token,url:runtime.origin}])
   const page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message))
   const request=async(body,path=base+'/tickets')=>page.evaluate(async({path,body})=>{const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json()}},{path,body})
   const open=async()=>{await page.goto(`${runtime.origin}/projects/${projectId}/conversations`);await page.getByRole('button',{name:'New ticket',exact:true}).click();await page.getByRole('dialog',{name:'New ticket',exact:true}).waitFor()}
   await open()
   const dialog=page.getByRole('dialog',{name:'New ticket',exact:true}),requester=`synthetic-happytohelp-${width}@customer.example`,subject=`Replacement parcel ${width}`,content=`Your replacement parcel ships today (${width}).`
   await dialog.getByLabel('Requester email',{exact:true}).fill('draft@customer.example')
   await dialog.getByLabel('Brand workspace',{exact:true}).selectOption(other.id)
   await dialog.getByText('No connected mailboxes are available.',{exact:false}).waitFor()
   assert.equal(await dialog.getByLabel('Requester email',{exact:true}).inputValue(),'')
   await page.screenshot({path:join(evidenceDir,`${width}-empty-brand.png`),fullPage:true})
   await dialog.getByLabel('Brand workspace',{exact:true}).selectOption(projectId)
   await dialog.getByLabel('Find requester by name, email or phone',{exact:true}).fill(requester)
   await dialog.getByRole('button',{name:new RegExp(`Synthetic parcel customer ${requester.replaceAll('.','\\.')}`)}).click()
   await dialog.getByLabel('Request form',{exact:true}).selectOption(form.id)
   await dialog.getByLabel('Delivery reason *',{exact:true}).selectOption('question')
   assert.equal(await dialog.getByLabel('Delivery reference *',{exact:true}).count(),0)
   await dialog.getByLabel('Delivery reason *',{exact:true}).selectOption('replacement')
   await dialog.getByLabel('Delivery reference *',{exact:true}).fill('invalid')
   await dialog.getByLabel('Parcel count',{exact:true}).fill('2')
   await dialog.getByLabel('Group',{exact:true}).selectOption(group.id)
   await dialog.getByLabel('Assignee',{exact:true}).selectOption(owner.actor.id)
   await dialog.getByLabel('CC',{exact:true}).fill(`synthetic-happytohelp-cc-${width}@customer.example`);await dialog.getByLabel('BCC',{exact:true}).fill(`synthetic-happytohelp-bcc-${width}@customer.example`)
   await dialog.getByLabel('Subject',{exact:true}).fill(subject);await dialog.getByLabel('Message',{exact:true}).fill(content)
   await dialog.getByRole('button',{name:'Create and email',exact:true}).waitFor({state:'visible'})
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${width}: New ticket fits`)
   await page.screenshot({path:join(evidenceDir,`${width}-new-email.png`),fullPage:true})
   const refusalResponse=page.waitForResponse(response=>new URL(response.url()).pathname===base+'/tickets'&&response.request().method()==='POST')
   await dialog.getByRole('button',{name:'Create and email',exact:true}).click()
   assert.equal((await refusalResponse).status(),422)
   await dialog.getByText('Delivery reference: Value does not match the required pattern',{exact:true}).first().waitFor()
   assert.equal(await dialog.getByLabel('Subject',{exact:true}).inputValue(),subject,'refusal retains editable draft')
   await page.screenshot({path:join(evidenceDir,`${width}-configuration-error.png`),fullPage:true})
   await dialog.getByLabel('Delivery reference *',{exact:true}).fill('DEL-1048')
   const createdResponse=page.waitForResponse(response=>new URL(response.url()).pathname===base+'/tickets'&&response.request().method()==='POST')
   await dialog.getByRole('button',{name:'Create and email',exact:true}).click()
   const response=await createdResponse;assert.equal(response.status(),201);const created=await response.json(),command=response.request().postDataJSON()
   assert.equal(created.conversation.group_id,group.id);assert.equal(created.conversation.assigned_to,owner.actor.id);assert.equal(created.conversation.requester_id,existingRequester.id)
   const configured=(await call(`${base}/conversations/${created.conversation.id}/ticket`,undefined,owner.token)).data
   assert.equal(configured.fields[parcels.id],2);assert.equal(configured.fields[reference.id],'DEL-1048');assert.equal(configured.history.find(item=>item.changes.form).changes.form.formId,form.id)
   assert.equal(created.conversation.submitter_id,owner.actor.id);assert.equal(created.conversation.requester_id,created.conversation.contact_id)
   await page.waitForURL(`**/conversations/${created.conversation.id}`);await page.locator('.transcript-message-content').getByText(content,{exact:true}).waitFor()
   await delivered(base,created.conversation.id,content)
   assert.equal(copies().find(copy=>copy.text?.includes(content)).from,mailbox.address)
   await page.reload();await page.locator('.transcript-message-content').getByText(content,{exact:true}).waitFor()
   if(await page.locator('#conversation-assistant').getAttribute('aria-hidden')==='true')await page.getByRole('button',{name:'Show conversation panel',exact:true}).click()
   await page.getByRole('tab',{name:'Ticket',exact:true}).click()
   await page.locator('#ticket-section-fields-heading').click()
   await page.getByLabel('Delivery reference',{exact:false}).waitFor()
   await page.screenshot({path:join(evidenceDir,`${width}-configured-ticket.png`),fullPage:true})
   const replay=await request(command);assert.equal(replay.status,200);assert.equal(replay.body.conversation.id,created.conversation.id);assert.equal(replay.body.duplicate,true);await delivered(base,created.conversation.id,content)
   // The API door selects the existing requester rather than making another.
   const apiCommand={kind:'email',localId:`synthetic-happytohelp-api-${width}`,requesterId:created.conversation.contact_id,mailboxId:mailbox.id,subject:`Delivery update ${width}`,content:`Your parcel is ready for collection (${width}).`}
   const api=await request(apiCommand);assert.equal(api.status,201);assert.equal(api.body.conversation.contact_id,created.conversation.contact_id);assert.equal(api.body.conversation.submitter_id,owner.actor.id)
   await delivered(base,api.body.conversation.id,apiCommand.content)
   assert.equal((await request(apiCommand)).body.conversation.id,api.body.conversation.id);await delivered(base,api.body.conversation.id,apiCommand.content)
   assert.equal((await request({...apiCommand,subject:'Changed intent'})).status,409)
   assert.equal((await request({...apiCommand,localId:`synthetic-happytohelp-invalid-${width}`,subject:'Header\r\nBcc: forged@example.test'})).status,400)
   await page.goto(`${runtime.origin}/projects/${projectId}/conversations/${api.body.conversation.id}`)
   await page.locator('.transcript-message-content').getByText(apiCommand.content,{exact:true}).waitFor()
   await page.screenshot({path:join(evidenceDir,`${width}-api-email.png`),fullPage:true})
   // The dialog's call path records a private note; the API call path is the
   // same durable command with the existing requester and no mailbox/copies.
   const beforeCalls=copies().length
   await open();await dialog.getByLabel('Ticket type',{exact:true}).selectOption('call')
   await dialog.getByLabel('Requester email',{exact:true}).fill(`new-call-${width}@customer.example`);await dialog.getByLabel('Subject',{exact:true}).fill(`Customer called ${width}`);await dialog.getByLabel('Call notes',{exact:true}).fill(`Confirmed collection time (${width}).`)
   await dialog.getByLabel('Request form',{exact:true}).selectOption(form.id)
   await dialog.getByLabel('Delivery reason *',{exact:true}).selectOption('question')
   await dialog.getByLabel('Parcel count',{exact:true}).fill('1')
   await dialog.getByLabel('Assignee',{exact:true}).selectOption('')
   assert.equal(await dialog.getByLabel('CC',{exact:true}).count(),0)
   await page.screenshot({path:join(evidenceDir,`${width}-new-call.png`),fullPage:true})
   let lostCall
   await page.route('**'+base+'/tickets',async route=>{const response=await route.fetch();assert.equal(response.status(),201);lostCall=await response.json();await route.abort('failed')},{times:1})
   await dialog.getByRole('button',{name:'Log call',exact:true}).click()
   await dialog.getByRole('button',{name:'Check same request',exact:true}).waitFor()
   await page.screenshot({path:join(evidenceDir,`${width}-configured-call-lost-response.png`),fullPage:true})
   const callResponse=page.waitForResponse(response=>new URL(response.url()).pathname===base+'/tickets'&&response.request().method()==='POST')
   await dialog.getByRole('button',{name:'Check same request',exact:true}).click();const logged=await callResponse;assert.equal(logged.status(),200)
   const callTicket=await logged.json();assert.equal(callTicket.conversation.id,lostCall.conversation.id);assert.equal(callTicket.duplicate,true);assert.equal(callTicket.conversation.channel,'phone');assert.notEqual(callTicket.conversation.contact_id,created.conversation.contact_id);assert.equal(callTicket.conversation.assigned_to,null);assert.equal(callTicket.note.content,`Confirmed collection time (${width}).`)
   assert.equal(callTicket.message,undefined)
   const apiCall={kind:'call',localId:`synthetic-happytohelp-api-call-${width}`,requesterId:created.conversation.contact_id,subject:`Call follow-up ${width}`,content:'Synthetic private collection instructions.'}
   const loggedApi=await request(apiCall);assert.equal(loggedApi.status,201);assert.equal(loggedApi.body.conversation.channel,'phone');assert.equal(loggedApi.body.note.content,apiCall.content)
   assert.equal((await request(apiCall)).body.note.id,loggedApi.body.note.id)
   assert.equal((await request({...apiCall,localId:`synthetic-happytohelp-call-cc-${width}`,cc:['synthetic-happytohelp-1@customer.example']})).status,400)
   assert.equal(copies().length,beforeCalls,'dialog/API call logs send no mail, including retries')
   // A separate workspace gives each viewport a fresh real rate-limit window.
   const noticeProject=await call('/api/management/projects',{name:`Synthetic notices ${width}`,allowedOrigin:runtime.origin},owner.token),noticeBase=`/api/dashboard/projects/${noticeProject.id}`
   await call(`/api/management/projects/${noticeProject.id}/mailboxes`,{provider:'forwarding',address:`synthetic-happytohelp-notice-${width}@support.example`,displayName:''},owner.token)
   await page.goto(`${runtime.origin}/projects/${noticeProject.id}/conversations`)
   await page.getByRole('button',{name:'New ticket',exact:true}).click()
   await dialog.getByLabel('Ticket type',{exact:true}).selectOption('notice')
   const recipients=[1,2,3].map(n=>`synthetic-happytohelp-${width}-${n}@customer.example`),noticeText=`Your delivery is delayed (${width}).`,beforeNotices=copies().length
   await dialog.getByLabel('Requester emails',{exact:true}).fill([...recipients,recipients[0]].join(', '))
   await dialog.getByLabel('Subject',{exact:true}).fill(`Delivery delay ${width}`)
   await dialog.getByLabel('Message',{exact:true}).fill(noticeText)
   await dialog.getByRole('button',{name:'Preview recipients',exact:true}).click()
   const previewList=dialog.getByRole('region',{name:'Notice recipients'})
   for(const recipient of recipients)await previewList.getByText(recipient,{exact:true}).waitFor()
   assert.equal(await previewList.getByRole('listitem').count(),3)
   assert.equal(copies().length,beforeNotices,'all requesters previewed before any send')
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
   await page.screenshot({path:join(evidenceDir,`${width}-notice-preview.png`),fullPage:true})
   const batchResponse=page.waitForResponse(response=>new URL(response.url()).pathname===noticeBase+'/tickets/notices'&&response.request().method()==='POST')
   await dialog.getByRole('button',{name:'Confirm and email',exact:true}).click()
   const batchReply=await batchResponse;assert.equal(batchReply.status(),200)
   const batch=await batchReply.json(),batchCommand=batchReply.request().postDataJSON()
   assert.equal(batch.results.length,3);assert.ok(batch.results.every(row=>row.accepted));assert.equal(new Set(batch.results.map(row=>row.conversation.id)).size,3)
   const resultList=dialog.getByRole('region',{name:'Notice results'});await resultList.waitFor()
   for(const recipient of recipients)await resultList.getByRole('link',{name:recipient,exact:true}).waitFor()
   await page.screenshot({path:join(evidenceDir,`${width}-notice-results.png`),fullPage:true})
   const states=[]
   for(const row of batch.results){
    let state
    for(let attempt=0;attempt<100;attempt++){
     state=(await call(`${noticeBase}/conversations/${row.conversation.id}`,undefined,owner.token)).data.last_message?.email_status?.state
     if(['sent','rate_limited'].includes(state))break
     await new Promise(resolve=>setTimeout(resolve,100))
    }
    states.push(state)
   }
   assert.deepEqual([...states].sort(),['rate_limited','sent','sent'])
   for(const row of batch.results.filter((_,index)=>states[index]==='sent'))assert.equal(copies().filter(copy=>[copy.to].flat().includes(row.recipient)&&copy.text.includes(noticeText)).length,1)
   const repeated=await request(batchCommand,noticeBase+'/tickets/notices');assert.equal(repeated.status,200)
   assert.deepEqual(repeated.body.results.map(row=>row.conversation.id),batch.results.map(row=>row.conversation.id))
   assert.equal(copies().length,beforeNotices+2,'repeat has no additional provider attempts')
   for(const copy of copies().slice(beforeNotices))assert.equal(copy.from,`synthetic-happytohelp-notice-${width}@support.example`)
   const refused=batch.results[states.indexOf('rate_limited')]
   await dialog.getByRole('link',{name:refused.recipient,exact:true}).click()
   await page.locator('.transcript-message-content').getByText(noticeText,{exact:true}).waitFor()
   await page.getByRole('status').filter({hasText:'outbound notice rate limit reached'}).waitFor()
   await page.reload();await page.getByRole('status').filter({hasText:'outbound notice rate limit reached'}).waitFor()
   await page.screenshot({path:join(evidenceDir,`${width}-notice-rate-limited.png`),fullPage:true})
   // Definitive consent refusal comes from the actual portal preference door,
   // after preview. Every dismissal remains usable and the draft stays editable.
   const refusing=`synthetic-happytohelp-refusal-${width}@customer.example`,portalPath=`/api/portal/${noticeProject.id}`
   const access=await page.request.post(runtime.origin+portalPath+'/access/request',{data:{email:refusing},headers:{Origin:runtime.origin}});assert.equal(access.status(),202)
   let accessCopy
   for(let i=0;i<100&&!accessCopy;i++){accessCopy=copies().find(copy=>[].concat(copy.to).includes(refusing));if(!accessCopy)await new Promise(resolve=>setTimeout(resolve,50))}
   const accessUrl=new URL(accessCopy.text.match(/https?:\/\/\S+\/api\/portal\/\S+/)[0])
   const verified=await page.request.get(accessUrl.href,{maxRedirects:0});assert.equal(verified.status(),303)
   const preference=async enabled=>{const response=await page.request.put(runtime.origin+portalPath+'/preferences',{data:{locale:'en',surveyEmails:true,updateEmails:enabled},headers:{Origin:runtime.origin}});assert.equal(response.status(),200)}
   for(const lostRefusal of [false,true])for(const dismissal of ['Cancel','Close','Escape']){
    await preference(true)
    await page.goto(`${runtime.origin}/projects/${noticeProject.id}/conversations`);await page.getByRole('button',{name:'New ticket',exact:true}).click()
    await dialog.getByLabel('Ticket type',{exact:true}).selectOption('notice')
    const draftRecipients=`${refusing}, synthetic-happytohelp-refusal-other-${width}@customer.example`,draftSubject=`Consent recovery ${width}`,draftText='Keep this draft after a definitive refusal.'
    await dialog.getByLabel('Requester emails',{exact:true}).fill(draftRecipients);await dialog.getByLabel('Subject',{exact:true}).fill(draftSubject);await dialog.getByLabel('Message',{exact:true}).fill(draftText)
    await dialog.getByRole('button',{name:'Preview recipients',exact:true}).click();await dialog.getByRole('region',{name:'Notice recipients'}).waitFor()
    await preference(false)
    const beforeRefusal=copies().length,beforeTicketCount=(await call(noticeBase+'/conversations',undefined,owner.token)).meta.pagination.total
    let refusedCommand
    if(lostRefusal){
     await page.route('**'+noticeBase+'/tickets/notices',async route=>{
      refusedCommand=route.request().postDataJSON();const response=await route.fetch()
      assert.equal(response.status(),409);assert.equal((await response.json()).code,'notice_not_created')
      await route.abort('failed')
     },{times:1})
     await dialog.getByRole('button',{name:'Confirm and email',exact:true}).click()
     await dialog.getByRole('button',{name:'Check same request',exact:true}).waitFor()
     assert.ok(await dialog.getByRole('button',{name:'Cancel',exact:true}).isDisabled())
    }
    const rejectedResponse=page.waitForResponse(r=>new URL(r.url()).pathname===noticeBase+'/tickets/notices'&&r.request().method()==='POST')
    await dialog.getByRole('button',{name:lostRefusal?'Check same request':'Confirm and email',exact:true}).click()
    const rejected=await rejectedResponse;assert.equal(rejected.status(),409);assert.equal((await rejected.json()).code,'notice_not_created')
    if(lostRefusal)assert.deepEqual(rejected.request().postDataJSON(),refusedCommand)

    await dialog.getByLabel('Message',{exact:true}).waitFor()
    assert.equal(await dialog.getByLabel('Requester emails',{exact:true}).inputValue(),draftRecipients);assert.equal(await dialog.getByLabel('Subject',{exact:true}).inputValue(),draftSubject);assert.equal(await dialog.getByLabel('Message',{exact:true}).inputValue(),draftText)
    assert.ok(await dialog.getByLabel('Message',{exact:true}).isEnabled());assert.ok(await dialog.getByRole('button',{name:'Cancel',exact:true}).isEnabled())
    assert.equal(await dialog.getByRole('button',{name:'Check same request',exact:true}).count(),0)
    assert.equal(copies().length,beforeRefusal)
    assert.equal((await call(noticeBase+'/conversations',undefined,owner.token)).meta.pagination.total,beforeTicketCount,'a definitive refusal creates no ticket')
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
    await page.screenshot({path:join(evidenceDir,`${width}-notice-${lostRefusal?'lost-':''}refusal-${dismissal.toLowerCase()}.png`),fullPage:true})
    if(dismissal==='Escape')await page.keyboard.press('Escape')
    else await dialog.getByRole('button',{name:dismissal,exact:true}).click()
    await dialog.waitFor({state:'hidden'})
   }
   // Exercise both kinds of 5xx, a lost successful response, and a genuine
   // capacity-limited response from the real Worker. Recovery never changes the
   // immutable command or duplicates any already admitted ticket.
   await preference(true)
   for(const mode of ['lost-success','after-commit','before-server','partial']){
    await page.getByRole('button',{name:'New ticket',exact:true}).click();await dialog.getByLabel('Ticket type',{exact:true}).selectOption('notice')
    const recoveryRecipients=mode==='partial'?Array.from({length:50},(_,i)=>`synthetic-happytohelp-partial-${width}-${i}@customer.example`):[refusing,`synthetic-happytohelp-${mode}-${width}@customer.example`]
    await dialog.getByLabel('Requester emails',{exact:true}).fill(recoveryRecipients.join(', '));await dialog.getByLabel('Subject',{exact:true}).fill(`Recovery ${mode}`);await dialog.getByLabel('Message',{exact:true}).fill(`Recover this exact notice ${mode}.`)
    await dialog.getByRole('button',{name:'Preview recipients',exact:true}).click();await dialog.getByRole('region',{name:'Notice recipients'}).waitFor()
    let lostCommand,lostResult
    await page.route('**'+noticeBase+'/tickets/notices',async route=>{
     lostCommand=route.request().postDataJSON()
     if(mode==='before-server'){await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic network-edge unavailability'})});return}
     const response=await route.fetch();assert.equal(response.status(),200);lostResult=await response.json()
     if(mode==='lost-success')await route.abort('failed')
     else if(mode==='after-commit')await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic lost acceptance response'})})
     else {assert.ok(lostResult.results.some(row=>row.accepted));assert.ok(lostResult.results.some(row=>!row.accepted));await route.fulfill({response})}
    },{times:1})
    await dialog.getByRole('button',{name:'Confirm and email',exact:true}).click();await dialog.getByRole('button',{name:'Check same request',exact:true}).waitFor()
    assert.ok(await dialog.getByRole('button',{name:mode==='partial'?'Close':'Cancel',exact:true}).isDisabled())
    assert.equal(await dialog.locator('.modal-header').getByRole('button',{name:'Close',exact:true}).count(),0)
    await page.keyboard.press('Escape');assert.ok(await dialog.isVisible())
    let recovered
    for(let attempt=0;attempt<10;attempt++){
     const resumedResponse=page.waitForResponse(r=>new URL(r.url()).pathname===noticeBase+'/tickets/notices'&&r.request().method()==='POST')
     await dialog.getByRole('button',{name:'Check same request',exact:true}).click();const resumed=await resumedResponse
     assert.deepEqual(resumed.request().postDataJSON(),lostCommand);recovered=await resumed.json()
     if(lostResult)for(const row of lostResult.results.filter(row=>row.accepted))assert.equal(recovered.results.find(next=>next.recipient===row.recipient).conversation.id,row.conversation.id)
     if(recovered.results.every(row=>row.accepted))break
    }
    assert.ok(recovered.results.every(row=>row.accepted));assert.equal(new Set(recovered.results.map(row=>row.conversation.id)).size,recoveryRecipients.length)
    for(const row of recovered.results){
     let state
     for(let attempt=0;attempt<100;attempt++){
      state=(await call(`${noticeBase}/conversations/${row.conversation.id}`,undefined,owner.token)).data.last_message.email_status.state
      if(['sent','rate_limited'].includes(state))break
      await new Promise(resolve=>setTimeout(resolve,100))
     }
     assert.ok(['sent','rate_limited'].includes(state),`${mode}: delivery settled as ${state}`)
     assert.ok(copies().filter(copy=>[].concat(copy.to).includes(row.recipient)&&copy.text.includes(`Recover this exact notice ${mode}.`)).length<=1,'recovery never duplicates a provider copy')
    }
    const beforeReplay=copies().length,replay=await request(lostCommand,noticeBase+'/tickets/notices');assert.equal(replay.status,200)
    assert.deepEqual(replay.body.results.map(row=>row.conversation.id),recovered.results.map(row=>row.conversation.id));assert.equal(copies().length,beforeReplay)
    await dialog.locator('.modal-footer').getByRole('button',{name:'Close',exact:true}).waitFor();await page.screenshot({path:join(evidenceDir,`${width}-notice-${mode}-recovered.png`),fullPage:true})
    await dialog.locator('.modal-footer').getByRole('button',{name:'Close',exact:true}).click();await dialog.waitFor({state:'hidden'})
   }
   await context.close()
  }
  assert.deepEqual(errors,[]);success=true
 }finally{await browser.close();await runtime.close(success)}
}
