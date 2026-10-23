import assert from 'node:assert/strict'
import {join} from 'node:path'

export async function emailConversationJourney({page,api,projectId,conversationId,width,evidence,rawBody=false,transcriptRecipient='transcript@example.test'}){
 const path=`/api/dashboard/projects/${projectId}/conversations/${conversationId}`
 const recipient=`finance-${width}@northstar.example`
 const details=async()=>{await page.locator('.conversation-header').waitFor();const tab=page.getByRole('tab',{name:'Ticket',exact:true});if(!await tab.isVisible())await page.getByRole('button',{name:'Show conversation panel',exact:true}).click();await tab.click();const customer=page.locator('#ticket-section-customer-heading');if(await customer.getAttribute('aria-expanded')!=='true')await customer.click()}
 const screenshot=async name=>page.screenshot({path:join(evidence,`${width}-${name}.png`),fullPage:true})
 if(rawBody){
  const original=page.locator('.transcript-original-email').first()
  await original.locator('summary').click()
  await original.getByText('On Fri, 16 Oct 2026 Support wrote:',{exact:false}).waitFor()
  await screenshot('original-email')
  await original.locator('summary').click()
 }
 await details()
 await page.getByRole('button',{name:'Add recipient',exact:true}).click()
 let modal=page.getByRole('dialog')
 await modal.getByLabel('Email',{exact:true}).fill(recipient)
 await screenshot('add-recipient')
 await modal.getByRole('button',{name:'Add',exact:true}).click()
 await modal.waitFor({state:'hidden'})
 await page.reload()
 await details()
 await page.getByRole('button',{name:'Remove participant',description:recipient,exact:true}).waitFor()
 await screenshot('retained-recipient')
 await page.getByRole('button',{name:'Remove participant',description:recipient,exact:true}).click()
 await page.getByRole('button',{name:'Remove participant',description:recipient,exact:true}).waitFor({state:'detached'})
 await page.reload()
 await details()
 assert.ok(!(await api(path)).data.participants.some(row=>(row.email||row.provided_email)===recipient))
 await page.getByRole('button',{name:'Contact actions',exact:true}).click()
 await page.getByRole('menuitem',{name:'Email conversation',exact:true}).click()
 modal=page.getByRole('dialog')
 await modal.getByLabel('Email',{exact:true}).fill(transcriptRecipient)
 await screenshot('transcript-ready')
 const sent=page.waitForResponse(response=>response.url().endsWith(path)&&response.request().method()==='PUT')
 await modal.getByRole('button',{name:'Send',exact:true}).click()
 const response=await sent
 assert.equal(response.status(),200)
 const state=(await response.json()).transcript_delivery.state
 assert.ok(['suppressed','sent'].includes(state))
 await modal.getByRole('status').waitFor()
 assert.equal(await modal.getByRole('button',{name:'Send',exact:true}).isDisabled(),true)
 await screenshot('transcript-outcome')
 await modal.locator('.modal-footer').getByRole('button',{name:'Close',exact:true}).click()
 await page.reload()
 await details()
 await page.getByRole('button',{name:'Contact actions',exact:true}).click()
 await page.getByRole('menuitem',{name:'Email conversation',exact:true}).click()
 modal=page.getByRole('dialog')
 await modal.getByLabel('Email',{exact:true}).fill(transcriptRecipient)
 assert.equal(await modal.getByRole('button',{name:'Send',exact:true}).isDisabled(),true)
 await screenshot('transcript-retained')
 await modal.locator('.modal-footer').getByRole('button',{name:'Close',exact:true}).click()
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
 return {width,state,recipientRemovalRetained:true,transcriptIntentRetained:true}
}
