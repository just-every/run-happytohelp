import assert from 'node:assert/strict'
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {createRuntime} from '../emitted-runtime.mjs'
import {buildInboxFixture,REPLY} from '../inbox-conversation-fixture.mjs'
import {emailConversationJourney} from '../email-conversation-browser.mjs'
import {launchBrowser} from '../../journeys/kit/browser.mjs'

export async function inboxConversation(){
// Inbox and conversation regressions against the emitted Worker and a real browser:
// contact clocks, header fit, literal bounded search, Escape on the assignment menu, saved replies over a draft,
// the row Close/Reopen control by keyboard (and on touch, through the opened conversation's header), and Reopen on a
// closed conversation.

const optionalPort=name=>process.env[name]?Number(process.env[name]):undefined
const evidence=join(process.env.H2H_EVIDENCE_DIR?resolve(process.env.H2H_EVIDENCE_DIR):await mkdtemp(join(tmpdir(),'h2h-inbox-conversation-')),'inbox-conversation')
await mkdir(evidence,{recursive:true})
const runtime=await createRuntime({port:optionalPort('H2H_RUNTIME_PORT')??0,inspectorPort:optionalPort('H2H_RUNTIME_INSPECTOR_PORT'),vars:{H2H_LOCAL:'true',APP_ORIGIN:'http://127.0.0.1',EMAIL_PROVIDER:'development',EMAIL_FROM:'support@localhost.test'}})
const browser=await launchBrowser()
const checks=[],problems=[]
let success=false
const check=(label)=>checks.push(label)
// The UI updates optimistically; the server write that follows is what must hold.
const eventually=async(read,expected,message)=>{let value;for(let attempt=0;attempt<40;attempt++){value=await read();if(expected(value))return value;await new Promise(done=>setTimeout(done,150))}assert.fail(`${message}: ${JSON.stringify(value)}`)}

try{
 const fx=await buildInboxFixture(runtime.origin)
 const conversationPath=contact=>`/projects/${fx.projectId}/conversations/${fx.contacts[contact].id}`
 const inboxPath=(params={})=>`/projects/${fx.projectId}/conversations?${new URLSearchParams({view:'open',...params})}`
 // The viewer's clock is deliberately far from every fixture contact, so a leaked viewer clock cannot pass for a contact's.
 const open=async(target,options={})=>{
  const context=await browser.newContext({viewport:{width:1440,height:900},timezoneId:'Pacific/Auckland',...options})
  const page=await context.newPage()
  page.setDefaultTimeout(15000)
  page.on('pageerror',error=>problems.push(`pageerror: ${error.message}`))
  page.on('console',message=>{if(/Moment Timezone/i.test(message.text()))problems.push(`console: ${message.text()}`)})
  const hydrated=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/identity/auth-options')
  await page.goto(runtime.origin+'/login?'+new URLSearchParams({returnTo:target}))
  await hydrated
  await page.getByLabel('Email',{exact:true}).fill(fx.owner.email)
  await page.getByLabel('Password',{exact:true}).fill(fx.owner.password)
  await page.getByRole('button',{name:'Login',exact:true}).click()
  await page.waitForURL(url=>url.pathname+url.search===target||url.pathname===target.split('?')[0])
  return {context,page}
 }
 const state=async contact=>(await fx.api(`/api/dashboard/projects/${fx.projectId}/conversations/${fx.contacts[contact].id}`)).data
 const header=page=>page.locator('.conversation-header')

 // 1. Contact clock: none without a timezone, the contact's own clock with one.
 {
  const {context,page}=await open(conversationPath('kenji'))
  await page.locator('.conversation-header-meta-email').waitFor()
  await page.getByPlaceholder('Type your reply…').fill('typing triggers renders')
  await page.getByRole('tab',{name:'Ticket'}).click();await page.locator('#ticket-section-customer-heading').click()
  await page.getByText('Local time',{exact:true}).waitFor()
  await page.waitForTimeout(500)
  const meta=await page.locator('.conversation-header-meta').innerText()
  assert.ok(!/\d{1,2}:\d{2}/.test(meta),`header shows a clock for a contact without a timezone: ${meta}`)
  const location=await page.locator('.conversation-details-location').innerText()
  assert.ok(/Local time\s*Unknown/.test(location)&&!/\d{1,2}:\d{2}|UTC[+-]/.test(location),`details show a clock without a timezone: ${location}`)
  assert.deepEqual(problems,[],'Moment Timezone console errors for a contact without a timezone')
  check('contact without a timezone: no header clock, Ticket › Customer says Unknown, no Moment console errors')
  await context.close()
  await runtime.restart(()=>runtime.execute(`UPDATE contacts SET metadata_json=json_set(metadata_json,'$.timezone','Asia%2FTokyo') WHERE id=(SELECT contact_id FROM conversations WHERE id='${fx.contacts.tokyo.id}')`))
  const tokyo=await open(conversationPath('tokyo'))
  await tokyo.page.locator('.conversation-header-meta').getByText(/\d{1,2}:\d{2}/).waitFor()
  await tokyo.page.getByRole('tab',{name:'Ticket'}).click();await tokyo.page.locator('#ticket-section-customer-heading').click()
  await tokyo.page.getByText('UTC+09:00',{exact:true}).waitFor()
  assert.deepEqual(problems,[])
  check('contact with a URL-encoded timezone: header clock and Ticket › Customer UTC offset shown')
  await tokyo.context.close()
 }

 // 2. Header fits its bar with the panel open.
 for(const width of [1280,1440]){
  const {context,page}=await open(conversationPath('kenji'),{viewport:{width,height:900}})
  await page.locator('.conversation-header-meta-email').waitFor()
  const fit=await page.evaluate(()=>{
   const bar=document.querySelector('.conversation-header').getBoundingClientRect(),out=[]
   for(const el of document.querySelectorAll('.conversation-header *')){const r=el.getBoundingClientRect();if(r.width&&r.height&&(r.top<bar.top-0.5||r.bottom>bar.bottom+0.5))out.push(el.className||el.tagName)}
   const row=document.querySelector('.conversation-header-name-row').getBoundingClientRect()
   const truncated=[...document.querySelectorAll('.conversation-header-meta-email,.chat-header-title')].filter(el=>el.scrollWidth>el.clientWidth&&!el.title).map(el=>el.className)
   return {outside:out,nameRowHeight:row.height,truncated,pageOverflow:document.documentElement.scrollWidth>innerWidth}
  })
  assert.deepEqual(fit.outside,[],`${width}px: header elements outside the bar`)
  assert.ok(fit.nameRowHeight<32,`${width}px: name row wraps (${fit.nameRowHeight}px)`)
  assert.deepEqual(fit.truncated,[],`${width}px: ellipsised text without a title`)
  assert.equal(fit.pageOverflow,false)
  const tabs=await page.evaluate(()=>{const tab=[...document.querySelectorAll('.conversation-assistant__tab')].pop().getBoundingClientRect(),hide=document.querySelector('.conversation-assistant__hide').getBoundingClientRect(),panel=document.querySelector('#conversation-assistant').getBoundingClientRect();return {gap:hide.left-tab.right,inside:hide.right<=panel.right+0.5&&tab.left>=panel.left}})
  assert.ok(tabs.gap>=4&&tabs.inside,`${width}px: panel tab and Hide too close (${tabs.gap}px)`)
  await page.screenshot({path:join(evidence,`header-${width}.png`)})
  await context.close()
 }
 check('conversation header stays inside its 72px bar and the panel tabs clear Hide at 1280 and 1440')

 // 3. Search: literal, bounded, honest.
 {
  const {context,page}=await open(inboxPath())
  const input=page.locator('.conversation-inbox input[type=search]')
  await input.waitFor()
  const rows=page.locator('.conversation-list-items .conversation-item')
  await input.fill('%');await input.press('Enter')
  await page.getByText('Rate 100% Rhea').first().waitFor();await page.waitForFunction(()=>document.querySelectorAll('.conversation-list-items .conversation-item').length===1)
  await input.fill('_');await input.press('Enter')
  await page.getByText('snake_case Sam').first().waitFor();await page.waitForFunction(()=>document.querySelectorAll('.conversation-list-items .conversation-item').length===1)
  check('% and _ search for the literal character in the inbox UI')
  await input.fill('zzz-no-such-customer');await input.press('Enter')
  await page.getByText(/No results for “zzz-no-such-customer”/).waitFor()
  assert.equal(await page.getByText('No conversations match this view.').count(),0)
  check('a search with no result says so and names the query')
  await input.fill('x'.repeat(400));await input.press('Enter')
  await page.getByText(/too long/i).waitFor()
  assert.equal(await page.getByRole('button',{name:'Retry'}).count(),0,'a rejected search offers no Retry')
  assert.equal(await page.getByText(/Couldn’t load conversations/).count(),0)
  await input.fill('');await input.press('Enter')
  await page.waitForFunction(()=>document.querySelectorAll('.conversation-list-items .conversation-item').length>=5)
  assert.equal(await page.getByText(/too long/i).count(),0,'clearing the search removes the message')
  check('an over-long search shows a friendly message, no Retry, and clearing restores the list')
  const api=`/api/dashboard/projects/${fx.projectId}/conversations?view=open&q=`
  assert.equal((await (await page.request.get(runtime.origin+api+'%25')).json()).data.length,1)
  for(const length of [48,49,200]) assert.equal((await page.request.get(runtime.origin+api+'a'.repeat(length))).status(),200,`${length} characters`)
  for(const length of [201,400,6000]){const response=await page.request.get(runtime.origin+api+'a'.repeat(length));assert.equal(response.status(),400);assert.match((await response.json()).error,/too long/i)}
  check('search API: literal wildcards, 200 up to the limit, friendly 400 beyond it')
  const filters=page.getByRole('button',{name:'Filters',exact:true})
  await filters.click();await page.getByRole('dialog',{name:'Filters'}).waitFor()
  assert.equal(await page.getByRole('combobox',{name:'Filter conversations by tag'}).count(),0,'no tag filter while the workspace has no tag')
  await page.keyboard.press('Escape')
  const tagged=await fx.api(`/api/dashboard/projects/${fx.projectId}/conversations/${fx.contacts.percent.id}/tags`,{method:'POST',body:{name:'Search scope'}})
  await page.goto(runtime.origin+inboxPath({tag:tagged.data.id}))
  await page.getByRole('button',{name:'Remove filter Tag: Search scope',exact:true}).waitFor()
  await page.waitForFunction(()=>document.querySelectorAll('.conversation-list-items .conversation-item').length===1)
  await input.fill('x'.repeat(400));await input.press('Enter');await page.getByText(/too long/i).waitFor()
  await input.fill('   ');await input.press('Enter')
  await page.waitForFunction(()=>document.querySelectorAll('.conversation-list-items .conversation-item').length===1)
  assert.equal(await rows.getByText('Rate 100% Rhea',{exact:true}).isVisible(),true)
  const cleared=new URL(page.url())
  assert.equal(cleared.pathname,`/projects/${fx.projectId}/conversations`)
  assert.equal(cleared.searchParams.get('q'),null)
  assert.equal(cleared.searchParams.get('view'),'open')
  assert.equal(cleared.searchParams.get('tag'),tagged.data.id)
  await filters.click()
  assert.equal(await page.getByRole('combobox',{name:'Filter conversations by tag'}).inputValue(),tagged.data.id)
  assert.equal(await page.getByText(/too long/i).count(),0)
  check('clearing a rejected search preserves its workspace, open status and native tag filter')
  await context.close()
 }

 // Search crosses retained status by default and can deliberately compose filters.
 for(const width of [1440,390]){
  const {context,page}=await open(inboxPath(),{viewport:{width,height:844}})
  const input=page.locator('.conversation-inbox input[type=search]'),rows=page.locator('.conversation-list-items')
  await input.fill('Invoice reminder resolved');await input.press('Enter')
  await rows.getByText('Hannah Closed',{exact:true}).waitFor()
  await page.getByRole('radiogroup',{name:'Conversation search scope'}).getByRole('radio',{name:'This view'}).check()
  await rows.getByText(/No results/).waitFor()
  // Below 1200px the views are in the menu sheet, which the list title opens at Inbox.
  if(width<1200)await page.getByRole('button',{name:/, show inbox views$/}).click()
  await page.getByRole('link',{name:'Closed',exact:true}).click()
  await rows.getByText('Hannah Closed',{exact:true}).waitFor()
  const filters=page.getByRole('button',{name:'Filters',exact:true}),assignment=page.getByRole('combobox',{name:'Filter conversations by assignment'})
  await filters.click()
  await assignment.selectOption('myself')
  await rows.getByText(/No results/).waitFor()
  await assignment.selectOption('none')
  await rows.getByText('Hannah Closed',{exact:true}).waitFor()
  await page.reload();await rows.getByText('Hannah Closed',{exact:true}).waitFor()
  await filters.click()
  assert.equal(await assignment.inputValue(),'none')
  assert.equal(await page.getByRole('radio',{name:'This view'}).isChecked(),true)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  await page.screenshot({path:join(evidence,`history-search-${width}.png`)})
  await context.close()
 }
 check('message phrases search all history; current filters compose Closed with Me/Unassigned and survive reload at 1440/390')

 // 4. Assignment menu closes on Escape however it was opened.
 {
  const {context,page}=await open(conversationPath('assign'))
  await page.getByRole('tab',{name:'Ticket'}).click()
  const toggle=page.getByRole('button',{name:/^Assign conversation/})
  const menu=page.locator('.conversation-details-assignment [role=menu]')
  const focusedToggle=()=>page.evaluate(()=>document.activeElement?.getAttribute('aria-haspopup')==='menu'&&document.activeElement.closest('.conversation-details-assignment')!==null)
  for(let round=0;round<2;round++){
   await toggle.click();await menu.waitFor();await page.keyboard.press('Escape')
   await menu.waitFor({state:'detached'});assert.equal(await toggle.getAttribute('aria-expanded'),'false');assert.ok(await focusedToggle(),'focus returns to the toggle')
  }
  await toggle.focus();await page.keyboard.press('Enter');await menu.waitFor();await page.keyboard.press('Escape');await menu.waitFor({state:'detached'})
  await toggle.click();await menu.waitFor();await menu.getByRole('menuitem').first().focus();await page.keyboard.press('Escape');await menu.waitFor({state:'detached'});assert.ok(await focusedToggle())
  assert.equal(await page.locator('#conversation-assistant').getAttribute('aria-hidden'),'false','Escape in the menu leaves the panel open')
  check('assignment menu closes on Escape after a click, after Enter, and from a menu item; focus returns to the toggle')
  await context.close()
 }

 // 5. Saved reply over a typed draft.
 {
  const {context,page}=await open(conversationPath('draft'))
  const composer=page.getByRole('textbox',{name:'Reply to conversation'})
  const expandedReply='Hi Maya Chen, a black replacement buckle is approved for express dispatch tomorrow. — Alex Rivers'
  const pick=async()=>{await page.getByRole('button',{name:'Actions',exact:true}).click();await page.getByRole('menuitem',{name:'Saved replies',exact:true}).click();await page.getByRole('link',{name:REPLY.title,exact:true}).waitFor()}
  const draft='Draft that must not be sent'
  await composer.fill(draft)
  await composer.evaluate(element=>element.setSelectionRange(6,6))
  await pick()
  assert.equal(await composer.inputValue(),draft,'the draft stays visible and intact while the picker is open')
  await page.getByRole('link',{name:REPLY.title,exact:true}).click()
  await page.getByRole('link',{name:REPLY.title,exact:true}).waitFor({state:'hidden'})
  const merged=await composer.inputValue()
  assert.ok(merged.includes(draft)&&merged.includes(expandedReply),`draft and reply both present: ${merged}`)
  assert.ok(merged.startsWith(draft),'a caret inside the draft does not split it: the reply follows the line')
  await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Reply to conversation')
  check('saved reply is inserted without discarding a typed draft, and the draft stays visible while picking')
  await composer.fill('')
  await pick()
  await page.getByRole('link',{name:REPLY.title,exact:true}).click()
  await page.getByRole('link',{name:REPLY.title,exact:true}).waitFor({state:'hidden'})
  assert.equal(await composer.inputValue(),expandedReply,'an empty composer receives the entire expanded reply')
  await page.getByRole('button',{name:'Send',exact:true}).click()
  await eventually(async()=>(await fx.api(`/api/conversations/${fx.contacts.draft.id}/messages`)).messages,
   messages=>messages.at(-1)?.content===expandedReply,'sending preserves the complete expanded saved reply')
  await page.reload();await page.getByText(expandedReply,{exact:true}).waitFor()
  check('saved reply fills an empty composer exactly')
  await context.close()
 }

 // 6. Row Close control: shown on keyboard focus in the time's place, clear of the rest of the row; touch opens the
 // conversation instead, whose header closes it.
 {
  const {context,page}=await open(inboxPath())
  const label='Close conversation with Row Alpha'
  await page.getByRole('button',{name:label}).waitFor({state:'attached'})
  await page.locator('.conversation-inbox input[type=search]').focus()
  let reached=false
  for(let i=0;i<80&&!reached;i++){await page.keyboard.press('Tab');reached=await page.evaluate(text=>document.activeElement?.getAttribute('aria-label')===text,label)}
  assert.ok(reached,'Tab reaches the row Close control')
  const focused=await page.evaluate(()=>{const el=document.activeElement,r=el.getBoundingClientRect(),cs=getComputedStyle(el),row=el.parentElement,shown=other=>getComputedStyle(other).opacity!=='0'&&getComputedStyle(other).visibility!=='hidden',hit=[...row.querySelectorAll('.conversation-item-time,.avatar,.conversation-item-unread,.conversation-item-agent,h4')].filter(shown).filter(other=>{const o=other.getBoundingClientRect();return Math.min(o.right,r.right)-Math.max(o.left,r.left)>2&&Math.min(o.bottom,r.bottom)-Math.max(o.top,r.top)>2}).map(other=>other.className||other.tagName);return {w:r.width,h:r.height,opacity:Number(cs.opacity),display:cs.display,hit,time:getComputedStyle(row.querySelector('.conversation-item-time')).opacity,insideLink:el.closest('a')!==null}})
  assert.ok(focused.w>=24&&focused.h>=24&&focused.opacity>0.3&&focused.display!=='none',`focused control visible and large enough: ${JSON.stringify(focused)}`)
  assert.equal(focused.time,'0','the time steps aside while the control shows in its place')
  assert.deepEqual(focused.hit,[],'the control covers no visible row content')
  assert.equal(focused.insideLink,false,'the control is not nested in the row link')
  await page.keyboard.press('Enter')
  await page.waitForFunction(text=>!document.querySelector(`[aria-label="${text}"]`),label)
  assert.ok(new URL(page.url()).pathname.endsWith('/conversations'),'closing from the list does not open the conversation')
  await eventually(()=>state('alpha'),row=>row.resolved_at,'server closed the conversation')
  check('row Close control: reachable by Tab, shown in the time\'s place, clear of the rest of the row, Enter closes without navigating')
  await context.close()
  const touch=await open(inboxPath(),{viewport:{width:390,height:844},hasTouch:true,isMobile:true})
  const button=touch.page.getByRole('button',{name:'Close conversation with Row Beta'})
  await button.waitFor({state:'attached'})
  assert.deepEqual(await button.evaluate(el=>({opacity:getComputedStyle(el).opacity,pointerEvents:getComputedStyle(el).pointerEvents})),{opacity:'0',pointerEvents:'none'},'on touch the row shows no Close at rest and takes no tap there')
  const box=await button.boundingBox()
  await touch.page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2)
  await touch.page.waitForURL(url=>url.pathname===conversationPath('beta'))
  assert.equal((await state('beta')).resolved_at,null,'the tap opened Row Beta without closing it')
  await header(touch.page).getByRole('button',{name:'Close',exact:true}).tap()
  await eventually(()=>state('beta'),row=>row.resolved_at,'server closed Row Beta')
  check('touch: no row Close at rest; a tap where it sits opens the conversation, and its header closes it')
  await touch.context.close()
  const closed=await open(inboxPath({view:'closed'}))
  const reopen=closed.page.getByRole('button',{name:'Reopen conversation with Hannah Closed'})
  await reopen.focus();await closed.page.keyboard.press('Enter')
  await closed.page.waitForFunction(()=>!document.querySelector('[aria-label="Reopen conversation with Hannah Closed"]'))
  await eventually(()=>state('reopen'),row=>row.resolved_at===null,'server reopened the conversation')
  check('Closed view: the row Reopen control works from the keyboard')
  await closed.context.close()
  await fx.api(`/api/dashboard/projects/${fx.projectId}/conversations/${fx.contacts.reopen.id}`,{method:'PUT',body:{resolved:true}})
 }

 // 7. Closed conversation: Reopen in the header, no Send & close.
 {
  const {context,page}=await open(conversationPath('reopen'))
  const bar=header(page)
  const reopen=bar.getByRole('button',{name:'Reopen',exact:true})
  await reopen.waitFor()
  const box=await reopen.boundingBox(),barBox=await bar.boundingBox()
  assert.ok(box.width>=24&&box.height>=24&&box.y>=barBox.y&&box.y+box.height<=barBox.y+barBox.height,'Reopen sits inside the header bar')
  await bar.getByText('Closed',{exact:true}).waitFor()
  assert.equal(await bar.getByRole('button',{name:'Close',exact:true}).count(),0)
  const menuItems=async()=>{await page.getByRole('button',{name:'Actions',exact:true}).click();const names=await page.getByRole('menuitem').allInnerTexts();await page.keyboard.press('Escape');return names.map(name=>name.trim())}
  let items=await menuItems()
  assert.ok(items.includes('Saved replies')&&!items.some(name=>/Send & close/.test(name)),`closed conversation tools: ${items}`)
  await page.screenshot({path:join(evidence,'closed-header.png')})
  await reopen.focus();await page.keyboard.press('Enter')
  await bar.getByText('Open',{exact:true}).waitFor()
  await bar.getByRole('button',{name:'Close',exact:true}).waitFor()
  assert.equal(await bar.getByRole('button',{name:'Reopen',exact:true}).count(),0)
  await eventually(()=>state('reopen'),row=>row.resolved_at===null,'server reopened the conversation')
  await page.getByRole('textbox',{name:'Reply to conversation'}).fill('A reply on a reopened conversation')
  items=await menuItems()
  assert.ok(items.some(name=>/Send & close/.test(name)),`open conversation keeps Send & close: ${items}`)
  await bar.getByRole('button',{name:'Close',exact:true}).click()
  await bar.getByRole('button',{name:'Reopen',exact:true}).waitFor()
  await eventually(()=>state('reopen'),row=>row.resolved_at,'server closed the conversation again')
  await page.reload();await header(page).getByRole('button',{name:'Reopen',exact:true}).waitFor()
  check('closed conversation: header Reopen (keyboard), Closed badge, no Send & close; reopened conversation restores Close and Send & close')
  await context.close()
  const mobile=await open(conversationPath('reopen'),{viewport:{width:390,height:844},hasTouch:true,isMobile:true})
  const mobileReopen=mobile.page.locator('.conversation-header').getByRole('button',{name:'Reopen',exact:true})
  await mobileReopen.waitFor()
  // Visibility can precede the existing mobile panel slide now that history is ready sooner.
  await mobileReopen.evaluate(async button=>{await Promise.all(button.closest('.main').getAnimations().map(animation=>animation.finished))});
  const mobileBox=await mobileReopen.boundingBox();assert.ok(mobileBox.x>=0&&mobileBox.x+mobileBox.width<=390&&mobileBox.height>=24)
  await mobile.page.screenshot({path:join(evidence,'closed-reopen-390.png')})
  check('Reopen is visible at 390px')
  await mobile.context.close()
 }

 for(const width of [1440,390]){
  const {context,page}=await open(conversationPath('draft'),{viewport:{width,height:900}})
  try{await emailConversationJourney({page,api:fx.api,projectId:fx.projectId,conversationId:fx.contacts.draft.id,width,evidence});check(`email recipients and transcript send survive reload at ${width}`)}finally{await context.close()}
 }
 assert.deepEqual(problems,[])
 success=true
}finally{
 await writeFile(join(evidence,'result.json'),JSON.stringify({checks,problems},null,2))
 console.log(JSON.stringify({checks,problems}))
 await browser.close()
 await runtime.close(success)
}

}
