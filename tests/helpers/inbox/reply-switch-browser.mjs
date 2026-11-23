import assert from 'node:assert/strict'
import {strangerFixture} from '../stranger11-browser.mjs'
import {evidence,viewports} from '../../journeys/kit/browser.mjs'

const messages = ticket => `/api/conversations/${ticket.id}/messages`
const postTo = ticket => response => response.request().method()==='POST' && new URL(response.url()).pathname===messages(ticket)

export async function replySwitchBrowser(){
 const shot=await evidence('reply-switch')
 for(const viewport of [viewports.desktop,viewports.mobile]){
  const f=await strangerFixture(),{origin,projectId,page,request}=f
  const releaseSend=Promise.withResolvers(),releaseRead=Promise.withResolvers()
  let success=false
  try{
   await page.setViewportSize(viewport)
   const sam={...await f.ticket('Sam Patel'),name:'Sam Patel'}
   const jordan={...await f.ticket('Jordan Lee'),name:'Jordan Lee'}
   const path=ticket=>`/projects/${projectId}/conversations/${ticket.id}`
   const composer=page.getByRole('textbox',{name:'Reply to conversation'})
   const send=page.getByRole('button',{name:'Send',exact:true})
   const header=page.locator('.chat-header-title')
   const showList=async()=>{
    if(viewport.width===390)await page.getByRole('button',{name:'Show conversations',exact:true}).click()
   }
   const row=ticket=>page.locator('.conversation-list-items').getByRole('link',{name:new RegExp(ticket.name)})
   const select=async ticket=>{
    await showList()
    await row(ticket).click()
    await page.waitForURL(url=>url.pathname===path(ticket))
   }
   const ready=async(ticket,text)=>{
    await page.waitForFunction(({name,text})=>{
     const editor=document.querySelector('textarea[aria-label="Reply to conversation"]')
     return document.querySelector('.chat-header-title')?.textContent===name && editor && !editor.disabled && editor.value===text
    },{name:ticket.name,text})
   }
   const sent=async(ticket,text)=>{
    const transcript=await f.api(messages(ticket),undefined,ticket.visitor.token)
    return transcript.messages.filter(message=>message.content===text).length
   }

   // A reply to the first unassigned ticket changes the live Yours count.
   // The implicit Open view must continue showing the other customer.
   await page.goto(origin+path(sam))
   await ready(sam,'')
   const firstReply='Sam, I’ve opened a replacement for order NS-214.'
   await composer.fill(firstReply)
   const first=page.waitForResponse(postTo(sam))
   const ownCount=page.waitForResponse(async response=>response.ok() && response.url().endsWith('/conversations/counts') && (await response.json()).data.mine>0)
   await send.click()
   assert.equal((await first).status(),200)
   await ownCount
   await ready(sam,'')
   await showList()
   await row(jordan).waitFor()
   await page.screenshot({path:shot(`${viewport.width}-open-after-reply.png`),animations:'disabled'})

   // A clean switch with a slow workspace read must disable the outgoing
   // composer, including its keyboard shortcut, until Jordan is visible.
   const serverRead=url=>url.pathname.startsWith('/_serverFn/')
   const readStarted=Promise.withResolvers()
   const holdRead=async route=>{readStarted.resolve();await releaseRead.promise;await route.continue().catch(()=>{})}
   await page.route(serverRead,holdRead)
   await row(jordan).click()
   await page.waitForURL(url=>url.pathname===path(jordan))
   await readStarted.promise
   assert.equal(await composer.isEnabled(),false)
   assert.equal(await send.isEnabled(),false)
   await page.keyboard.press('Control+Enter')
   await page.screenshot({path:shot(`${viewport.width}-switching.png`),animations:'disabled'})
   // A second row selection supersedes the first read. The canceled answer
   // must never replace the current thread with a workspace error.
   await showList()
   await row(sam).click()
   await page.waitForURL(url=>url.pathname===path(sam))
   releaseRead.resolve()
   await page.unroute(serverRead,holdRead)
   await ready(sam,'')
   assert.equal(await page.getByRole('button',{name:'Try again',exact:true}).count(),0)
   await select(jordan)
   await ready(jordan,'')

   const jordanDraft='Jordan, I’ll look up the buckle dimensions.'
   await composer.fill(jordanDraft)
   await select(sam)
   await ready(sam,'')
   await page.screenshot({path:shot(`${viewport.width}-dirty-switch.png`),animations:'disabled'})

   // Hold Sam's real POST while switching to Jordan and back. Jordan keeps
   // his draft and the pending reply never becomes editable as a second send.
   const reply='Sam, please reply with the corrected city for order NS-214.'
   const sendStarted=Promise.withResolvers()
   const holdSend=async route=>{
    if(route.request().method()!=='POST')return route.continue()
    sendStarted.resolve()
    await releaseSend.promise
    await route.continue()
   }
   await page.route(origin+messages(sam),holdSend)
   await composer.fill(reply)
   const acknowledgement=page.waitForResponse(postTo(sam))
   await send.click()
   await sendStarted.promise
   assert.equal(await send.isEnabled(),false)
   await select(jordan)
   await ready(jordan,jordanDraft)
   assert.equal(await header.innerText(),jordan.name)
   await page.screenshot({path:shot(`${viewport.width}-jordan-while-sam-pending.png`),animations:'disabled'})
   await select(sam)
   await page.waitForFunction(name=>document.querySelector('.chat-header-title')?.textContent===name,sam.name)
   assert.equal(await composer.inputValue(),'')
   assert.equal(await send.isEnabled(),false)
   await page.screenshot({path:shot(`${viewport.width}-sam-return-pending.png`),animations:'disabled'})
   releaseSend.resolve()
   const response=await acknowledgement
   await page.unroute(origin+messages(sam),holdSend)
   assert.equal(response.status(),200)
   assert.equal(response.request().postDataJSON().expectedConversationId,sam.id)
   await ready(sam,'')
   await page.locator('.transcript-message-content').getByText(reply,{exact:true}).waitFor()
   assert.equal(await sent(sam,reply),1)
   assert.equal(await sent(jordan,reply),0)
   const mismatch=await page.request.post(origin+messages(jordan),{data:{
    ...response.request().postDataJSON(),localId:'wrong-thread',expectedRevision:jordan.revision+1,
   }})
   assert.equal(mismatch.status(),409)
   assert.equal((await mismatch.json()).reason,'composer_target_mismatch')

   // Reselecting a row after sending retains its transcript without an error.
   await select(sam)
   await ready(sam,'')
   assert.equal(await page.getByRole('button',{name:'Try again',exact:true}).count(),0)
   await page.screenshot({path:shot(`${viewport.width}-reselected.png`),animations:'disabled'})
   await page.reload()
   await ready(sam,'')
   await select(jordan)
   await ready(jordan,jordanDraft)
   await page.screenshot({path:shot(`${viewport.width}-jordan-draft-restored.png`),animations:'disabled'})
   success=true
  }catch(error){
   await page.screenshot({path:shot(`${viewport.width}-failure.png`),animations:'disabled'})
   throw error
  }finally{
   releaseSend.resolve()
   releaseRead.resolve()
   await f.close(success)
  }
 }
}
