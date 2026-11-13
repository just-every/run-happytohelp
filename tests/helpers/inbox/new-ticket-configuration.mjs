import {createHmac,randomBytes} from 'node:crypto'
import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {createRuntime} from '../emitted-runtime.mjs'
import {launchBrowser} from '../../journeys/kit/browser.mjs'
import {newTicketBrandOrderings,ticketOrderingBrands} from './new-ticket-brand-orderings.mjs'
import {noMailboxTicket} from './no-mailbox-ticket.mjs'

export async function newTicketConfigurationBrowser(){
 const evidenceDir=join(process.env.H2H_EVIDENCE_DIR?resolve(process.env.H2H_EVIDENCE_DIR):tmpdir(),'outbound-tickets')
 await mkdir(evidenceDir,{recursive:true})
 const runtime=await createRuntime({queueConsumers:true,vars:{INTEGRATION_ENCRYPTION_KEY:randomBytes(32).toString('base64'),RATE_LIMITS:JSON.stringify({outboundNoticesPerProjectMinute:2}),EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'synthetic-fixture-mail-provider',EMAIL_FROM:'support@example.test'},outboundFixture:new URL('../mail-provider-network.mjs',import.meta.url).href})
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
  for(const width of [1440]){
   const project=await call('/api/management/projects',{name:`Synthetic parcel support ${width}`,allowedOrigin:runtime.origin},owner.token),projectId=project.id,base=`/api/dashboard/projects/${projectId}`,management=`/api/management/projects/${projectId}`
   const session=await call('/api/identity/switch-project',{projectId},owner.token);owner.token=session.token;owner.actor=session.actor
   const mailbox=(await call(management+'/mailboxes',{provider:'forwarding',address:`synthetic-happytohelp-ticket-${width}@support.example`,displayName:''},owner.token)).data
   const reason=(await call(management+'/ticket-fields',{name:'Delivery reason',type:'dropdown',options:['replacement','question']},owner.token)).data
   const reference=(await call(management+'/ticket-fields',{name:'Delivery reference',type:'regex',required:true,validation:{pattern:'^DEL-[0-9]+$'}},owner.token)).data
   const parcels=(await call(management+'/ticket-fields',{name:'Parcel count',type:'number'},owner.token)).data
   const form=(await call(`/api/forms/projects/${projectId}/forms`,{title:'Replacement delivery',enabled:true,fields:[{fieldId:reason.id,required:true},{fieldId:reference.id,required:true,condition:{fieldId:reason.id,operator:'equals',value:'replacement'}},{fieldId:parcels.id}]},owner.token)).data
   const group=(await call(management+'/ticket-groups',{name:'Delivery team',members:[owner.actor.id]},owner.token)).data
   const other=await call('/api/management/projects',{name:`Synthetic empty brand ${width}`,allowedOrigin:runtime.origin},owner.token)
   const orderingBrands=await ticketOrderingBrands({call,token:owner.token,origin:runtime.origin})
   const existingRequester=(await call(management+'/contacts',{name:'Synthetic parcel customer',email:`synthetic-happytohelp-${width}@customer.example`},owner.token)).data
   const context=await browser.newContext({viewport:{width,height:width===390?844:1000}})
   await context.addCookies([{name:'h2h_session',value:owner.token,url:runtime.origin}])
   const page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message))
   const showTicketFields=async()=>{
    if(await page.locator('#conversation-assistant').getAttribute('aria-hidden')==='true')await page.getByRole('button',{name:'Show conversation panel',exact:true}).click()
    await page.getByRole('tab',{name:'Ticket',exact:true}).click()
    const fields=page.locator('#ticket-section-fields-heading')
    if(await fields.getAttribute('aria-expanded')!=='true')await fields.click()
   }
   const capture=async(name,focus)=>{
    for(const proofWidth of [1440,390]){
     await page.setViewportSize({width:proofWidth,height:proofWidth===390?844:1000})
     await page.waitForTimeout(300)
     if(['configured-ticket','stored-field-values'].includes(name))await showTicketFields()
     if(focus)await focus.scrollIntoViewIfNeeded()
     await page.screenshot({path:join(evidenceDir,`${proofWidth}-${name}.png`),fullPage:true,animations:'disabled'})
    }
    await page.setViewportSize({width:1440,height:1000})
    await page.waitForTimeout(300)
    if(['configured-ticket','stored-field-values'].includes(name))await showTicketFields()
   }
   const request=async(body,path=base+'/tickets')=>page.evaluate(async({path,body})=>{const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,body:await response.json()}},{path,body})
   const open=async()=>{await page.goto(`${runtime.origin}/projects/${projectId}/conversations`);await page.getByRole('button',{name:'New ticket',exact:true}).click();await page.getByRole('dialog',{name:'New ticket',exact:true}).waitFor()}
   const dialog=page.getByRole('dialog',{name:'New ticket',exact:true})
   await newTicketBrandOrderings({page,origin:runtime.origin,dialog,...orderingBrands,capture})
   let releaseOld
   const oldReleased=new Promise(resolve=>{releaseOld=resolve})
   await page.route('**'+base+'/tickets/options',async route=>{const response=await route.fetch();await oldReleased;try{await route.fulfill({response})}catch{}},{times:1})
   await open()
   const requester=`synthetic-happytohelp-${width}@customer.example`,subject=`Replacement parcel ${width}`,content=`Your replacement parcel ships today (${width}).`
   if(width===1440){const close=dialog.getByRole('button',{name:'Close',exact:true}),target=await close.boundingBox();assert.ok(target.width>=44&&target.height>=44);await dialog.getByLabel('Brand workspace',{exact:true}).focus();await page.keyboard.press('Shift+Tab');await page.locator('.ui-tooltip').filter({hasText:'Close'}).waitFor({state:'visible'})}
   await dialog.getByLabel('Requester email',{exact:true}).fill('draft@customer.example')
   await dialog.getByLabel('Brand workspace',{exact:true}).selectOption(other.id)
   await dialog.getByText('No connected mailboxes are available.',{exact:false}).waitFor()
   assert.equal(await dialog.getByLabel('Requester email',{exact:true}).inputValue(),'')
   releaseOld();await page.waitForTimeout(100)
   await dialog.getByLabel('Request form',{exact:true}).waitFor()
   assert.equal(await dialog.getByLabel('Request form',{exact:true}).locator('option').count(),1,'late old-brand choices cannot repaint the empty workspace')
   assert.equal(await dialog.getByLabel('Send from mailbox',{exact:true}).locator('option').count(),1)
   await capture('empty-brand')
   await noMailboxTicket({page,dialog,runtime,projectId:other.id,actorId:owner.actor.id,copies,capture})
   await dialog.getByLabel('Brand workspace',{exact:true}).selectOption(projectId)
   await dialog.getByLabel('Find requester by name, email or phone',{exact:true}).fill(requester)
   await dialog.getByRole('button',{name:new RegExp(`Synthetic parcel customer ${requester.replaceAll('.','\\.')}`)}).click()
   await dialog.getByLabel('Send from mailbox',{exact:true}).scrollIntoViewIfNeeded()
   await dialog.getByLabel('Sender address',{exact:true}).selectOption('')
   await capture('configured-sender')
   if(width===1440){await dialog.locator('summary').filter({hasText:'Optional ticket fields'}).click();assert.equal(await dialog.getByLabel('Delivery reference',{exact:true}).getAttribute('required'),null,'required-to-solve remains optional at creation without a selected form')}
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
   await capture('new-email')
   const refusalResponse=page.waitForResponse(response=>new URL(response.url()).pathname===base+'/tickets'&&response.request().method()==='POST')
   await dialog.getByRole('button',{name:'Create and email',exact:true}).click()
   assert.equal((await refusalResponse).status(),422)
   await dialog.getByText('Delivery reference: Value does not match the required pattern',{exact:true}).first().waitFor()
   assert.equal(await dialog.getByLabel('Subject',{exact:true}).inputValue(),subject,'refusal retains editable draft')
   await page.waitForFunction(id=>document.activeElement?.id===`new-ticket-field-${id}`,reference.id)
   await capture('configuration-error',dialog.getByLabel('Delivery reference *',{exact:true}))
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
   await capture('configured-ticket')
   await page.getByLabel('Delivery reference',{exact:false}).scrollIntoViewIfNeeded()
   await capture('stored-field-values',page.getByLabel('Delivery reference',{exact:false}))
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
   await capture('api-email')
   // Start an email ticket privately in the same dialog, recover a lost response,
   // then contact its requester only through the existing human Send control.
   const beforePrivate=copies().length,privateContent=`Private parcel investigation (${width}).`,laterReply=`Your parcel is ready after review (${width}).`
   await open()
   assert.equal(await dialog.getByLabel('First comment',{exact:true}).inputValue(),'public','email default remains public')
   await dialog.getByLabel('First comment',{exact:true}).selectOption('internal')
   await dialog.getByLabel('Requester email',{exact:true}).fill(requester);await dialog.getByLabel('Subject',{exact:true}).fill(`Private parcel review ${width}`);await dialog.getByLabel('Internal note',{exact:true}).fill(privateContent)
   assert.equal(await dialog.getByLabel('CC',{exact:true}).count(),0);assert.equal(await dialog.getByLabel('BCC',{exact:true}).count(),0)
   const choice=dialog.getByLabel('First comment',{exact:true});await choice.focus();assert.equal(await choice.evaluate(node=>node===document.activeElement),true);assert.ok((await choice.boundingBox()).height>=44)
   await page.keyboard.press('Tab');assert.equal(await choice.evaluate(node=>node===document.activeElement),false,'keyboard moves from the comment choice to the next control')
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
   await capture('new-private-email',choice)
   let lostPrivate,privateIntent
   await page.route('**'+base+'/tickets',async route=>{privateIntent=route.request().postDataJSON();const response=await route.fetch();assert.equal(response.status(),201);lostPrivate=await response.json();await route.abort('failed')},{times:1})
   await dialog.getByRole('button',{name:'Create ticket',exact:true}).click()
   await dialog.getByRole('button',{name:'Check same request',exact:true}).waitFor()
   assert.equal(await choice.isDisabled(),true,'unknown private result keeps its immutable choice')
   assert.equal(copies().length,beforePrivate)
   const privateRecovered=page.waitForResponse(response=>new URL(response.url()).pathname===base+'/tickets'&&response.request().method()==='POST')
   await dialog.getByRole('button',{name:'Check same request',exact:true}).click()
   const recovered=await privateRecovered;assert.equal(recovered.status(),200);const privateTicket=await recovered.json(),privateId=privateTicket.conversation.id
   assert.equal(privateId,lostPrivate.conversation.id);assert.equal(privateTicket.note.id,lostPrivate.note.id);assert.equal(privateTicket.message,undefined)
   assert.equal(privateTicket.conversation.channel,'email');assert.equal(privateTicket.conversation.mailbox_id,mailbox.id);assert.equal(privateTicket.conversation.submitter_id,owner.actor.id)
   await page.waitForURL(`**/conversations/${privateId}`);await page.locator('.transcript-note-content').getByText(privateContent,{exact:true}).waitFor()
   await page.reload();await page.locator('.transcript-note-content').getByText(privateContent,{exact:true}).waitFor()
   const bucket=(await call(`${base}/conversations/${privateId}/buckets/${privateId}`,undefined,owner.token)).data
   assert.equal(bucket.messages.length,0);assert.equal(bucket.events.filter(event=>event.type==='INTERNAL_NOTE'&&event.content===privateContent).length,1)
   assert.equal((await call(`/api/conversations/${privateId}/messages`,undefined,owner.token)).messages.length,0)
   assert.equal((await request({...privateIntent,firstComment:'public'})).status,409);assert.equal(copies().length,beforePrivate,'private creation and changed-intent retry send no mail')
   await page.getByRole('textbox',{name:'Reply to conversation',exact:true}).fill(laterReply)
   await page.getByRole('button',{name:'Send',exact:true}).click();await page.locator('.transcript-message-content').getByText(laterReply,{exact:true}).waitFor()
   await delivered(base,privateId,laterReply)
   const publicCopy=copies().find(copy=>copy.text?.includes(laterReply));assert.ok(!JSON.stringify(publicCopy).includes(privateContent));assert.equal(copies().length,beforePrivate+1)
   assert.deepEqual((await call(`/api/conversations/${privateId}/messages`,undefined,owner.token)).messages.map(message=>message.content),[laterReply])
   await capture('private-email-thread',page.locator('.transcript-note-content').getByText(privateContent,{exact:true}))
   console.log('PROBE OUTBOUND-001-NOTE browser N1/N2/N3: First comment -> internal email note, lost-response replay/reload -> one private note, no mail; explicit Send -> one public mail without note; assertions 1440, dialog/thread captures 1440/390')
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
   await capture('new-call')
   let lostCall
   await page.route('**'+base+'/tickets',async route=>{const response=await route.fetch();assert.equal(response.status(),201);lostCall=await response.json();await route.abort('failed')},{times:1})
   await dialog.getByRole('button',{name:'Log call',exact:true}).click()
   await dialog.getByRole('button',{name:'Check same request',exact:true}).waitFor()
   await capture('configured-call-lost-response')
   const callResponse=page.waitForResponse(response=>new URL(response.url()).pathname===base+'/tickets'&&response.request().method()==='POST')
   await dialog.getByRole('button',{name:'Check same request',exact:true}).click();const logged=await callResponse;assert.equal(logged.status(),200)
   const callTicket=await logged.json();assert.equal(callTicket.conversation.id,lostCall.conversation.id);assert.equal(callTicket.duplicate,true);assert.equal(callTicket.conversation.channel,'phone');assert.notEqual(callTicket.conversation.contact_id,created.conversation.contact_id);assert.equal(callTicket.conversation.assigned_to,null);assert.equal(callTicket.note.content,`Confirmed collection time (${width}).`)
   assert.equal(callTicket.message,undefined)
   const apiCall={kind:'call',localId:`synthetic-happytohelp-api-call-${width}`,requesterId:created.conversation.contact_id,subject:`Call follow-up ${width}`,content:'Synthetic private collection instructions.'}
   const loggedApi=await request(apiCall);assert.equal(loggedApi.status,201);assert.equal(loggedApi.body.conversation.channel,'phone');assert.equal(loggedApi.body.note.content,apiCall.content)
   assert.equal((await request(apiCall)).body.note.id,loggedApi.body.note.id)
   assert.equal((await request({...apiCall,localId:`synthetic-happytohelp-call-cc-${width}`,cc:['synthetic-happytohelp-1@customer.example']})).status,400)
   assert.equal(copies().length,beforeCalls,'dialog/API call logs send no mail, including retries')
   // The same native dialog creates a consented WhatsApp ticket. Only HTTP at
   // the provider boundary is faked; refusals leave the complete draft editable.
   const channelRoot=`/api/support-channels/projects/${projectId}`;
   const wa=(await call(channelRoot+'/connections',{provider:'whatsapp',account:'synthetic-happytohelp-outbound',sender:'synthetic-happytohelp-phone',token:'synthetic-happytohelp-token',signing_secret:'synthetic-happytohelp-signature'},owner.token)).data;
   const consentRaw=JSON.stringify({entry:[{id:'synthetic-happytohelp-outbound',changes:[{value:{metadata:{phone_number_id:'synthetic-happytohelp-phone'},messages:[{id:'synthetic-happytohelp-consent',from:'12025550124',timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:'I agree to WhatsApp support updates'}}]}}]}]});
   const consentResponse=await fetch(runtime.origin+'/api/support-channels/webhooks/'+wa.id,{method:'POST',headers:{'Content-Type':'application/json','X-Hub-Signature-256':'sha256='+createHmac('sha256','synthetic-happytohelp-signature').update(consentRaw).digest('hex')},body:consentRaw});assert.equal(consentResponse.status,200);
   await open();await dialog.getByLabel('Ticket type',{exact:true}).selectOption('whatsapp');
   await dialog.getByLabel('Requester phone',{exact:true}).fill('+12025550125');await dialog.getByLabel('Support channel',{exact:true}).selectOption(wa.id);await dialog.getByLabel('Approved utility template',{exact:true}).selectOption('synthetic-happytohelp-template');await dialog.getByLabel('Template variables',{exact:true}).fill('DEL-42');await dialog.getByLabel('Subject',{exact:true}).fill('Your parcel is ready');
   await capture('new-whatsapp');
   const preSend=(runtime.logs.match(/CHANNEL_FIXTURE_SEND /g)||[]).length;
   await dialog.getByRole('button',{name:'Create and send',exact:true}).click();await dialog.getByRole('alert').filter({hasText:/No recorded customer consent/}).waitFor();
   assert.equal(await dialog.getByLabel('Template variables',{exact:true}).inputValue(),'DEL-42');assert.equal(await dialog.getByLabel('Subject',{exact:true}).inputValue(),'Your parcel is ready');assert.equal(await dialog.getByRole('button',{name:'Cancel',exact:true}).isEnabled(),true);assert.equal((runtime.logs.match(/CHANNEL_FIXTURE_SEND /g)||[]).length,preSend);
   await capture('whatsapp-refused-draft');
   await dialog.getByLabel('Requester phone',{exact:true}).fill('+12025550124');
   for(const selector of ['#new-ticket-kind','#new-ticket-requesterPhone','#new-ticket-connection','#new-ticket-template','#new-ticket-parameters']){const size=await dialog.locator(selector).boundingBox();assert.ok(size.height>=44);}
   await dialog.getByLabel('Requester phone',{exact:true}).focus();assert.equal(await page.locator(':focus').count(),1);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   const channelResult=page.waitForResponse(response=>new URL(response.url()).pathname===base+'/tickets'&&response.request().method()==='POST');await dialog.getByRole('button',{name:'Create and send',exact:true}).click();const channelCreated=await channelResult;assert.equal(channelCreated.status(),201,await channelCreated.text());const channelTicket=await channelCreated.json();assert.equal(channelTicket.delivery.state,'accepted');await dialog.waitFor({state:'hidden'});assert.equal((runtime.logs.match(/CHANNEL_FIXTURE_SEND /g)||[]).length,preSend+1);
   await page.goto(`${runtime.origin}/projects/${projectId}/conversations/${channelTicket.conversation.id}`);await page.locator('.transcript-message-content').getByText('Your order DEL-42 is ready.',{exact:true}).waitFor();await capture('whatsapp-created-ticket');
   console.log('PROBE OUTBOUND-001 4: New ticket WhatsApp form at 1440 -> consent refusal retains draft; correction sends approved template; captures at 1440/390, 44px targets, one focused control, no overflow');
   // Narrow the current native role while retaining workspace membership.
   await runtime.execute(`UPDATE memberships SET role='operator' WHERE project_id='${projectId}' AND user_id='${owner.actor.id}'; UPDATE sessions SET role='operator' WHERE project_id='${projectId}' AND actor_id='${owner.actor.id}'; INSERT INTO member_roles(project_id,user_id,role_key,assigned_at) VALUES('${projectId}','${owner.actor.id}','collaborator',1)`)
   await open()
   await dialog.getByRole('alert').filter({hasText:/allow|authority|permission/i}).waitFor()
   assert.equal(await dialog.getByRole('button',{name:'Create and email',exact:true}).isDisabled(),true)
   await capture('denied-create-authority')
   await dialog.getByRole('button',{name:'Cancel',exact:true}).click()
   await runtime.execute(`DELETE FROM member_roles WHERE project_id='${projectId}' AND user_id='${owner.actor.id}'; UPDATE memberships SET role='owner' WHERE project_id='${projectId}' AND user_id='${owner.actor.id}'; UPDATE sessions SET role='owner' WHERE project_id='${projectId}' AND actor_id='${owner.actor.id}'`)
   await context.close()
  }
  assert.deepEqual(errors,[]);success=true
 }finally{await browser.close();await runtime.close(success)}
}
