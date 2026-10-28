import test,{after} from 'node:test'
import assert from 'node:assert/strict'
import {chromium} from 'playwright'
import {authenticatedReplyReceipt} from '../helpers/ai/mail-receipt.mjs'
const required=['BASE_URL','WIDGET_KEY','OPERATOR_EMAIL','OPERATOR_PASSWORD']
const absent=required.filter(name=>!process.env[name])
const base=process.env.BASE_URL?.replace(/\/$/,'')
const widgetKey=process.env.WIDGET_KEY
// Optional configured-provider journeys: they run only with a disposable configured installation in the
// environment, and otherwise skip without any model or mail call.
let browser,live
after(async()=>{await browser?.close()})
const until=async(read,accept,label)=>{for(let i=0;i<180;i++){const value=await read();if(accept(value))return value;await new Promise(r=>setTimeout(r,500))}assert.fail(`${label} did not complete`)}

test('live cited native answer reaches widget and the same inbox; handoff and operator reply',{
 skip:absent.length?`Missing environment: ${absent.join(', ')}; no model or mail calls made`:false,
 timeout:240000,
},async()=>{
 browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
 const widgetContext=await browser.newContext({viewport:{width:1440,height:900}}),operatorContext=await browser.newContext({viewport:{width:1440,height:900}})
 const widget=await widgetContext.newPage(),operator=await operatorContext.newPage()
 widget.setDefaultTimeout(90000);operator.setDefaultTimeout(30000)
 const storageKey=`rer-widget:${base}:${widgetKey}`,frames=[]
 try{
  // Load a real app document so Chromium classifies localhost sockets correctly.
  widget.on('websocket',socket=>socket.on('framereceived',event=>{try{frames.push(JSON.parse(event.payload))}catch{}}))
  const mount=async()=>{await widget.addScriptTag({url:base+'/widget.js'});await widget.evaluate(options=>window.h2h('init',options),{widgetKey,apiOrigin:base,open:true,settings:{collector:{enabled:false}}})}
  const settings=await widget.request.get(`${base}/api/widget/settings?widgetKey=${encodeURIComponent(widgetKey)}`);assert.equal(settings.status(),200)
  await widget.goto(`${base}/help/${(await settings.json()).projectId}`);await mount()
  const input=widget.locator('textarea[name=content]');await input.waitFor()
  await input.fill(process.env.LIVE_QUESTION||'What is the refund window in your published refund policy? Please cite the source.')
  await widget.locator('button[name=submit]').click()
  const anchor=widget.locator('.happytohelp-message-citations a').first();await anchor.waitFor()
  const href=await anchor.getAttribute('href');assert.equal(new URL(href).origin,new URL(base).origin)
  if(process.env.ARTICLE_URL)assert.equal(href,process.env.ARTICLE_URL)
  assert.match(await anchor.getAttribute('rel'),/noopener/)
  const session=await widget.evaluate(key=>JSON.parse(localStorage.getItem(key)),storageKey)
  const transcript=async()=>{const r=await widget.request.get(`${base}/api/conversations/${session.conversationId}/messages`,{headers:{Authorization:`Bearer ${session.token}`}});assert.equal(r.status(),200);return r.json()}
  const rest=await transcript(),answer=rest.messages.find(m=>m.actor_role==='ai'&&JSON.parse(m.citations_json||'[]').some(c=>c.url===href));assert.ok(answer)
  await until(async()=>frames.find(f=>f.message?.id===answer.id),Boolean,'socket final message')
  const frame=frames.find(f=>f.message?.id===answer.id);assert.equal(frame.message.content,answer.content);assert.equal(frame.message.citations_json,answer.citations_json)
  await widget.reload();await mount();await anchor.waitFor();assert.equal(await anchor.getAttribute('href'),href)
  assert.equal((await transcript()).messages.filter(m=>m.id===answer.id).length,1)
  await operator.goto(base+'/login')
  await operator.getByLabel('Email',{exact:true}).fill(process.env.OPERATOR_EMAIL)
  await operator.getByLabel('Password',{exact:true}).fill(process.env.OPERATOR_PASSWORD)
  await operator.getByRole('button',{name:'Login',exact:true}).click()
  await operator.waitForURL(url=>url.pathname!=='/login')
  const thread=`/projects/${session.projectId}/conversations/${session.conversationId}`
  await operator.goto(base+thread)
  const inboxAnchor=operator.locator('.message-citations a').first();await inboxAnchor.waitFor();assert.equal(await inboxAnchor.getAttribute('href'),href)
  const inboxRest=await operator.request.get(`${base}/api/conversations/${session.conversationId}/messages`);assert.equal(inboxRest.status(),200);assert.deepEqual((await inboxRest.json()).messages.find(m=>m.id===answer.id),answer)
  await operator.reload();await inboxAnchor.waitFor();assert.equal(await inboxAnchor.getAttribute('href'),href)
  // Second customer request may make at most one bounded generation. No retry of paid work.
  await input.fill('Please switch me to a human teammate now.');await widget.locator('button[name=submit]').click()
  const assignment=await until(async()=>{
   const r=await operator.request.get(`${base}/api/dashboard/projects/${session.projectId}/conversations/${session.conversationId}`);assert.equal(r.status(),200);return (await r.json()).data
  },c=>Boolean(c.agent_id)&&!c.ai_id,'switch_agent human handoff')
  assert.ok(assignment.agent_id)
  await operator.reload()
  const reply=`Operator reply ${session.conversationId}`
  await operator.getByPlaceholder('Type your reply…').fill(reply)
  await operator.getByRole('button',{name:'Send',exact:true}).click()
  await widget.getByText(reply,{exact:true}).waitFor()
  const final=await transcript(),operatorReplies=final.messages.filter(m=>m.content===reply);assert.equal(operatorReplies.length,1)
  const persistedReply=operatorReplies[0];assert.ok(persistedReply.id);assert.ok(['owner','admin','operator'].includes(persistedReply.actor_role))
  const operatorFrame=await until(async()=>frames.find(f=>f.message?.id===persistedReply.id),Boolean,'socket operator message')
  assert.equal(operatorFrame.message.content,persistedReply.content);assert.equal(operatorFrame.message.actor_role,persistedReply.actor_role);assert.equal(operatorFrame.message.actor_id,persistedReply.actor_id)
  await widget.reload();await mount();await widget.getByText(reply,{exact:true}).waitFor()
  assert.equal(await widget.getByText(reply,{exact:true}).count(),1)
  const reloadedReplies=(await transcript()).messages.filter(m=>m.id===persistedReply.id)
  assert.equal(reloadedReplies.length,1);assert.deepEqual(reloadedReplies[0],persistedReply)
  assert.equal((await transcript()).messages.filter(m=>m.content===reply).length,1)
  live={operator,session,reply,persistedReply}
  console.log('Live proof passed: native anchor, durable REST/socket identity, widget/inbox reload, human handoff and operator reply.')
 }finally{await widgetContext.close()}
})

test('the operator\'s transcript mail of that conversation is delivered with the reply and passes DMARC',{
 skip:absent.length||!process.env.TEST_MAIL_TO||!process.env.MAILBOX_RECEIPT_URL?'BASE_URL, WIDGET_KEY, OPERATOR_EMAIL, OPERATOR_PASSWORD, TEST_MAIL_TO and MAILBOX_RECEIPT_URL required; no mail sent':false,
 timeout:240000,
},async()=>{
 assert.ok(live,'the cited-answer journey ran first in this file')
 const {operator,session,reply,persistedReply}=live

   const r=await operator.request.put(`${base}/api/dashboard/projects/${session.projectId}/conversations/${session.conversationId}`,{data:{send_transcript_to:process.env.TEST_MAIL_TO,idempotencyKey:`t021-mail:${session.conversationId}`}})
   assert.equal(r.status(),200)
   const receipt=await until(async()=>{const r=await fetch(process.env.MAILBOX_RECEIPT_URL);assert.ok(r.ok);return authenticatedReplyReceipt(await r.json(),reply)},Boolean,'authenticated delivered mail receipt')
   assert.equal(receipt.auth.dmarc,'pass');assert.ok(receipt.excerpt.includes(persistedReply.content))
})
