import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {randomBytes,randomUUID} from 'node:crypto'
import {mkdir,writeFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {createRuntime} from '../emitted-runtime.mjs'
import {launchBrowser,viewports} from '../../journeys/kit/browser.mjs'
import {authenticatedReplyReceipt} from '../ai/mail-receipt.mjs'

// Explicit live-only invocation, never part of push Verify. No provider fixture, send retry or customer mailbox.
async function mailboxReceipt(answer,since){
 const url=new URL(process.env.MAILBOX_RECEIPT_URL)
 url.search=''
 for(const [key,value] of Object.entries({to:process.env.TEST_MAIL_TO,since,contains:answer,limit:'10'}))url.searchParams.set(key,value)
 const deadline=Date.now()+90_000
 while(Date.now()<deadline){
  const response=await fetch(url,{headers:{Authorization:`Bearer ${process.env.QA_INBOX_RECEIPT_TOKEN}`},signal:AbortSignal.timeout(Math.min(10_000,deadline-Date.now()))})
  assert.equal(response.status,200,'the held QA mailbox receiver must be reachable')
  const receipt=authenticatedReplyReceipt(await response.json(),answer)
  if(receipt){assert.equal(receipt.to,process.env.TEST_MAIL_TO);return receipt}
  await new Promise(done=>setTimeout(done,2000))
 }
 throw Error('Delivered answer unconfirmed: no authenticated QA mailbox receipt; do not resend')
}

export async function mailboxLiveJourney(){
 for(const name of ['EMAIL_API_KEY','TEST_MAIL_TO','MAILBOX_RECEIPT_URL','QA_INBOX_RECEIPT_TOKEN'])assert.ok(process.env[name],`${name} is required`)
 assert.equal(process.env.TEST_MAIL_TO,'qa-inbox@runeditrun.com','live proof uses only the held fleet test mailbox')
 const output=resolve(process.env.H2H_EVIDENCE_DIR||'test-results','widget-mailbox-live')
 await mkdir(output,{recursive:true})
 const runtime=await createRuntime({workerFirst:true,vars:{EMAIL_PROVIDER:'sendgrid',EMAIL_API_KEY:process.env.EMAIL_API_KEY,EMAIL_FROM:'support@native-mail.happytohelp.com'}})
 let browser,host,success=false
 try{
  host=createServer((_request,response)=>{response.setHeader('Content-Type','text/html; charset=utf-8');response.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><h1>HH test shop</h1><p>Ask our support team about your order.</p><script src="${runtime.origin}/widget.js" data-api-origin="${runtime.origin}" data-widget-key="${widgetKey}"></script></body></html>`)})
  await new Promise(done=>host.listen(0,'127.0.0.1',done))
  const site=`http://127.0.0.1:${host.address().port}`
  let owner
  const call=async(path,body,method=body===undefined?'GET':'POST')=>{
   const response=await fetch(runtime.origin+path,{method,headers:{'Content-Type':'application/json',...(owner?{Authorization:`Bearer ${owner.token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)})
   assert.ok(response.ok,`${method} ${path}: HTTP ${response.status}`)
   return response.json()
  }
  owner=await call('/api/identity/bootstrap',{name:'HH owned widget mailbox test',ownerName:'HH test support',email:'qa-inbox-2@runeditrun.com',password:randomBytes(32).toString('base64url'),allowedOrigin:site})
  const p=owner.projectId,settings=await call(`/api/management/projects/${p}/widget-settings`),widgetKey=settings.widgetKey
  await call(`/api/management/projects/${p}/settings`,{timezone:'UTC'},'PUT')
  browser=await launchBrowser()
  const day=(new Date().getUTCDay()+6)%7+1
  for(const point of ['P1','P2']){
   const since=new Date().toISOString(),marker=randomUUID()
   await call(`/api/management/projects/${p}/availability`,{is_availability_schedule_enabled:true,availability_schedule:{days:[point==='P1'?day%7+1:day],time_from:'00:00',time_to:'23:59',message:''}},'PUT')
   const state=await fetch(`${runtime.origin}/api/widget/settings?widgetKey=${widgetKey}`,{headers:{Origin:site}}).then(response=>response.json())
   assert.equal(state.mailMode,'remote')
   assert.equal(state.availability.scheduled,true)
   assert.equal(state.availability.available,false)
   if(point==='P1')assert.ok(state.availability.opensAt>Date.now(),'outside configured hours has a future return time')
   else{
    assert.equal(state.availability.live,true,'during configured hours live presence makes the team away')
    assert.equal(state.availability.opensAt,null)
    const presence=await call(`/api/management/projects/${p}/presence`)
    assert.deepEqual(presence.data.online,[],'no dashboard or agent is online')
   }
   const context=await browser.newContext({viewport:viewports.desktop,timezoneId:'UTC'}),page=await context.newPage(),errors=[]
   page.on('pageerror',error=>errors.push(error.message))
   try{
    await page.goto(site)
    await page.getByRole('button',{name:'Open chat',exact:true}).click()
    const notice=page.locator('.happytohelp-away-notice')
    await notice.waitFor()
    assert.match(await notice.innerText(),/We're away right now/)
    assert.match(await notice.innerText(),point==='P1'?/We're back .+ at/:/We'll reply as soon as we're back/)
    const both=async phase=>{for(const [size,viewport] of Object.entries(viewports)){await page.setViewportSize(viewport);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:join(output,`${point}-${phase}-${size}.png`),fullPage:true})}}
    await both('email-ask')
    await page.locator('input[name=email]').fill(process.env.TEST_MAIL_TO)
    await page.locator('input[name=email]').press('Enter')
    await notice.filter({hasText:`We'll reply here and email you at ${process.env.TEST_MAIL_TO}.`}).waitFor()
    const question=point==='P1'?'My order arrived damaged. Can you send a replacement?':'Can you help me track my order?'
    await page.locator('textarea[name=content]').fill(question)
    await page.locator('button[name=submit]').click()
    const session=await page.evaluate(()=>Object.entries(localStorage).filter(([key])=>key.startsWith('rer-widget:')).map(([,value])=>JSON.parse(value))[0])
    assert.ok(session?.conversationId)
    let transcript
    for(const deadline=Date.now()+15_000;Date.now()<deadline;){
     transcript=await call(`/api/conversations/${session.conversationId}/messages`)
     if(transcript.messages.some(message=>message.actor_role==='system'))break
     await new Promise(done=>setTimeout(done,200))
    }
    assert.deepEqual(transcript.messages.map(message=>message.actor_role),['contact','system'],'the inbox receives the visitor question and one away reply')
    const contact=await call(`/api/management/projects/${p}/contacts/${session.contactId}`)
    assert.equal(contact.data.email,process.env.TEST_MAIL_TO)
    const answer=`${point==='P1'?'Your replacement ships today.':'Your order arrives tomorrow.'} HH widget reference ${marker}.`
    const sent=await call(`/api/conversations/${session.conversationId}/messages`,{localId:`synthetic-happytohelp-${marker}`,content:answer,expectedRevision:transcript.revision,expectedLastMessageId:transcript.lastMessageId})
    assert.equal(sent.accepted,true)
    await page.getByText(answer,{exact:true}).waitFor()
    let delivery
    for(const deadline=Date.now()+15_000;Date.now()<deadline;){
     const buckets=await call(`/api/dashboard/projects/${p}/conversations/${session.conversationId}/buckets`)
     delivery=buckets.data.flatMap(bucket=>bucket.messages).find(message=>message.id===sent.message.id)?.email_status?.state
     if(delivery==='sent')break
     await new Promise(done=>setTimeout(done,200))
    }
    assert.equal(delivery,'sent','the normal reply route submits the visitor notification once')
    const receipt=await mailboxReceipt(answer,since)
    const {id,receivedAt,to,from,subject,messageId,excerpt,auth}=receipt
    assert.ok(messageId)
    await writeFile(join(output,`${point}-mailbox.json`),JSON.stringify({id,receivedAt,to,from,subject,messageId,excerpt,auth},null,2)+'\n')
    await both('answer')
    assert.deepEqual(errors,[])
    console.log(`${point}: delivered answer receipt=${id} messageId=${messageId} receivedAt=${receivedAt} dmarc=${auth.dmarc}`)
   }finally{await context.close()}
  }
  success=true
 }finally{
  await browser?.close()
  if(host)await new Promise(done=>host.close(done))
  await runtime.close(success)
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await mailboxLiveJourney()
