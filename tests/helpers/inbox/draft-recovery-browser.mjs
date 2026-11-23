import assert from 'node:assert/strict'
import {strangerFixture} from '../stranger11-browser.mjs'

export async function draftRecoveryBrowser(){
 const f=await strangerFixture(),{origin,projectId,base,page,request}=f
 let success=false
 try{
  const sam=await f.ticket('Sam Ridgeline')
  const ticketPath=base+'/conversations/'+sam.id,draftPath=ticketPath+'/macro-draft'
  const composer=page.getByRole('textbox',{name:'Reply to conversation'})
  const plainReply='Sam, I can check whether the refund reached your card.'
  await page.goto(origin+'/projects/'+projectId+'/conversations/'+sam.id+'?view=open')
  await composer.fill(plainReply)

  const macro=(await request(base+'/macros',{title:'Refund policy',content:'Refunds go back to the original card within 5 days.'})).data
  const ticket=(await request(ticketPath+'/ticket')).data
  const applied=(await request(base+'/macros/'+macro.id+'/apply',{
   version:macro.version,command_id:'refund-policy',tickets:[{id:sam.id,expected_version:ticket.ticket_version}],
  })).data.results[0]
  assert.equal(applied.status,'applied')
  assert.equal((await request(draftPath)).data.usage_id,applied.usage_id)
  await request(base+'/macros/'+macro.id,{expected_version:macro.version},'DELETE')
  const discarded=(await request(draftPath+'?usage_id='+applied.usage_id,undefined,'DELETE')).data.discarded
  assert.equal(discarded,false,'archive has already removed the applied draft')
  assert.equal((await request(draftPath)).data,null)

  let failure=0
  await page.route(origin+draftPath,route=>failure
   ? route.fulfill({status:failure,contentType:'text/plain',body:'Draft service unavailable'})
   : route.continue())
  const alert=page.locator('.conversation-composer__error[role=alert]')
  const retry=page.getByRole('button',{name:'Retry',exact:true})
  const waitForReply=()=>page.waitForFunction(text=>{
   const editor=document.querySelector('textarea[aria-label="Reply to conversation"]')
   return editor && !editor.disabled && editor.value===text
  },plainReply)
  page.on('dialog',dialog=>dialog.accept())
  const reload=async()=>{
   const read=page.waitForResponse(response=>new URL(response.url()).pathname===draftPath)
   await page.reload()
   return (await read).status()
  }
  assert.equal(await reload(),200)
  await waitForReply()
  failure=404
  assert.equal(await reload(),404)
  await alert.waitFor()
  await waitForReply()

  failure=500
  assert.equal(await reload(),500)
  await retry.waitFor()
  assert.equal(await composer.isEnabled(),false)
  const retried=page.waitForResponse(response=>new URL(response.url()).pathname===draftPath)
  await retry.click()
  assert.equal((await retried).status(),500)
  await waitForReply()

  assert.equal(await reload(),500)
  await page.getByRole('button',{name:'Continue without the saved draft',exact:true}).click()
  await waitForReply()
  const messagePath='/api/conversations/'+sam.id+'/messages'
  const posted=page.waitForResponse(response=>response.request().method()==='POST'&&response.url().endsWith(messagePath))
  await page.getByRole('button',{name:'Send',exact:true}).click()
  assert.equal((await posted).status(),200)
  assert.equal((await request(messagePath)).messages.filter(message=>message.content===plainReply).length,1)
  success=true
 }finally{await f.close(success)}
}
