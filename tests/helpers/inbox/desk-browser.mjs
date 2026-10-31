import assert from 'node:assert/strict'
import {viewports} from '../../journeys/kit/browser.mjs'

// The existing brand request also proves visitor files and an editable saved reply.
export async function deskBrowserProof({origin,brand,visitor,page,shot}){
 const widget=visitor.page,id=visitor.session.conversationId,path=`/api/conversations/${id}/messages`
 const transcript=async()=>{
  const response=await page.request.get(origin+path)
  assert.equal(response.status(),200);return response.json()
 }
 const file={name:'parcel-details.txt',mimeType:'text/plain',buffer:Buffer.from('Customer parcel details.\nReference: ALPHA-48200.\n')}
 const request='Here are the parcel details for my request.'
 await widget.locator('input[type=file]').setInputFiles(file)
 await widget.locator('.happytohelp-files').getByText(file.name,{exact:true}).waitFor()
 await widget.locator('textarea[name=content]').fill(request)
 const admitted=widget.waitForResponse(response=>new URL(response.url()).pathname===path&&response.request().method()==='POST')
 await widget.locator('button[name=submit]').click()
 assert.equal((await (await admitted).json()).accepted,true)
 await page.locator('.transcript-message-content').getByText(request,{exact:true}).waitFor()
 const download=page.locator('.chat-body').getByRole('link',{name:file.name,exact:true})
 await download.waitFor()
 const bytes=await page.request.get(new URL(await download.getAttribute('href'),origin).href)
 assert.equal(bytes.status(),200);assert.deepEqual(await bytes.body(),file.buffer,'the inbox downloads the exact visitor bytes')
 const reply='I have checked your parcel.',edited=reply+' A replacement leaves today.'
 const created=await page.request.post(origin+`/api/dashboard/projects/${brand.id}/macros`,{data:{title:'Parcel update',content:reply}})
 assert.equal(created.status(),201)
 const before=await transcript(),composer=page.getByRole('textbox',{name:'Reply to conversation'})
 await page.getByRole('button',{name:'Actions',exact:true}).click()
 await page.getByRole('menuitem',{name:'Saved replies',exact:true}).click()
 await page.getByRole('link',{name:'Parcel update',exact:true}).click()
 await page.waitForFunction(text=>document.querySelector('[aria-label="Reply to conversation"]')?.value===text,reply)
 assert.deepEqual((await transcript()).messages,before.messages,'inserting a saved reply sends nothing')
 await composer.fill(edited)
 assert.deepEqual((await transcript()).messages,before.messages,'editing the inserted reply sends nothing')
 await page.getByRole('button',{name:'Send',exact:true}).click()
 await widget.getByText(edited,{exact:true}).waitFor()
 assert.equal((await transcript()).messages.filter(message=>message.content===edited).length,1)
 const files=[file,{name:'delivery-details.txt',buffer:Buffer.from('Synthetic delivery instructions.')},{name:'replacement-details.txt',buffer:Buffer.from('Synthetic replacement instructions.')}]
 await page.reload()
 await page.locator('.transcript-message-content').getByText(edited,{exact:true}).waitFor()
 await widget.reload()
 await widget.addScriptTag({url:origin+'/widget.js'})
 await widget.evaluate(options=>window.h2h('init',options),{widgetKey:brand.widgetKey,apiOrigin:origin,open:true,settings:{collector:{enabled:false}}})
 for(const text of ['Alpha private support request','Here is the answer for Alpha',request,edited]){
  await widget.getByText(text,{exact:true}).waitFor()
  await page.locator('.transcript-message-content').getByText(text,{exact:true}).waitFor()
 }
 for(const attachment of files){
  const link=widget.locator('.happytohelp-chat-list').getByRole('link',{name:attachment.name,exact:true})
  await link.waitFor()
  const downloaded=await link.evaluate(async element=>Array.from(new Uint8Array(await (await fetch(element.href)).arrayBuffer())))
  assert.deepEqual(Buffer.from(downloaded),attachment.buffer,'the reloaded widget downloads the exact bytes: '+attachment.name)
 }
 assert.equal((await transcript()).messages.length,before.messages.length+1,'reload never resends a visitor message or edited reply')
 const hidePanel=page.getByRole('button',{name:'Hide conversation panel',exact:true})
 if(await hidePanel.isVisible())await hidePanel.click()
 for(const viewport of [viewports.desktop,viewports.mobile]){
  await page.setViewportSize(viewport);await widget.setViewportSize(viewport)
  await page.screenshot({path:shot(`desk-inbox-${viewport.width}.png`),fullPage:true})
  await widget.screenshot({path:shot(`desk-widget-${viewport.width}.png`),fullPage:true})
 }
 await page.setViewportSize(viewports.desktop);await widget.setViewportSize(viewports.desktop)
}
