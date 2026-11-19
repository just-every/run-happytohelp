import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {strangerFixture} from '../stranger11-browser.mjs'
import {viewports,evidence} from '../../journeys/kit/browser.mjs'

async function viewport(page,value){
 const crossed=(page.viewportSize().width>=1280)!==(value.width>=1280)
 await page.setViewportSize(value)
 if(crossed)await page.waitForFunction(desktop=>document.querySelector('#conversation-assistant')?.getAttribute('aria-hidden')===String(!desktop),value.width>=1280)
}
export async function ticketReferenceBrowser(){
 const f=await strangerFixture(),{page,origin,projectId,base,request}=f,shot=await evidence('ticket-reference-after');let success=false
 try{
  const ticket=await f.ticket('Maya'),reference='#'+ticket.id.slice(0,8).toUpperCase()
  await request(`${base}/macros`,{title:'Reference reply',content:'Your support request {{ticket.id}}: {{ticket.link}}',actions:{priority:'high'},scope:{visibility:'shared',roles:[],groups:[],brands:[]}})
  const path=`/projects/${projectId}/conversations/${ticket.id}`
  await page.goto(origin+path)
  const hide=page.getByRole('button',{name:'Hide conversation panel',exact:true});if(await hide.isVisible())await hide.click()
  await page.getByRole('button',{name:'Actions',exact:true}).click();await page.getByRole('menuitem',{name:'Saved replies',exact:true}).click();await page.getByRole('link',{name:'Reference reply',exact:true}).click()
  const preview=page.getByRole('region',{name:'Saved reply preview',exact:true});await preview.waitFor()
  const bounds=await preview.evaluate(node=>({maxHeight:parseFloat(getComputedStyle(node).maxHeight),viewport:innerHeight}))
  assert.ok(Number.isFinite(bounds.maxHeight)&&bounds.maxHeight<=bounds.viewport,'the preview itself is bounded by the viewport')
  const reply=await preview.innerText()
  assert.ok(reply.includes('Your support request '+reference+': '+origin+path),'preview renders the short reference and the working full UUID link')
  assert.ok(!reply.includes('Your support request '+ticket.id),'the reference itself is not a UUID')
  await page.screenshot({path:shot('1440-preview.png'),fullPage:true})
  await viewport(page,viewports.mobile);await page.screenshot({path:shot('390-preview.png'),fullPage:true})
  await page.getByRole('button',{name:'Cancel',exact:true}).click()
  await viewport(page,viewports.desktop)
  const show=page.getByRole('button',{name:'Show conversation panel',exact:true});if(await show.isVisible())await show.click()
  await page.getByRole('tab',{name:'Ticket',exact:true}).click()
  await page.getByRole('heading',{name:'Ticket '+reference,exact:true}).waitFor()
  assert.ok((await page.title()).includes(reference),'the page title matches the quoted reference')
  await page.locator('#ticket-summary-status').waitFor()
  await page.screenshot({path:shot('1440-ticket.png'),fullPage:true})
  await viewport(page,viewports.mobile)
  if(await show.isVisible())await show.click()
  await page.getByRole('tab',{name:'Ticket',exact:true}).click()
  await page.screenshot({path:shot('390-ticket.png'),fullPage:true})
  await writeFile(shot('receipt.json'),JSON.stringify({reference,uuid:ticket.id,preview:true,fullLink:true,operatorHeader:true,pageTitle:true,assertionWidth:1440,screenshotWidths:[1440,390]},null,2))
  success=true
 }finally{await f.close(success)}
}
