import test from 'node:test'
import {writeFile} from 'node:fs/promises'
import {ticketReferenceSearch} from '/workspace/run-happytohelp/tests/helpers/inbox/ticket-reference-search.mjs'
import {ticketReferenceBrowser} from '/workspace/run-happytohelp/tests/helpers/inbox/ticket-reference-browser.mjs'
import {collaborationBrowser,deskCollaboration} from '/workspace/run-happytohelp/tests/helpers/inbox/desk-collaboration.mjs'
import {ticketFixture} from '/workspace/run-happytohelp/tests/helpers/inbox/ticket-fixture.mjs'
import {ticketStatusEdits} from '/workspace/run-happytohelp/tests/helpers/inbox/ticket-status-edits.mjs'
import {seedTicketBrowser} from '/workspace/run-happytohelp/tests/helpers/inbox/ticket-browser-fixture.mjs'
import {createRuntime} from '/workspace/run-happytohelp/tests/helpers/emitted-runtime.mjs'
import {launchBrowser,evidence} from '/workspace/run-happytohelp/tests/journeys/kit/browser.mjs'
test('ticket reference search',ticketReferenceSearch)
test('ticket reference preview and screen proof',ticketReferenceBrowser)
test('competing replies route',async()=>{
 const f=await ticketFixture()
 try{await deskCollaboration(f)}finally{await f.app.close()}
})
test('consecutive status priority tag edits and Solved contact history',async()=>{
 const runtime=await createRuntime({vars:{H2H_LOCAL:'true',EMAIL_PROVIDER:'development',EMAIL_FROM:'support@localhost.test'}})
 const browser=await launchBrowser(),shot=await evidence('status-history-after')
 let success=false
 try{
  const fixture=await seedTicketBrowser(runtime.origin,1),{owner,projectId}=fixture
  const page=await browser.newPage({viewport:{width:1440,height:900}})
  page.setDefaultTimeout(20000)
  const path='/projects/'+projectId+'/conversations/'+fixture.tickets[0].id
  await page.goto(runtime.origin+'/login?'+new URLSearchParams({returnTo:path}))
  await page.getByLabel('Email',{exact:true}).fill(owner.email)
  await page.getByLabel('Password',{exact:true}).fill(owner.password)
  await page.getByRole('button',{name:'Login',exact:true}).click()
  await page.getByRole('tab',{name:'Ticket',exact:true}).click()
  await ticketStatusEdits({page,fixture,origin:runtime.origin})
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:width===390?844:900})
   const show=page.getByRole('button',{name:'Show conversation panel',exact:true})
   if(await show.isVisible())await show.click()
   await page.getByRole('tab',{name:'Ticket',exact:true}).click()
   await page.screenshot({path:shot(width+'-ticket-edits.png'),fullPage:true})
  }
  await page.setViewportSize({width:1440,height:900})
  const status=page.getByLabel('Status',{exact:true})
  await status.selectOption('solved')
  await page.getByText('Status saved.',{exact:true}).waitFor({state:'attached'})
  await page.locator('.chat-header-title').click()
  await page.getByRole('heading',{name:'Conversations',exact:true}).waitFor()
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:width===390?844:900})
   await page.screenshot({path:shot(width+'-solved-history.png'),fullPage:true})
  }
  await writeFile(shot('receipt.json'),JSON.stringify({consecutiveWrites:true,staleRefusal:true,solvedHistory:true,assertionWidth:1440,screenshotWidths:[1440,390]},null,2))
  success=true
 }finally{await browser.close();await runtime.close(success)}
})
test('competing replies browser and desktop/phone proof',async()=>{
 await collaborationBrowser({width:1440})
 await collaborationBrowser({width:390,proofOnly:true})
})
