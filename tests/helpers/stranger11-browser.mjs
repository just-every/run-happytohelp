import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {createRuntime} from './emitted-runtime.mjs'
import {launchBrowser,viewports,evidence} from '../journeys/kit/browser.mjs'

export async function strangerFixture({vars={}}={}){
 const runtime=await createRuntime({vars:{H2H_LOCAL:'true',EMAIL_PROVIDER:'development',EMAIL_FROM:'support@localhost.test',...vars}}),origin=runtime.origin,browser=await launchBrowser()
 const owner={email:'synthetic-hh-owner@example.test',password:'synthetic-hh-owner-password',name:'Damage support',ownerName:'Owner'}
 const api=async(path,body,token,method=body===undefined?'GET':'POST',headers={})=>{
  const response=await fetch(origin+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{ }),...headers},body:body===undefined?undefined:JSON.stringify(body)})
  assert.ok(response.ok,`${method} ${path}: ${response.status} ${await response.clone().text()}`);return response.json()
 }
 const {projectId}=await api('/api/identity/bootstrap',{...owner,allowedOrigin:origin}),{token}=await api('/api/identity/login',owner),base=`/api/dashboard/projects/${projectId}`
 const request=(path,body,method)=>api(path,body,token,method),project=await request(`/api/identity/projects/${projectId}`)
 await runtime.presenceAwayOff(projectId)
 const context=await browser.newContext({viewport:viewports.desktop}),page=await context.newPage();page.setDefaultTimeout(20000)
 const signIn=async(target,who,returnTo)=>{await target.goto(origin+'/login?'+new URLSearchParams({returnTo}));await target.getByLabel('Email',{exact:true}).fill(who.email);await target.getByLabel('Password',{exact:true}).fill(who.password);await target.getByRole('button',{name:'Login',exact:true}).click();await target.waitForURL('**'+returnTo)}
 await signIn(page,owner,`/projects/${projectId}/conversations`)
 const ticket=async(name)=>{
  const visitor=await api('/api/identity/widget/session',{widgetKey:project.widget_key,name,email:`${name.toLowerCase()}@example.test`},undefined,'POST',{Origin:origin}),conversation=await api('/api/conversations',{projectId},visitor.token)
  await api(`/api/conversations/${conversation.id}/messages`,{localId:'opening',content:'My order arrived damaged.',expectedRevision:0},visitor.token)
  return {...conversation,visitor}
 }
 return {runtime,browser,context,page,origin,owner,projectId,base,api,request,signIn,ticket,close:async success=>{await browser.close();await runtime.close(success)}}
}
async function openTicketPanel(page){
 const show=page.getByRole('button',{name:'Show conversation panel',exact:true});if(await show.isVisible())await show.click()
 await page.getByRole('tab',{name:'Ticket',exact:true}).click()
}
// A breakpoint change updates the assistant in a matchMedia handler. Wait for
// React to apply it before choosing Show/Hide, whose accessible name changes too.
async function ticketViewport(page,viewport){
 const crossed=(page.viewportSize().width>=1280)!==(viewport.width>=1280)
 await page.setViewportSize(viewport)
 if(crossed)await page.waitForFunction(desktop=>document.querySelector('#conversation-assistant')?.getAttribute('aria-hidden')===String(!desktop),viewport.width>=1280)
}
export async function macroHandoffBrowser(){
 const f=await strangerFixture(),{page,browser,origin,projectId,base,request}=f,shot=await evidence('stranger11-after-macro');let success=false
 try{
  const mia=await f.ticket('Mia'),ownerId=(await request('/api/management/bootstrap')).currentAgent.id
  await request(`${base}/conversations/${mia.id}/ticket`,{agent_id:ownerId},'PATCH')
  await page.goto(`${origin}/projects/${projectId}/agents/create`)
  await page.getByLabel('Email',{exact:true}).fill('synthetic-hh-lena@example.test')
  const invite=page.waitForResponse(r=>r.url().endsWith(`/api/management/projects/${projectId}/agents`)&&r.request().method()==='POST')
  await page.getByRole('button',{name:'Invite',exact:true}).click()
  const invitation=(await (await invite).json()).data
  // The UI shows the same invitation link for sharing when local mail is suppressed.
  await page.getByRole('button',{name:'Copy invitation link',exact:true}).waitFor()
  const teammate=await browser.newContext({viewport:viewports.desktop}),lena=await teammate.newPage()
  await lena.goto(invitation.invitationUrl)
  await lena.getByLabel('Your name',{exact:true}).fill('Lena Patel')
  await lena.getByLabel('Password',{exact:true}).fill('synthetic-hh-lena-password')
  await lena.getByRole('button',{name:'Create account and join',exact:true}).click()
  await lena.getByRole('link',{name:'Sign in',exact:true}).click()
  await lena.getByLabel('Password',{exact:true}).fill('synthetic-hh-lena-password')
  await lena.getByRole('button',{name:'Login',exact:true}).click();await lena.waitForURL('**/conversations')
  await teammate.close()
  const lenaId=(await request(`/api/management/projects/${projectId}/agents`)).data.find(member=>member.name==='Lena Patel').id
  await page.goto(`${origin}/projects/${projectId}/macros/create`)
  await page.getByLabel('Title',{exact:true}).fill('Request damage photo')
  await page.getByLabel('Reply text',{exact:true}).fill('Please send a damage photo, ')
  await page.getByRole('button',{name:'Insert a name',exact:true}).click()
  await page.getByLabel('Reply text',{exact:true}).press('End')
  await page.getByLabel('Reply text',{exact:true}).pressSequentially('. Ticket {{ticket.id}}.')
  await page.getByText('More options',{exact:true}).click()
  await page.getByLabel('Status',{exact:true}).selectOption({label:'Pending'})
  await page.getByLabel('Assignee',{exact:true}).selectOption({label:'Lena Patel'})
  await page.getByRole('button',{name:'Save',exact:true}).click();await page.getByText('Saved.',{exact:true}).waitFor()
  await page.goto(`${origin}/projects/${projectId}/conversations/${mia.id}`)
  await page.getByRole('button',{name:'Actions',exact:true}).waitFor()
  const hide=page.getByRole('button',{name:'Hide conversation panel',exact:true});if(await hide.isVisible())await hide.click()
  await page.getByRole('button',{name:'Actions',exact:true}).click();await page.getByRole('menuitem',{name:'Saved replies',exact:true}).click();await page.getByRole('link',{name:'Request damage photo',exact:true}).click()
  const preview=page.getByRole('region',{name:'Saved reply preview'});await preview.waitFor();assert.match(await preview.innerText(),/Owner → Lena Patel/)
  for(const viewport of [viewports.desktop,viewports.mobile]){await ticketViewport(page,viewport);await page.screenshot({path:shot(`${viewport.width}-preview.png`),fullPage:true})}
  await ticketViewport(page,viewports.desktop)
  await page.getByRole('button',{name:'Use saved reply',exact:true}).click()
  const composer=page.getByRole('textbox',{name:'Reply to conversation'});await page.waitForFunction(()=>document.querySelector('[aria-label="Reply to conversation"]')?.value?.startsWith('Please send'))
  assert.match(await composer.inputValue(),/Please send a damage photo, Mia/,'the inserted name renders for the actual requester')
  const edited='Please send a damage photo of the outer box too.';await composer.fill(edited)
  const sent=page.waitForResponse(r=>r.url().endsWith(`/api/conversations/${mia.id}/messages`)&&r.request().method()==='POST')
  await page.getByRole('button',{name:'Send',exact:true}).click();assert.equal((await sent).status(),200)
  await page.locator('.transcript-message-content').getByText(edited,{exact:true}).waitFor()
  await page.reload();await page.locator('.transcript-message-content').getByText(edited,{exact:true}).waitFor()
  await openTicketPanel(page)
  const assignment=page.getByRole('button',{name:/Assign conversation\. Current assignment:/});await assignment.waitFor()
  const after=(await request(`${base}/conversations/${mia.id}/ticket`)).data
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'the ticket fits the desktop')
  for(const viewport of [viewports.desktop,viewports.mobile]){if(viewport.width===390&&await hide.isVisible())await hide.click();await ticketViewport(page,viewport);await page.screenshot({path:shot(`${viewport.width}-sent.png`),fullPage:true})}
  const receipt={assignmentPreserved:after.assigned_to===lenaId,assignee:after.assigned_to===lenaId?'Lena Patel':'Owner',editedReplyPersisted:true}
  await writeFile(shot('result.json'),JSON.stringify(receipt,null,2))
  assert.equal(after.assigned_to,lenaId,'ordinary Send preserves the explicit macro handoff');await ticketViewport(page,viewports.desktop);await openTicketPanel(page);assert.match(await assignment.getAttribute('aria-label'),/Lena Patel/)
  await assignment.click();await page.getByRole('menuitem',{name:/\bOwner$/}).click();await page.getByRole('button',{name:'Assign conversation. Current assignment: Owner',exact:true}).waitFor()
  assert.equal((await request(`${base}/conversations/${mia.id}/ticket`)).data.assigned_to,ownerId,'the sender can explicitly take over')
  success=true;return receipt
 }finally{await f.close(success)}
}
export async function formFieldBrowser(){
 const f=await strangerFixture(),{page,origin,projectId,base,request}=f,shot=await evidence('stranger11-after-fields');let success=false
 try{
  await page.goto(`${origin}/projects/${projectId}/ticket-settings`);await page.getByRole('button',{name:'Fields',exact:true}).click();await page.getByRole('button',{name:'New field',exact:true}).click();await page.getByLabel('Name',{exact:true}).fill('Order number');await page.getByRole('button',{name:'Create',exact:true}).click();await page.getByText('Saved.',{exact:true}).waitFor()
  const field=(await request(base+'/ticket-fields')).data.find(field=>field.name==='Order number'),checks=[]
  const openForm=async()=>{await page.goto(`${origin}/projects/${projectId}/edit?tab=forms`);await page.getByRole('button',{name:'New request form',exact:true}).click();await page.getByLabel('Add ticket field',{exact:true}).waitFor()}
  await openForm()
  checks.push({setting:'default',eligible:await page.getByLabel('Add ticket field',{exact:true}).locator('option').filter({hasText:'Order number'}).count()===1})
  await page.getByLabel('Add ticket field',{exact:true}).selectOption(field.id)
  await page.screenshot({path:shot('1440-default.png'),fullPage:true})
  await page.getByRole('button',{name:'Add field',exact:true}).click();await page.getByLabel('Form name',{exact:true}).fill('Order problem');await page.getByLabel('Publish this form',{exact:true}).check();await page.getByRole('button',{name:'Create form',exact:true}).click();await page.getByText('Saved.',{exact:true}).waitFor();const form=(await request(`/api/forms/projects/${projectId}/forms`)).data.find(form=>form.title==='Order problem');assert.ok((await request(`/api/forms/${projectId}/${form.id}`)).data.fields.some(f=>f.id===field.id),'published public form includes the default field')
  await page.goto(`${origin}/projects/${projectId}/ticket-settings`);await page.getByRole('button',{name:'Fields',exact:true}).click();await page.locator('article.ticket-settings-item').filter({has:page.getByRole('heading',{name:'Order number',exact:true})}).getByRole('button',{name:'Edit',exact:true}).click()
  const read=page.getByRole('group',{name:'Roles that can read this field',exact:true});for(const checkbox of await read.getByRole('checkbox').all())await checkbox.uncheck()
  await page.getByRole('button',{name:'Save changes',exact:true}).click();await page.getByText('Saved.',{exact:true}).waitFor()
  await openForm();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'the form editor fits the desktop');checks.push({setting:'empty read list, default edit list',eligible:await page.getByLabel('Add ticket field',{exact:true}).locator('option').filter({hasText:'Order number'}).count()===1})
  await page.getByLabel('Add ticket field',{exact:true}).selectOption(field.id)
  for(const viewport of [viewports.desktop,viewports.mobile]){await page.setViewportSize(viewport);await page.screenshot({path:shot(`${viewport.width}-empty-read.png`),fullPage:true})}
  await writeFile(shot('result.json'),JSON.stringify({checks},null,2));assert.ok(checks.every(check=>check.eligible),'both documented every-role read settings reach the selector')
  success=true;return checks
 }finally{await f.close(success)}
}
