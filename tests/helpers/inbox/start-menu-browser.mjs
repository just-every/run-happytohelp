import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {createRuntime} from '../emitted-runtime.mjs'
import {buildInboxFixture} from '../inbox-conversation-fixture.mjs'
import {launchBrowser} from '../../journeys/kit/browser.mjs'

// The reply card's "+" start menu ("Actions") is the one door to every ticket-level action (CONVERSATION-002 merge and
// forward, QUEUE-003 follow and internal CC, QUEUE-004 snooze and scheduled replies, ESCALATION-001, MAIL-001 CC/BCC).
// Each row keeps its permission check: an owner reaches every dialog, a role without conversations.manage never sees
// Merge or Snooze, and a collaborator's notes-only box offers only Internal note, Follow and (when permitted) Internal CC.
const PASSWORD='synthetic-start-menu-member-2026'
const ticketRows=['Internal CC…','Snooze…','Schedule reply…','Merge ticket…','Forward to partner…','Escalate to engineering…']
const dialogTitles={'Internal CC…':'Internal CC','Snooze…':'Snooze ticket','Schedule reply…':'Schedule a reply','Merge ticket…':'Merge duplicate tickets','Forward to partner…':'Forward to an external partner','Escalate to engineering…':'Escalate to engineering'}

export async function startMenu(){
 const evidence=join(process.env.H2H_EVIDENCE_DIR?resolve(process.env.H2H_EVIDENCE_DIR):tmpdir(),'start-menu')
 await mkdir(evidence,{recursive:true})
 const runtime=await createRuntime({vars:{H2H_LOCAL:'true',EMAIL_PROVIDER:'development',EMAIL_FROM:'support@localhost.test'}})
 const browser=await launchBrowser(),problems=[]
 let success=false
 try{
  const fx=await buildInboxFixture(runtime.origin)
  const call=async(path,body,token,method=body===undefined?'GET':'POST')=>{
   const response=await fetch(runtime.origin+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)})
   const text=await response.text();assert.ok(response.ok,`${method} ${path}: ${response.status} ${text}`);return JSON.parse(text)
  }
  const ownerToken=(await call('/api/identity/login',{email:fx.owner.email,password:fx.owner.password})).token
  const P=`/api/management/projects/${fx.projectId}`
  const member=async(email,name,role)=>{
   const invited=await call(`${P}/agents`,{email,role},ownerToken)
   await call('/api/identity/accept-token',{token:new URL(invited.data.invitationUrl).searchParams.get('token'),name,password:PASSWORD})
   return call('/api/identity/login',{email,password:PASSWORD})
  }
  // A role over Agent without conversations.manage: it replies, notes and follows, but never merges or snoozes.
  const replier=await member('replier@example.test','Riley Replier','operator')
  const role=(await call(`${P}/roles`,{name:'Replies only',base:'operator',permissions:['conversations.reply','conversations.notes','conversations.follow']},ownerToken)).data
  await call(`${P}/agents/${replier.actor.id}`,{role:role.id},ownerToken,'PUT')
  const collaborator=await member('collaborator@example.test','Casey Collaborator','collaborator')
  const conversationPath=`/projects/${fx.projectId}/conversations/${fx.contacts.draft.id}`

  for(const width of [1440,390]){
   const open=async token=>{
    const context=await browser.newContext({viewport:{width,height:width===390?844:900}})
    await context.addCookies([{name:'h2h_session',value:token,url:runtime.origin}])
    const page=await context.newPage();page.setDefaultTimeout(15000)
    page.on('pageerror',error=>problems.push(`${width}: ${error.message}`))
    await page.goto(runtime.origin+conversationPath)
    return {context,page}
   }
   const rows=async(page,toggle)=>{
    await toggle.click()
    const menu=page.getByRole('menu',{name:'Actions'});await menu.waitFor()
    const names=(await menu.locator('[role=menuitem],[role=menuitemcheckbox]').allInnerTexts()).map(name=>name.trim())
    await page.keyboard.press('Escape');await menu.waitFor({state:'hidden'})
    return names
   }
   // Below 1280px the Ticket panel is an overlay over the card; it steps aside before the next "+".
   const panelAside=async page=>{if(width<1280&&await page.locator('#conversation-assistant').getAttribute('aria-hidden')==='false'){await page.keyboard.press('Escape');await page.locator('#conversation-assistant[aria-hidden=true]').waitFor({state:'attached'})}}

   // Owner: every Ticket row opens its dialog, and focus comes back to "+".
   {
    const {context,page}=await open(ownerToken)
    const actions=page.locator('#conversation-composer-tools')
    await page.getByRole('textbox',{name:'Reply to conversation'}).waitFor()
    assert.equal(await page.evaluate(()=>document.querySelector('#chat .chat-content')?.nextElementSibling?.classList.contains('chat-footer')),true,'nothing sits between the thread and the reply card')
    assert.equal(await actions.getAttribute('aria-label'),'Actions')
    const follow=page.getByRole('menuitemcheckbox',{name:/^Follow(ing)?$/})
    await actions.click();await follow.and(page.locator(':not(.disabled)')).waitFor()
    const following=await follow.getAttribute('aria-checked')==='true';await page.keyboard.press('Escape')
    const names=await rows(page,actions)
    for(const row of [...ticketRows,'Mark as problem…','Start timer'])assert.ok(names.includes(row),`${width}: owner sees ${row}: ${names}`)
    for(const row of ticketRows){
     await actions.click();await page.getByRole('menuitem',{name:row,exact:true}).click()
     const dialog=page.getByRole('dialog').filter({hasText:dialogTitles[row]});await dialog.waitFor()
     await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'})
     assert.ok(await actions.evaluate(element=>element===document.activeElement),`${width}: ${row} returns focus to Actions`)
    }
    await actions.click();await page.getByRole('menuitem',{name:'Mark as problem…',exact:true}).click()
    await page.locator('#conversation-tab-details[aria-selected=true]').waitFor()
    await page.waitForFunction(()=>document.activeElement?.textContent==='Mark as problem')
    assert.equal(await page.locator('#ticket-section-problem-heading').getAttribute('aria-expanded'),'true')
    await panelAside(page)
    // Follow toggles in place; Ticket › Summary › Followers shows the same state.
    const followers=()=>page.locator('.ticket-summary__row').filter({has:page.locator('dt',{hasText:/^Followers$/})}).locator('dd').textContent()
    await actions.click();await follow.click()
    for(let attempt=0;attempt<60&&/\bYou\b/.test(await followers())===following;attempt++)await page.waitForTimeout(150)
    assert.equal(/\bYou\b/.test(await followers()),!following,`${width}: Followers shows the toggled follow`)
    await actions.click();assert.equal(await follow.getAttribute('aria-checked'),String(!following),`${width}: Follow toggles`);await page.keyboard.press('Escape')
    // The timer starts and stops from the same row, and is left stopped.
    await actions.click();await page.getByRole('menuitem',{name:'Start timer',exact:true}).click()
    await actions.click();await page.getByRole('menuitem',{name:'Stop timer',exact:true}).click()
    await actions.click();await page.getByRole('menuitem',{name:'Start timer',exact:true}).waitFor();await page.keyboard.press('Escape')
    // CC through "CC, BCC and sender…": its chip sits inside the card.
    await actions.click();await page.getByRole('menuitem',{name:'CC, BCC and sender…',exact:true}).click()
    const recipients=page.getByRole('dialog',{name:'CC, BCC and sender'});await recipients.getByLabel('CC',{exact:true}).fill(`finance-${width}@example.test`)
    await page.screenshot({path:join(evidence,`${width}-recipients.png`)})
    await recipients.getByRole('button',{name:'Done',exact:true}).click();await recipients.waitFor({state:'detached'})
    await page.locator('.chat-footer .conversation-recipient-chips').getByText(`finance-${width}@example.test`).waitFor()
    await actions.click();await page.getByRole('menu',{name:'Actions'}).waitFor()
    await page.screenshot({path:join(evidence,`${width}-owner-actions.png`)})
    await page.keyboard.press('Escape')
    await context.close()
   }

   // Without conversations.manage: no Merge, Snooze, Escalate, Mark as problem or timer; Forward and Schedule reply stay.
   {
    const {context,page}=await open(replier.token)
    await page.getByRole('textbox',{name:'Reply to conversation'}).waitFor()
    const names=await rows(page,page.locator('#conversation-composer-tools'))
    for(const row of ['Merge ticket…','Snooze…','Escalate to engineering…','Mark as problem…','Start timer','Internal CC…'])assert.ok(!names.includes(row),`${width}: replier never sees ${row}: ${names}`)
    for(const row of ['Forward to partner…','Schedule reply…','Saved replies'])assert.ok(names.includes(row),`${width}: replier keeps ${row}: ${names}`)
    await context.close()
   }

   // Collaborator: the notes-only box gains the same "+" with only Internal note and Follow (Internal CC needs managing followers).
   {
    const {context,page}=await open(collaborator.token)
    await page.getByRole('note').filter({hasText:'add internal notes'}).waitFor()
    assert.equal(await page.getByRole('textbox',{name:'Reply to conversation'}).count(),0)
    const toggle=page.locator('#conversation-notes-tools')
    await toggle.click();await page.getByRole('menuitemcheckbox',{name:/^Follow(ing)?$/}).and(page.locator(':not(.disabled)')).waitFor();await page.keyboard.press('Escape')
    const names=await rows(page,toggle)
    assert.ok(names.length===2&&names[0]==='Internal note'&&/^Follow(ing)?$/.test(names[1]),`${width}: collaborator rows are Internal note and Follow: ${names}`)
    await toggle.click();await page.getByRole('menu',{name:'Actions'}).waitFor()
    await page.screenshot({path:join(evidence,`${width}-collaborator-actions.png`)})
    await page.getByRole('menuitem',{name:'Internal note',exact:true}).click()
    await page.getByRole('dialog',{name:'Add Note'}).waitFor();await page.keyboard.press('Escape')
    await context.close()
   }
  }
  assert.deepEqual(problems,[])
  success=true
 }finally{await browser.close();await runtime.close(success)}
}
