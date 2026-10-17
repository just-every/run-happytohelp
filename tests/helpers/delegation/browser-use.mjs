import assert from 'node:assert/strict'
import {mkdtemp} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {assistantDraftFixture,visitorConversation} from '../assistant-draft-fixture.mjs'
import {hero} from '../hero/flow.mjs'
import {png} from './adoption.mjs'

const owners=messages=>messages.filter(message=>message.actor_role==='owner')

// A paired connector resolves a visitor's request, then the person reviews its proposed reply with Use and presses Send.
async function heroAtWidth({runtime,browser,shot,viewport}){
 const tenant=await runtime.seedTenant({name:'Hero '+viewport.width,email:`owner-${viewport.width}@hero.test`,allowedOrigin:runtime.origin})
 const context=await browser.newContext({viewport}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message))
 try{
  await context.addCookies([{name:'h2h_session',value:tenant.token,url:runtime.origin}])
  const widgetKey=(await (await context.request.get(runtime.origin+`/api/identity/projects/${tenant.projectId}`)).json()).widget_key
  const article={slug:'contact-your-support-team',title:'Contact your support team',content:'Open the website chat widget, type your question, and press Send. The support team can reply in the same conversation.',summary:'Contact the support team.',status:'draft'}
  const created=await context.request.post(runtime.origin+`/api/knowledge/${tenant.projectId}/articles`,{data:article});assert.equal(created.status(),201);article.id=(await created.json()).id
  const directory=await mkdtemp(shot(`hero-${viewport.width}-`))
  await hero({browser,operator:{context,page,cookie:`h2h_session=${tenant.token}`},origin:runtime.origin,bootstrap:{projectId:tenant.projectId,userId:tenant.userId,widgetKey,article},directory,viewport})
  assert.deepEqual(errors,[])
 }finally{await context.close()}
}

