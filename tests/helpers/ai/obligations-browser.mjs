import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'

// Only initial conversation data is seeded. Every proposal and acceptance is
// made by the operator in the native ticket sidebar at both supported widths.
export async function obligationsBrowserJourney({runtime,browser,shot,widths=[390]}) {
 for(const width of widths) {
  const origin=runtime.origin,tenant=await runtime.seedTenant({name:`Follow-up ${width}`,email:`followup-${width}-${randomUUID()}@example.test`,allowedOrigin:origin})
  const call=async(path,body,token=tenant.token)=>{
   const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Origin:origin,Authorization:'Bearer '+token},body:body===undefined?undefined:JSON.stringify(body)})
   assert.ok(response.ok,path+': '+response.status+' '+await response.clone().text());return response.json()
  }
  const project=await call(`/api/identity/projects/${tenant.projectId}`),visitor=await call('/api/identity/widget/session',{widgetKey:project.widget_key,name:'Export customer'})
  const conversation=await call('/api/conversations',{projectId:tenant.projectId},visitor.token),messages=`/api/conversations/${conversation.id}/messages`
  await call(messages,{localId:randomUUID(),content:'Please keep me updated.',expectedRevision:0},visitor.token)
  const current=await call(messages),promise='I will send an export update by tomorrow. This message also retains the exact context and all the additional terms discussed with the customer.'
  const sent=await call(messages,{localId:randomUUID(),content:promise,expectedRevision:current.revision,expectedLastMessageId:current.lastMessageId})
  const before=(await call(messages)).messages.length
  const base=`/api/ai-support/projects/${tenant.projectId}/conversations/${conversation.id}/obligations`
  await runtime.execute(`INSERT INTO escalation_connections(id,project_id,provider,target,updated_at) VALUES('synthetic-hh-connection-${tenant.projectId}','${tenant.projectId}','github','just-every/run-happytohelp',1);
 INSERT INTO escalation_issues VALUES('synthetic-hh-issue-${tenant.projectId}','${tenant.projectId}','synthetic-hh-connection-${tenant.projectId}','github','${width}','HH-${width}','https://github.com/just-every/run-happytohelp/issues/1','closed',NULL,1,1);
 INSERT INTO escalation_links(id,project_id,conversation_id,issue_id,created_at) VALUES('synthetic-hh-link-${tenant.projectId}','${tenant.projectId}','${conversation.id}','synthetic-hh-issue-${tenant.projectId}',1);`)
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[]
  page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(20000)
  try {
   await context.addCookies([{name:'h2h_session',value:tenant.token,url:origin}])
   const open=async()=>{
    await page.goto(`${origin}/projects/${tenant.projectId}/conversations/${conversation.id}`)
    await page.locator('#conversation-assistant').waitFor({state:'attached'})
    if(await page.locator('#conversation-assistant').getAttribute('aria-hidden')==='true')await page.getByRole('button',{name:'Show conversation panel',exact:true}).click()
    await page.getByRole('tab',{name:'Ticket',exact:true}).click()
    const heading=page.locator('#ticket-section-followups-heading');await heading.waitFor()
    if(await heading.getAttribute('aria-expanded')!=='true')await heading.click()
    await page.getByText('No follow-up promises yet.',{exact:true}).waitFor().catch(()=>{})
   }
   await open();const panel=page.locator('.followup-obligations')
   await panel.getByText('Propose a follow-up',{exact:true}).click()
   await panel.getByLabel('Promise message',{exact:true}).selectOption(sent.message.id)
   await panel.getByLabel('Source message',{exact:true}).evaluate(element=>{element.focus();element.setSelectionRange(7,element.value.indexOf('.'))})
   await panel.getByRole('button',{name:'Use selected quote',exact:true}).click()
   assert.equal(await panel.getByLabel('Exact promise quote',{exact:true}).inputValue(),'send an export update by tomorrow')
   const form=panel.locator('form').first(),due=new Date(Date.now()+3600000);due.setSeconds(0,0)
   const local=new Date(due.getTime()-due.getTimezoneOffset()*60000).toISOString().slice(0,16)
   await form.getByLabel('Responsible teammate',{exact:true}).selectOption(tenant.userId)
   await form.getByLabel('Engineering dependency',{exact:true}).selectOption(`synthetic-hh-issue-${tenant.projectId}`)
   await form.getByLabel('Due time',{exact:true}).fill(local)
   await form.getByLabel('Stop condition',{exact:true}).fill('The customer receives an honest update.')
   await panel.getByLabel('Exact promise quote',{exact:true}).scrollIntoViewIfNeeded()
   await page.screenshot({path:shot(`followup-selection-${width}.png`),fullPage:true})
   if(width===390) {
    const targets=await panel.locator('button,input,select,textarea,summary').evaluateAll(elements=>elements.filter(el=>el.checkVisibility()).map(el=>({name:el.getAttribute('aria-label')||el.textContent.trim(),width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height})))
    assert.ok(targets.every(target=>target.width>=44&&target.height>=44),JSON.stringify(targets))
    for(const target of await panel.locator('button,input,select,textarea,summary').all()) {
     if(!await target.isVisible())continue
     await page.keyboard.press('Tab');await target.focus()
     assert.equal(await target.evaluate(el=>getComputedStyle(el).outlineStyle),'solid','keyboard focus remains visible')
    }
   }
   assert.match(await form.getByLabel('Promise message',{exact:true}).locator('option:checked').textContent(),/…$/)
   assert.equal(await form.getByLabel('Promise message',{exact:true}).locator('option:checked').getAttribute('title'),promise)
   await form.getByRole('button',{name:'Propose promise',exact:true}).click()
   await panel.getByText(/Awaiting acceptance/).waitFor()
   let row=(await call(base)).obligations[0]
   assert.equal(row.state,'proposed');assert.equal(row.accepted_by,null);assert.equal(row.draft,null)
   await form.getByRole('button',{name:'Propose promise',exact:true}).click()
   await panel.getByRole('status').filter({hasText:'Existing promise found. No new promise was created.'}).waitFor()
   const revised='The customer receives the reviewed update.'
   await form.getByLabel('Stop condition',{exact:true}).fill(revised)
   const revisedDue=new Date(due.getTime()+60000),revisedLocal=new Date(revisedDue.getTime()-revisedDue.getTimezoneOffset()*60000).toISOString().slice(0,16)
   await form.getByLabel('Due time',{exact:true}).fill(revisedLocal)
   await form.getByRole('button',{name:'Propose promise',exact:true}).click()
   await panel.getByRole('status').filter({hasText:'Existing promise found. Revised terms are pending your review.'}).waitFor()
   assert.equal((await call(base)).obligations.length,1)
   assert.equal((await call(base)).obligations[0].stop_condition,'The customer receives an honest update.')
   await panel.getByRole('region',{name:'Pending promise changes'}).waitFor()
   await panel.getByText('Propose a follow-up',{exact:true}).click()
   await panel.locator('article').first().scrollIntoViewIfNeeded()
   await page.screenshot({path:shot(`followup-proposed-${width}.png`),fullPage:true})
   await panel.getByRole('button',{name:'Accept promise changes',exact:true}).click()
   await panel.getByText(/Accepted promise/).waitFor();await panel.getByRole('region',{name:'Unsent follow-up draft'}).waitFor()
   if(width===390) {
    const targets=await panel.locator('button,input,select,textarea,summary').evaluateAll(elements=>elements.filter(el=>el.checkVisibility()).map(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height})))
    assert.ok(targets.every(target=>target.width>=44&&target.height>=44),JSON.stringify(targets))
   }
   // A stale visible form must fail with two readable sentences, without replay.
   let accepted=(await call(base)).obligations[0]
   await call(base+'/'+accepted.id+'/accept',{version:accepted.version,ownerId:tenant.userId,dueAt:revisedDue.getTime(),stopCondition:revised,dependencyId:accepted.dependency_id})
   await panel.getByRole('button',{name:'Accept promise changes',exact:true}).click()
   await panel.getByRole('alert').filter({hasText:'Obligation or authority changed. Refresh the record before trying again.'}).waitFor()
   await page.screenshot({path:shot(`followup-error-${width}.png`),fullPage:true})
   await panel.getByRole('button',{name:'Refresh promises',exact:true}).click()
   await panel.getByText('Propose a follow-up',{exact:true}).waitFor()
   // Portable archives deliberately redact this personal field. The same blank
   // stored state is re-entered here through the operator's restored form.
   await runtime.execute(`UPDATE followup_obligations SET stop_condition='',version=version+1 WHERE id='${accepted.id}'`)
   await panel.getByRole('button',{name:'Refresh promises',exact:true}).click()
   await panel.getByText('Stop when: Re-enter the stop condition after restore.',{exact:true}).waitFor()
   const review=panel.locator('article form').first()
   await review.getByLabel('Stop condition',{exact:true}).fill(revised)
   await review.getByRole('button',{name:'Accept promise changes',exact:true}).click()
   await panel.getByText('Stop when: '+revised,{exact:true}).waitFor()
   await page.reload();await open()
   assert.equal(await panel.locator('article').getByLabel('Stop condition',{exact:true}).inputValue(),revised)
   row=(await call(base)).obligations[0]
   assert.equal(row.owner_id,tenant.userId);assert.equal(row.due_at,revisedDue.getTime());assert.equal(row.stop_condition,revised);assert.equal(row.pendingTerms,null);assert.equal(row.state,'open')
   assert.equal(row.dependency.stale,true);assert.equal(row.dependency.progress,'unconfirmed')
   await panel.getByText(/No current readback/).waitFor()
   assert.equal((await call(messages)).messages.length,before,'proposal, acceptance and draft review send nothing')
   await page.addScriptTag({path:'node_modules/axe-core/axe.min.js'})
   const violations=await page.evaluate(async()=>(await window.axe.run('.followup-obligations',{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})))
   assert.deepEqual(violations,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
   await page.screenshot({path:shot(`followup-accepted-${width}.png`),fullPage:true})
   const draft=panel.getByRole('region',{name:'Unsent follow-up draft'})
   assert.match(await draft.innerText(),/do not yet have current evidence/)
   await draft.scrollIntoViewIfNeeded()
   await page.screenshot({path:shot(`followup-draft-${width}.png`),fullPage:true})
   assert.ok((await panel.locator('button').allTextContents()).every(text=>text.trim()),'all new controls have visible text labels')
   for(const control of await page.locator('button[data-tooltip]').all()) {
    if(!await control.isVisible() || (await control.innerText()).trim())continue
    const label=await control.getAttribute('aria-label')
    await control.hover();await page.locator('.ui-tooltip[data-open]').filter({hasText:label}).waitFor()
    await page.mouse.move(0,0);await page.keyboard.press('Tab');await control.focus()
    await page.locator('.ui-tooltip[data-open]').filter({hasText:label}).waitFor({timeout:1000})
    await page.screenshot({path:shot(`followup-tooltip-${width}.png`),fullPage:true})
    break
   }
   assert.deepEqual(errors,[])
  } catch(error) {await page.screenshot({path:shot(`followup-failure-${width}.png`),fullPage:true});throw error}
  finally {await context.close()}
 }
}
