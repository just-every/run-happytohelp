import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {readFile} from 'node:fs/promises'
import {createHmac} from 'node:crypto'
import {createRuntime} from '../emitted-runtime.mjs'
import {launchBrowser,evidence} from '../../journeys/kit/browser.mjs'
import {client} from '../../journeys/kit/http.mjs'

// "Possibly the same customer" in the emitted Worker and Chromium: an owner opens a customer from their company,
// links a second verified identity with evidence, sees it labelled as context with its reviewer and time on the
// customer page and in the requester's ticket, unlinks it
// with a reason, and reads both decisions in the link history; an unverified typed email is refused. Nothing is
// merged or sent, the security log records each decision, and each customer's widget shows only their own session.
export async function identityLinksBrowser(){
 const runtime=await createRuntime({vars:{H2H_LOCAL:'true',EMAIL_PROVIDER:'development',EMAIL_FROM:'support@localhost.test'}}),shot=await evidence('identity-links')
 const owner={name:'Northstar Help',ownerName:'Avery Reviewer',email:'identity-owner@example.test',password:'synthetic-identity-owner-password'}
 let browser,host,success=false
 try{
  const api=client(runtime.origin),boot=await api.ok('/api/identity/bootstrap',{body:{...owner,allowedOrigin:runtime.origin}}),p=boot.projectId,token=boot.token,M=`/api/management/projects/${p}`
  const widget=await readFile(new URL('../../../public/widget.js',import.meta.url))
  host=createServer((request,response)=>{response.setHeader('Content-Type',request.url==='/widget.js'?'text/javascript; charset=utf-8':'text/html; charset=utf-8');response.end(request.url==='/widget.js'?widget:'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Northstar account</title><main><h1>Your Northstar account</h1></main><script src="/widget.js"></script>')})
  await new Promise(done=>host.listen(0,'127.0.0.1',done))
  const hostOrigin=`http://127.0.0.1:${host.address().port}`
  await api.ok(`${M}/settings`,{token,method:'PUT',body:{allowed_origin:hostOrigin}})
  const {verificationSecret,widgetKey}=await api.ok(`${M}/widget-settings`,{token})
  const sign=identifier=>createHmac('sha256',verificationSecret).update(identifier).digest('hex')
  // Two verified identities of one person (a signed chat account and a signed mailbox) and one typed, unverified email.
  const customer=async(contact,question)=>{
   const session=await api.ok('/api/identity/widget/session',{headers:{Origin:hostOrigin},body:{widgetKey,...contact}})
   const conversation=await api.ok('/api/conversations',{token:session.token,body:{projectId:p}})
   await api.ok(`/api/conversations/${conversation.id}/messages`,{token:session.token,body:{localId:'opening',content:question,expectedRevision:0}})
   return {...session,conversationId:conversation.id,question}
  }
  const chat=await customer({name:'Morgan Lane',identifier:'synthetic-happytohelp-21',contact_hash:sign('synthetic-happytohelp-21')},'My order NS-2041 arrived damaged.')
  const mailbox=await customer({name:'M. Lane',email:'m.lane@customer.example.test',identifier:'m.lane@customer.example.test',contact_hash:sign('m.lane@customer.example.test')},'Can I change the delivery address for NS-2041?')
  const typed=await customer({name:'Morgan L.',email:'morgan.l@customer.example.test'},'Is my parcel lost?')
  const company=(await api.ok(`${M}/companies`,{token,body:{name:'Northstar Supply',domains:['customer.example.test']}})).company
  await api.ok(`${M}/companies/${company.id}/members/${chat.contactId}`,{token,method:'PUT',body:{}})
  const links=()=>api.ok(`${M}/contacts/${chat.contactId}/identity-links`,{token})
  const messageCounts=async()=>{const counts=[];for(const person of [chat,mailbox,typed])counts.push((await api.ok(`/api/conversations/${person.conversationId}/messages`,{token:person.token})).messages.length);return counts}
  const before=await messageCounts()
  browser=await launchBrowser()
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[]
  page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(15000)
  // Each state at 1440 and 390: no horizontal overflow, no WCAG axe violation in the panel, and a screenshot artifact.
  const capture=async(target,name,selector,prepare)=>{
   if(selector&&!await target.evaluate(()=>Boolean(window.axe)))await target.addScriptTag({path:'node_modules/axe-core/axe.min.js'})
   const restore=target.viewportSize()
   for(const width of [1440,390]){
    await target.setViewportSize({width,height:width===390?844:1000});await target.waitForTimeout(400)
    if(prepare)await prepare()
    assert.ok(await target.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${name} ${width} overflow`)
    if(selector){
     const violations=await target.evaluate(async selector=>{if(!document.querySelector(selector))return ['missing '+selector];const result=await window.axe.run({include:[selector]},{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}});return result.violations.map(({id,nodes})=>({id,nodes:nodes.map(node=>node.target)}))},selector)
     assert.deepEqual(violations,[],`${name} ${width} accessibility`)
    }
    await target.screenshot({path:shot(`${name}-${width}.png`),fullPage:true})
   }
   await target.setViewportSize(restore)
  }
  const panel=page.locator('.identity-links')
  // Open the customer from their company.
  await page.goto(runtime.origin+'/login?'+new URLSearchParams({returnTo:`/projects/${p}/companies`}))
  await page.getByLabel('Email',{exact:true}).fill(owner.email);await page.getByLabel('Password',{exact:true}).fill(owner.password);await page.getByRole('button',{name:'Login',exact:true}).click()
  await page.getByRole('button',{name:'View Northstar Supply',exact:true}).click()
  await page.getByRole('link',{name:'Morgan Lane',exact:true}).click()
  await page.waitForURL(url=>url.pathname===`/projects/${p}/contacts/${chat.contactId}`)
  await page.getByRole('heading',{name:/^Possibly the same customer/}).waitFor()
  await panel.getByText('Context only',{exact:true}).waitFor()
  await capture(page,'01-customer','.identity-links')
  // An address the visitor only typed is not identity proof.
  await panel.getByRole('button',{name:'Link a verified identity',exact:true}).click()
  const review=panel.getByRole('region',{name:'Link a verified identity'})
  await review.getByLabel('Customer name or email').fill('customer.example.test');await review.getByRole('button',{name:'Find customers',exact:true}).click()
  await review.locator('li',{hasText:'Morgan L.'}).getByRole('button',{name:'Choose',exact:true}).click()
  await review.getByLabel('Evidence',{exact:true}).fill('Same surname on a typed form synthetic-happytohelp-22')
  await review.getByRole('button',{name:'Preview link',exact:true}).click()
  await review.getByRole('alert').filter({hasText:/independent verification/}).waitFor()
  assert.equal((await links()).links.length,0,'a refused preview links nothing')
  await capture(page,'02-unverified-refused','.identity-links')
  // A verified mailbox identity: preview first, then confirm that exact preview.
  await review.getByRole('button',{name:'Change',exact:true}).click()
  await review.getByLabel('Customer name or email').fill('m.lane');await review.getByRole('button',{name:'Find customers',exact:true}).click()
  await review.locator('li',{hasText:'M. Lane'}).getByRole('button',{name:'Choose',exact:true}).click()
  const evidenceText='Confirmed both accounts on the NS-2041 support call synthetic-happytohelp-23'
  await review.getByLabel('Evidence',{exact:true}).fill(evidenceText)
  await review.getByRole('button',{name:'Preview link',exact:true}).click()
  await review.getByText('Preview — nothing changed yet',{exact:true}).waitFor()
  await review.getByText('Nothing is merged',{exact:true}).waitFor();await review.getByText('No message is sent',{exact:true}).waitFor()
  assert.equal((await links()).links.length,0,'a preview has no effect')
  await capture(page,'03-link-preview','.identity-links')
  await review.getByRole('button',{name:'Confirm link',exact:true}).click()
  await panel.getByRole('status').filter({hasText:'Linked M. Lane as possibly the same customer.'}).waitFor()
  const listed=panel.getByRole('list',{name:'Linked identities'}).getByRole('listitem').filter({hasText:'M. Lane'}).first()
  await listed.getByText(/^Linked by Avery Reviewer · /).waitFor();await listed.getByText(evidenceText).waitFor()
  // The linked identity's own conversations are shown as context, linking to their ticket.
  await listed.locator(`a[href="/projects/${p}/conversations/${mailbox.conversationId}"]`).waitFor()
  await capture(page,'04-linked','.identity-links')
  const linked=await links()
  assert.deepEqual(linked.links.map(link=>[link.contact.id,link.contact.proof,link.provenance,link.actor_name]),[[mailbox.contactId,'signed_widget',evidenceText,owner.ownerName]])
  assert.equal(linked.grants_customer_access,false)
  // Nothing merged, nothing sent, and each customer still reads only their own session.
  assert.deepEqual(await messageCounts(),before,'linking sends no message')
  for(const [person,other] of [[chat,mailbox],[mailbox,chat]]){
   assert.deepEqual((await api.ok(`/api/conversations?projectId=${p}`,{token:person.token})).conversations.map(row=>row.id),[person.conversationId])
   assert.equal((await api.call(`/api/conversations/${other.conversationId}/messages`,{token:person.token})).status,404,'a linked identity gains no other customer history')
   assert.deepEqual((await api.ok(`${M}/contacts/${person.contactId}/conversations`,{token})).data.map(row=>row.id),[person.conversationId],'the records stay separate')
  }
  // The requester's ticket shows the same labelled context under Ticket › Customer.
  await page.goto(`${runtime.origin}/projects/${p}/conversations/${chat.conversationId}`)
  const ticketContext=page.locator('.conversation-details-identity-links')
  const showTicketCustomer=async()=>{
   if(await page.locator('#conversation-assistant').getAttribute('aria-hidden')==='true')await page.getByRole('button',{name:'Show conversation panel',exact:true}).click()
   await page.getByRole('tab',{name:'Ticket',exact:true}).click()
   const toggle=page.locator('#ticket-section-customer-heading')
   if(await toggle.getAttribute('aria-expanded')!=='true')await toggle.click()
   await ticketContext.getByRole('link',{name:'M. Lane',exact:true}).waitFor()
   await ticketContext.scrollIntoViewIfNeeded()
  }
  await showTicketCustomer()
  await ticketContext.getByText('Context only. Nothing is merged or sent.',{exact:true}).waitFor()
  await ticketContext.getByText(/^Linked by Avery Reviewer · /).waitFor()
  await capture(page,'05-ticket-customer','.conversation-details-identity-links',showTicketCustomer)
  await page.goto(`${runtime.origin}/projects/${p}/contacts/${chat.contactId}`)
  await panel.getByRole('button',{name:'Unlink M. Lane',exact:true}).waitFor()
  const customerPage=await context.newPage()
  await customerPage.goto(hostOrigin)
  await customerPage.evaluate(options=>window.h2h('init',options),{widgetKey,apiOrigin:runtime.origin,open:true,settings:{collector:{enabled:false}},contact:{name:'Morgan Lane',identifier:'synthetic-happytohelp-21',hash:sign('synthetic-happytohelp-21')}})
  await customerPage.getByText(chat.question,{exact:true}).waitFor()
  assert.equal(await customerPage.getByText(mailbox.question).count(),0,'the customer sees only their own session')
  await capture(customerPage,'06-customer-own-session',null)
  await customerPage.close()
  // Unlink at phone width with a reason; both decisions stay in the history with reviewer, time and evidence.
  await page.setViewportSize({width:390,height:844})
  await panel.getByRole('button',{name:'Unlink M. Lane',exact:true}).click()
  const unlink=panel.getByRole('region',{name:'Unlink M. Lane'}),reason='Customer asked to keep the accounts apart synthetic-happytohelp-24'
  await unlink.getByLabel('Reason for unlinking',{exact:true}).fill(reason)
  await unlink.getByRole('button',{name:'Preview unlink',exact:true}).click()
  await unlink.getByText('Preview — nothing changed yet',{exact:true}).waitFor()
  await capture(page,'07-unlink-preview','.identity-links')
  await unlink.getByRole('button',{name:'Confirm unlink',exact:true}).click()
  await panel.getByRole('status').filter({hasText:'Unlinked M. Lane.'}).waitFor()
  await panel.getByText(/^No linked identities\./).waitFor()
  const history=panel.locator('.identity-links__decisions li')
  await history.filter({hasText:/^Unlinked M\. Lane/}).filter({hasText:reason}).filter({hasText:'Avery Reviewer'}).waitFor()
  await history.filter({hasText:/^Linked M\. Lane/}).filter({hasText:evidenceText}).filter({hasText:'Avery Reviewer'}).waitFor()
  await capture(page,'08-unlinked-history','.identity-links')
  const after=await links()
  assert.equal(after.links.length,0)
  assert.deepEqual(after.history.map(entry=>[entry.action,entry.provenance,entry.actor_name]),[['unlinked',reason,owner.ownerName],['linked',evidenceText,owner.ownerName]])
  const audited=(await api.ok(`${M}/audit?category=data`,{token})).data.filter(row=>row.action.startsWith('customer.identity_')).map(row=>row.action)
  assert.deepEqual(audited,['customer.identity_unlinked','customer.identity_linked'],'each decision is in the security log')
  assert.deepEqual(await messageCounts(),before,'unlinking sends no message')
  assert.deepEqual(errors,[])
  console.log(JSON.stringify({proof:'CUSTOMER-001 possibly the same customer',widths:[1440,390],linked:1,unlinked:1,refusedUnverified:1,messagesSent:0}))
  success=true
 }finally{await browser?.close();if(host)await new Promise(done=>host.close(done));await runtime.close(success)}
}