// Use at one width: it waits for history, hands the draft and its files to the composer once, and only Send sends.
async function useAtWidth({runtime,browser,shot,width,kind,races}){
 const viewport={width,height:900},context=await browser.newContext({viewport}),page=await context.newPage(),errors=[];let visitor
 page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept())
 try{
  const tenant=await runtime.seedTenant({name:`Use ${width}`,email:randomUUID()+'@use.test',allowedOrigin:runtime.origin})
  await context.addCookies([{name:'h2h_session',value:tenant.token,url:runtime.origin}])
  const project=await (await context.request.get(runtime.origin+`/api/identity/projects/${tenant.projectId}`)).json()
  visitor=await visitorConversation({browser,origin:runtime.origin,widgetKey:project.widget_key,projectId:tenant.projectId,viewport})
  const fixture=await assistantDraftFixture(runtime,context,visitor.session,tenant,width)
  const savedReply={title:'Handoff saved reply',content:'Saved reply still inserts.'};assert.ok((await context.request.post(runtime.origin+`/api/dashboard/projects/${tenant.projectId}/macros`,{data:savedReply})).ok())
  const panel=page.locator('#conversation-assistant'),composer=page.getByRole('textbox',{name:'Reply to conversation',exact:true}),compact=width<1280
  const openLocal=async()=>{const toggle=page.getByRole('button',{name:'Show conversation panel',exact:true});if(await toggle.isVisible())await toggle.click();await page.getByRole('tab',{name:'Local',exact:true}).click()}
  const handedOff=async body=>{
   await page.waitForFunction(expected=>document.querySelector('textarea[aria-label="Reply to conversation"]')?.value===expected,body)
   assert.equal(await panel.getAttribute('aria-hidden'),String(compact));if(compact)await panel.waitFor({state:'hidden'});else assert.ok(await panel.isVisible(),'the permanent desktop column stays open')
   await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Reply to conversation')
  }

  // A global deep link with genuinely pending history: neither Use is possible until the real transcript arrives.
  const bucketPath=`/api/dashboard/projects/${tenant.projectId}/conversations/${visitor.session.conversationId}/buckets`;let release,bucketStatus
  const held=new Promise(done=>{release=done})
  await page.route(url=>url.pathname===bucketPath,async route=>{const response=await route.fetch();bucketStatus=response.status();await held;await route.fulfill({response})})
  const requested=page.waitForRequest(request=>new URL(request.url()).pathname===bucketPath)
  await page.goto(runtime.origin+`/conversations/${visitor.session.conversationId}`);await composer.waitFor();await requested;await openLocal()
  const use=page.getByRole('button',{name:'Use Reviewed reply',exact:true});await use.waitFor();await page.getByText('Evidence and details',{exact:true}).click()
  assert.ok(await use.isDisabled(),'Use waits for conversation history');assert.ok(await panel.locator('.delegation-job__draft').getByRole('button',{name:'Use',exact:true}).isDisabled(),'legacy Use obeys the same readiness');assert.equal(await composer.inputValue(),'')
  if(compact){
   await page.getByRole('tab',{name:'Local',exact:true}).click();await page.keyboard.press('Shift+Tab');assert.ok(await panel.evaluate(element=>element.contains(document.activeElement)),'the open compact sheet traps backwards Tab')
   await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement?.id),'conversation-tab-local','and wraps to its first control')
   await page.keyboard.press('Escape');await panel.waitFor({state:'hidden'});assert.ok(await page.getByRole('button',{name:'Show conversation panel',exact:true}).evaluate(element=>element===document.activeElement),'Escape returns focus to the opener');await openLocal()
  }
  release();const [adoption]=await Promise.all([page.waitForResponse(response=>response.url().endsWith('/result/draft')&&response.request().method()==='POST'),use.click()]);await page.unrouteAll({behavior:'wait'})
  assert.equal(bucketStatus,200);assert.equal(adoption.status(),200);await handedOff(fixture.body)
  await page.keyboard.type(' Edited by the operator.');const edited=fixture.body+' Edited by the operator.';assert.equal(await composer.inputValue(),edited)
  await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement?.id),'conversation-composer-tools','Tab reaches Reply tools, not the assistant')
  await page.keyboard.press('Shift+Tab');assert.ok(await composer.evaluate(element=>element===document.activeElement))
  assert.equal(owners(await visitor.transcript()).length,0,'Use and editing never send')
  await page.screenshot({path:shot(`before-send-${width}.png`)})
  // Deliberately no Hide, Escape or dismissal between Use and Send.
  await page.getByRole('button',{name:'Send',exact:true}).click();await visitor.page.getByText(edited,{exact:true}).waitFor()
  const sent=owners(await visitor.transcript());assert.equal(sent.length,1);assert.equal(sent[0].content,edited);assert.equal(visitor.frames.find(frame=>frame.message?.id===sent[0].id)?.message.content,edited,'the visitor socket carries the same message')

  // Use of a reply with a screenshot, twice: one native copy of the file, owned by the operator, sent with the edited reply.
  const button=kind==='local'?page.getByRole('button',{name:'Use Reply with screenshot',exact:true}):panel.locator('.delegation-job__draft').getByRole('button',{name:'Use',exact:true}),body=kind==='local'?'Screenshot draft.':fixture.legacy
  const adopt=async()=>{
   await openLocal();if(kind==='legacy'&&!await panel.locator('.delegation-job__draft button').isVisible())await panel.getByText('Evidence and details',{exact:true}).click()
   const [response]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/result/draft')&&r.request().method()==='POST'),button.click()]);assert.equal(response.status(),200,await response.text())
   const draft=(await response.json()).data;assert.equal(draft.body,body);assert.equal(draft.attachments.length,1);assert.notEqual(draft.attachments[0].id,fixture.attachment.id)
   await handedOff(body);assert.equal(await page.locator('.conversation-composer__files img[alt="handoff.png"]').count(),1);return draft
  }
  const first=await adopt(),second=await adopt();assert.equal(first.attachments[0].id,second.attachments[0].id,'repeated Use deduplicates native media')
  const withFile=body+' Reviewed '+randomUUID();await page.keyboard.type(withFile.slice(body.length))
  const [sendResponse]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/messages')&&r.request().method()==='POST'),page.getByRole('button',{name:'Send',exact:true}).click()])
  assert.equal(sendResponse.status(),200);assert.deepEqual(sendResponse.request().postDataJSON().mediaIds,[first.attachments[0].id])
  await visitor.page.getByText(withFile,{exact:true}).waitFor()
  const messages=owners(await visitor.transcript()),attached=messages.find(message=>message.content===withFile);assert.equal(messages.length,2);assert.equal(attached.actor_id,tenant.userId);assert.equal(attached.media[0].id,first.attachments[0].id)
  assert.equal(visitor.frames.find(frame=>frame.message?.id===attached.id)?.message.media[0].id,first.attachments[0].id)
  const download=await visitor.context.request.get(runtime.origin+first.attachments[0].url,{headers:{Authorization:'Bearer '+visitor.session.token}});assert.equal(download.status(),200);assert.deepEqual(await download.body(),png)
  await visitor.page.reload();await visitor.mount();await visitor.page.getByText(withFile,{exact:true}).waitFor()
  assert.deepEqual(owners(await visitor.transcript()).map(({id,content,media})=>({id,content,media})),messages.map(({id,content,media})=>({id,content,media})),'the visitor sees exactly the same messages after reload')

  // Leaving through native navigation discards an unsent draft; ordinary typing and saved replies still work.
  const url=runtime.origin+`/projects/${tenant.projectId}/conversations/${visitor.session.conversationId}`;await page.goto(url);await composer.waitFor()
  await openLocal();await page.getByRole('button',{name:'Use Reviewed reply',exact:true}).click();await handedOff(fixture.body)
  const navigation=page.getByRole('button',{name:'Toggle navigation',exact:true});if(await navigation.isVisible())await navigation.click()
  await page.getByTestId('nav-settings').click();await page.waitForURL('**/edit');await composer.waitFor({state:'detached'})
  await page.goBack();await page.waitForURL(url);await composer.waitFor();assert.equal(await composer.inputValue(),'');assert.equal(await page.locator('.conversation-composer__files').count(),0)
  await composer.fill('Ordinary typing still works.');await page.getByRole('button',{name:'Reply tools',exact:true}).click();await page.getByRole('menuitem',{name:'Saved replies',exact:true}).click();await page.getByRole('link',{name:savedReply.title,exact:true}).click()
  await page.locator('.saved-replies-picker').waitFor({state:'hidden'})
  assert.ok((await composer.inputValue()).includes('Ordinary typing still works.'));assert.ok((await composer.inputValue()).includes(savedReply.content))
  const savedText=await composer.inputValue()
  await composer.fill('');assert.equal(owners(await visitor.transcript()).length,2)
  // Macro drafts persist across reloads. Review and send this one before the
  // separate late-assistant-response checks, which start with an empty composer.
  await composer.fill(savedText)
  await page.getByRole('button',{name:'Send',exact:true}).click();await visitor.page.getByText(savedText,{exact:true}).waitFor()
  assert.equal(owners(await visitor.transcript()).length,3)

  if(races){
   // A late Use response never overwrites a later human edit, files or focus.
   const fresh=await assistantDraftFixture(runtime,context,visitor.session,tenant,width);await page.reload();await composer.waitFor()
   const holdDraft=async()=>{let releaseDraft,arrived;const draftHeld=new Promise(done=>{releaseDraft=done}),ready=new Promise(done=>{arrived=done})
    await page.route('**/result/draft',async route=>{const response=await route.fetch();arrived(response.status());await draftHeld;try{await route.fulfill({response})}catch(error){if(!/closed|cancel|disposed/i.test(error.message))throw error}})
    await openLocal();await page.getByRole('button',{name:'Use Reply with screenshot',exact:true}).first().click();assert.equal(await ready,200);await page.keyboard.press('Escape');return releaseDraft}
   let releaseDraft=await holdDraft()
   const later='Keep this later human edit '+randomUUID();await composer.fill(later);await page.getByRole('button',{name:'Show conversation panel',exact:true}).focus()
   releaseDraft();await page.unrouteAll({behavior:'wait'})
   assert.equal(await composer.inputValue(),later);assert.equal(await page.locator('.conversation-composer__files').count(),0);assert.ok(await page.getByRole('button',{name:'Show conversation panel',exact:true}).evaluate(element=>element===document.activeElement))
   // A response landing after navigating away restores nothing on return.
   await composer.fill('');releaseDraft=await holdDraft()
   if(await navigation.isVisible())await navigation.click();await page.getByTestId('nav-settings').click();await page.waitForURL('**/edit');await composer.waitFor({state:'detached'})
   releaseDraft();await page.unrouteAll({behavior:'wait'});await page.goBack();await page.waitForURL(url);await composer.waitFor()
   assert.equal(await composer.inputValue(),'');assert.equal(await page.locator('.conversation-composer__files').count(),0);assert.equal(await composer.evaluate(element=>element===document.activeElement),false)
   // The visible result loses its device's authority: the failure shows in the Local panel and nothing is inserted.
   await openLocal();const jobs=await (await context.request.get(runtime.origin+`/api/projects/${tenant.projectId}/conversations/${visitor.session.conversationId}/delegations`)).json()
   assert.equal((await context.request.delete(runtime.origin+`/api/projects/${tenant.projectId}/local-agents/${jobs.data.find(job=>job.id===fresh.jobId).device_id}`)).status(),200)
   const [denied]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/result/draft')),page.getByRole('button',{name:'Use Reply with screenshot',exact:true}).first().click()])
   assert.equal(denied.status(),409);await page.locator('.delegation-panel__error').waitFor();assert.equal(await composer.inputValue(),'');assert.equal(await page.locator('.conversation-composer__files').count(),0)
   assert.equal(await panel.getAttribute('aria-hidden'),'false');assert.equal(owners(await visitor.transcript()).length,3)
  }
  await page.screenshot({path:shot(`use-${width}.png`)})
  assert.deepEqual(errors,[])
 }finally{await visitor?.context.close();await context.close()}
}

export async function useBrowserJourney({runtime,browser,shot,widths}){
 await heroAtWidth({runtime,browser,shot,viewport:{width:widths[0],height:widths[0]<1280?844:900}})
 await useAtWidth({runtime,browser,shot,width:widths[0],kind:'local',races:widths[0]<1280})
 await useAtWidth({runtime,browser,shot,width:widths[1],kind:'legacy',races:false})
}
