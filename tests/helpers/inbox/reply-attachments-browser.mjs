import assert from 'node:assert/strict'
import {join} from 'node:path'

// The operator selects actual files; even the refusal comes from the emitted Worker.
export async function replyAttachmentsBrowser({page,projectId,conversationId,evidence,width=1440}){
 const composer=page.getByRole('textbox',{name:'Reply to conversation'})
 const draft=`The requested documents are attached (${width}).`
 const retained={name:'delivery-details.txt',mimeType:'text/plain',buffer:Buffer.from('Synthetic delivery instructions.')}
 const replacement={name:'replacement-details.txt',mimeType:'text/plain',buffer:Buffer.from('Synthetic replacement instructions.')}
 const previews=page.locator('.conversation-composer__files')
 const attach=async file=>{
  await page.getByRole('button',{name:'Actions',exact:true}).click()
  const chooser=page.waitForEvent('filechooser')
  await page.getByRole('menuitem',{name:'Attach file',exact:true}).click()
  const response=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/dashboard/projects/${projectId}/media`&&response.request().method()==='POST')
  await (await chooser).setFiles(file)
  return response
 }
 await composer.fill(draft)
 assert.equal((await attach(retained)).status(),201)
 await previews.getByText(retained.name,{exact:true}).waitFor({state:'attached'})
 // An empty file is a real native admission refusal, without a fake application route.
 assert.equal((await attach({...replacement,buffer:Buffer.alloc(0)})).status(),400)
 const alert=page.getByRole('alert').filter({hasText:replacement.name})
 await alert.waitFor()
 assert.equal(await composer.inputValue(),draft,'upload refusal keeps the reply draft')
 assert.equal(await previews.getByText(retained.name,{exact:true}).count(),1,'earlier attachment stays available')
 assert.equal(await previews.getByText(replacement.name,{exact:true}).count(),0,'refused file is never shown as attached')
 assert.equal(await page.getByRole('button',{name:'Send',exact:true}).isEnabled(),true,'the draft is usable after refusal')
 await page.screenshot({path:join(evidence,`attachment-refused-${width}.png`)})
 // The operator deliberately selects the corrected file. There is no automatic replay.
 assert.equal((await attach(replacement)).status(),201)
 await previews.getByText(replacement.name,{exact:true}).waitFor({state:'attached'})
 await alert.waitFor({state:'hidden'})
 await page.getByRole('button',{name:'Send',exact:true}).click()
 const message=page.locator('.transcript-message-content').getByText(draft,{exact:true})
 await message.waitFor()
 await page.reload();await message.waitFor()
 for(const file of [retained,replacement]){
  const link=page.locator('.chat-body').getByRole('link',{name:file.name,exact:true})
  await link.waitFor()
  const bytes=await page.request.get(new URL(await link.getAttribute('href'),page.url()).href)
  assert.equal(bytes.status(),200)
  assert.deepEqual(await bytes.body(),file.buffer,'sent attachment retains its exact bytes after reload')
 }
 assert.equal(await composer.inputValue(),'','successful send clears the composer')
 await page.screenshot({path:join(evidence,`attachments-sent-${width}.png`)})
}
