import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {auditPage,viewports} from '../../journeys/kit/browser.mjs'

// One customer's request remains the same record from the installed widget to the report export.
export async function openBrandRequest({browser,origin,brand}){
 const context=await browser.newContext({viewport:viewports.desktop}),page=await context.newPage()
 page.setDefaultTimeout(20000)
 await page.goto(origin+`/help/${brand.id}`)
 await page.addScriptTag({url:origin+'/widget.js'})
 await page.evaluate(options=>window.h2h('init',options),{widgetKey:brand.widgetKey,apiOrigin:origin,open:true,settings:{collector:{enabled:false}}})
 await page.getByText(brand.greeting,{exact:true}).last().waitFor()
 await page.locator('textarea[name=content]').fill('Alpha private support request')
 await page.locator('button[name=submit]').click()
 const key=`rer-widget:${origin}:${brand.widgetKey}`
 await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key)||'null')?.conversationId,key)
 const session=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key)
 return {context,page,session}
}

export async function answerAndReport({origin,brand,visitor,page,shot}){
 const base=origin+`/projects/${brand.id}`,widget=visitor.page
 await page.goto(base+`/conversations/${visitor.session.conversationId}`)
 await page.getByText('Alpha private support request',{exact:true}).first().waitFor()
 await page.getByPlaceholder('Type your reply…').fill('Here is the answer for Alpha')
 await page.getByRole('button',{name:'Send',exact:true}).click()
 await widget.getByText('Here is the answer for Alpha',{exact:true}).waitFor()
 await page.locator('.conversation-header-close').click()
 await widget.getByText('Did this answer your question?',{exact:true}).waitFor()
 await widget.getByRole('button',{name:'👍 Yes',exact:true}).click()
 await widget.getByLabel('Is your issue resolved? (optional)',{exact:true}).selectOption('recovered')
 await widget.getByLabel('Comment (optional)',{exact:true}).fill('Alpha resolved my question')
 await widget.getByRole('button',{name:'Send rating',exact:true}).click()
 await widget.getByText('Thanks for your feedback. You can change it here.',{exact:true}).waitFor()
 await widget.reload()
 await widget.addScriptTag({url:origin+'/widget.js'})
 await widget.evaluate(options=>window.h2h('init',options),{widgetKey:brand.widgetKey,apiOrigin:origin,open:true,settings:{collector:{enabled:false}}})
 await widget.getByText('Thanks for your feedback. You can change it here.',{exact:true}).waitFor()
 assert.equal(await widget.getByLabel('Comment (optional)',{exact:true}).inputValue(),'Alpha resolved my question')
 const history=async()=>{
  const show=page.getByRole('button',{name:'Show conversation panel',exact:true})
  if(await show.isVisible())await show.click()
  await page.getByRole('tab',{name:'Ticket',exact:true}).click()
  const section=page.locator('#conversation-details-panel .ticket-section__toggle').filter({hasText:/^History/})
  if(await section.getAttribute('aria-expanded')!=='true')await section.click()
 }
 await history();await page.getByText('Alpha resolved my question',{exact:true}).waitFor()
 await page.reload();await page.getByPlaceholder('Type your reply…').waitFor()
 await history();await page.getByText('Alpha resolved my question',{exact:true}).waitFor()
 await auditPage(page,shot('alpha-rated-conversation.png'))
 await page.goto(base+'/reports')
 await page.getByRole('heading',{name:'Daily volume',exact:true}).waitFor()
 await page.getByLabel('Range',{exact:true}).selectOption('7')
 await page.getByRole('button',{name:'Apply range',exact:true}).click()
 await page.locator('.csat-panel').getByText('Alpha resolved my question',{exact:true}).waitFor()
 const workload=page.locator('section[aria-labelledby="team-workload-heading"]')
 await workload.getByLabel('Group workload by',{exact:true}).selectOption('account')
 await workload.getByLabel('Report metric',{exact:true}).selectOption('csat')
 assert.deepEqual(await workload.getByRole('row').nth(1).getByRole('cell').allTextContents(),['1','1','100%'])
 await workload.getByLabel('Report metric',{exact:true}).selectOption('recovery')
 assert.deepEqual(await workload.getByRole('row').nth(1).getByRole('cell').allTextContents(),['1','0','1','100%','0'])
 for(const label of ['Conversations CSV','Summary CSV','Export workspace conversations (JSON)']){
  const downloading=page.waitForEvent('download')
  await page.getByRole('button',{name:label,exact:true}).click()
  const file=await downloading,bytes=await readFile(await file.path(),'utf8')
  if(label==='Conversations CSV'){
   assert.ok(bytes.includes(visitor.session.conversationId));assert.ok(bytes.includes('Alpha resolved my question'))
  }else if(label.includes('JSON')){
   const conversation=JSON.parse(bytes).conversations.find(row=>row.id===visitor.session.conversationId)
   assert.ok(conversation.messages.some(message=>message.content==='Here is the answer for Alpha'))
  }else{assert.match(bytes,/"Conversations","1"/);assert.ok(!bytes.includes(visitor.session.conversationId),'summary does not expose individual conversations')}
 }
 await auditPage(page,shot('alpha-reports.png'))
 await page.goto(base+`/conversations/${visitor.session.conversationId}`)
 await page.locator('.conversation-header-reopen').click()
 await widget.getByText('Did this answer your question?',{exact:true}).waitFor({state:'hidden'})
 await history();await page.getByRole('heading',{name:'Past resolutions',exact:true}).waitFor()
 await page.getByText('Alpha resolved my question',{exact:true}).waitFor()
}
