import assert from 'node:assert/strict'
import {strangerFixture} from '../stranger11-browser.mjs'
import {evidence,viewports} from '../../journeys/kit/browser.mjs'

export async function replySwitchBrowser(){
 const f=await strangerFixture(),{origin,projectId,page,request}=f,shot=await evidence('reply-switch')
 let success=false
 try{
  for(const viewport of [viewports.desktop,viewports.mobile]){
   await page.setViewportSize(viewport)
   const samName='Sam Northstar '+viewport.width,jordanName='Jordan Northstar '+viewport.width
   const sam=await f.ticket(samName),jordan=await f.ticket(jordanName)
   const path=ticket=>`/projects/${projectId}/conversations/${ticket.id}`
   const composer=page.getByRole('textbox',{name:'Reply to conversation'})
   const header=page.locator('.chat-header-title')
   await page.goto(origin+path(sam)+'?view=open')
   await composer.waitFor()
   assert.equal(await header.innerText(),samName)
   if(viewport.width===390)await page.getByRole('button',{name:'Show conversations',exact:true}).click()
   const target=page.locator('.conversation-list-items').getByRole('link',{name:new RegExp(jordanName)})
   await target.waitFor()
   const posts=[]
   const record=req=>{if(req.method()==='POST'&&new URL(req.url()).pathname.endsWith('/messages'))posts.push(req)}
   page.on('request',record)
   // Retain the old page long enough to try the shortcut before the navigation's read completes.
   const gate=Promise.withResolvers()
   const serverRead=url=>url.pathname.startsWith('/_serverFn/')
   const hold=async route=>{await gate.promise;await route.continue()}
   await page.route(serverRead,hold)
   const text='Jordan, we can replace the damaged order.'
   try{
    await target.evaluate(link=>link.click())
    await page.waitForURL(url=>url.pathname===path(jordan))
    const oldComposerEnabled=await composer.isVisible() && await composer.isEnabled()
    if(oldComposerEnabled){
     await composer.fill(text)
     const reply=page.waitForResponse(res=>res.request().method()==='POST'&&new URL(res.url()).pathname.endsWith('/messages'))
     await composer.press('Control+Enter')
     await reply
    }
    await page.screenshot({path:shot(`${viewport.width}-switch.png`)})
    const samTranscript=await request(`/api/conversations/${sam.id}/messages`)
    console.log(`[${viewport.width}] URL targets Jordan, old composer enabled: ${oldComposerEnabled}, posts: ${posts.length}, Sam received Jordan's reply: ${samTranscript.messages.some(message=>message.content===text)}`)
    assert.equal(posts.length,0,'Send stays blocked during the switch')
    assert.ok(!samTranscript.messages.some(message=>message.content===text),'Sam must not receive Jordan’s reply')
   }finally{
    gate.resolve()
    await page.unrouteAll({behavior:'wait'})
    page.off('request',record)
   }
   await page.waitForFunction(name=>document.querySelector('.chat-header-title')?.textContent===name,jordanName)
   await composer.fill(text)
   const accepted=page.waitForResponse(res=>res.request().method()==='POST'&&new URL(res.url()).pathname===`/api/conversations/${jordan.id}/messages`)
   await page.getByRole('button',{name:'Send',exact:true}).click()
   const sent=await accepted
   assert.equal(sent.status(),200)
   assert.equal(sent.request().postDataJSON().expectedConversationId,jordan.id)
   const mismatch=await page.request.post(origin+`/api/conversations/${sam.id}/messages`,{data:{
    ...sent.request().postDataJSON(),localId:'wrong-thread',expectedRevision:sam.revision+1,
   }})
   assert.equal(mismatch.status(),409)
   assert.equal((await mismatch.json()).reason,'composer_target_mismatch')
   const transcript=await request(`/api/conversations/${jordan.id}/messages`)
   assert.equal(transcript.messages.filter(message=>message.content===text).length,1)
   await page.locator('.transcript-message-content').getByText(text,{exact:true}).waitFor()
   await page.screenshot({path:shot(`${viewport.width}-sent.png`)})
  }
  success=true
 }finally{await f.close(success)}
}
