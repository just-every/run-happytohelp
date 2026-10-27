import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'

// Only initial conversation data is seeded. Every proposal and acceptance is
// made by the operator in the native ticket sidebar at both supported widths.
export async function obligationsBrowserJourney({runtime,browser,shot}) {
 for(const width of [1440,390]) {
  const origin=runtime.origin,tenant=await runtime.seedTenant({name:`Follow-up ${width}`,email:`followup-${width}@example.test`,allowedOrigin:origin})
  const call=async(path,body,token=tenant.token)=>{
   const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Origin:origin,Authorization:'Bearer '+token},body:body===undefined?undefined:JSON.stringify(body)})
   assert.ok(response.ok,path+': '+response.status+' '+await response.clone().text());return response.json()
  }
  const project=await call(`/api/identity/projects/${tenant.projectId}`),visitor=await call('/api/identity/widget/session',{widgetKey:project.widget_key,name:'Export customer'})
  const conversation=await call('/api/conversations',{projectId:tenant.projectId},visitor.token),messages=`/api/conversations/${conversation.id}/messages`
  await call(messages,{localId:randomUUID(),content:'Please keep me updated.',expectedRevision:0},visitor.token)
  const current=await call(messages),promise='I will send an export update by tomorrow.'
  const sent=await call(messages,{localId:randomUUID(),content:promise,expectedRevision:current.revision,expectedLastMessageId:current.lastMessageId})
  const before=(await call(messages)).messages.length
  const base=`/api/ai-support/projects/${tenant.projectId}/conversations/${conversation.id}/obligations`
  await runtime.execute(`INSERT INTO escalation_connections(id,project_id,provider,target,updated_at) VALUES('synthetic-hh-connection-${width}','${tenant.projectId}','github','just-every/run-happytohelp',1);
 INSERT INTO escalation_issues VALUES('synthetic-hh-issue-${width}','${tenant.projectId}','synthetic-hh-connection-${width}','github','${width}','HH-${width}','https://github.com/just-every/run-happytohelp/issues/1','closed',NULL,1,1);
 INSERT INTO escalation_links(id,project_id,conversation_id,issue_id,created_at) VALUES('synthetic-hh-link-${width}','${tenant.projectId}','${conversation.id}','synthetic-hh-issue-${width}',1);`)
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
   await panel.getByLabel('Source message',{exact:true}).evaluate(element=>{element.focus();element.setSelectionRange(7,element.value.length-1)})
   await panel.getByRole('button',{name:'Use selected quote',exact:true}).click()
   assert.equal(await panel.getByLabel('Exact promise quote',{exact:true}).inputValue(),'send an export update by tomorrow')
   const form=panel.locator('form').first(),due=new Date(Date.now()+3600000);due.setSeconds(0,0)
   const local=new Date(due.getTime()-due.getTimezoneOffset()*60000).toISOString().slice(0,16)
   await form.getByLabel('Responsible teammate',{exact:true}).selectOption(tenant.userId)
   await form.getByLabel('Engineering dependency',{exact:true}).selectOption(`synthetic-hh-issue-${width}`)
   await form.getByLabel('Due time',{exact:true}).fill(local)
   await form.getByLabel('Stop condition',{exact:true}).fill('The customer receives an honest update.')
   await panel.getByLabel('Exact promise quote',{exact:true}).scrollIntoViewIfNeeded()
   await page.screenshot({path:shot(`followup-selection-${width}.png`),fullPage:true})
   await form.getByRole('button',{name:'Propose promise',exact:true}).click()
   await panel.getByText(/Awaiting acceptance/).waitFor()
   let row=(await call(base)).obligations[0]
   assert.equal(row.state,'proposed');assert.equal(row.accepted_by,null);assert.equal(row.draft,null)
   await panel.getByText('Propose a follow-up',{exact:true}).click()
   await panel.locator('article').first().scrollIntoViewIfNeeded()
   await page.screenshot({path:shot(`followup-proposed-${width}.png`),fullPage:true})
   await panel.getByRole('button',{name:'Accept promise changes',exact:true}).click()
   await panel.getByText(/Accepted promise/).waitFor();await panel.getByRole('region',{name:'Unsent follow-up draft'}).waitFor()
   row=(await call(base)).obligations[0]
   assert.equal(row.owner_id,tenant.userId);assert.equal(row.due_at,due.getTime());assert.equal(row.state,'open')
   assert.equal(row.dependency.stale,true);assert.equal(row.dependency.progress,'unconfirmed')
   await panel.getByText(/No current readback/).waitFor()
   assert.equal((await call(messages)).messages.length,before,'proposal, acceptance and draft review send nothing')
   await page.addScriptTag({path:'node_modules/axe-core/axe.min.js'})
   const violations=await page.evaluate(async()=>(await window.axe.run('.followup-obligations',{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})))
   assert.deepEqual(violations,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
   await page.screenshot({path:shot(`followup-accepted-${width}.png`),fullPage:true})
   assert.deepEqual(errors,[])
  } catch(error) {await page.screenshot({path:shot(`followup-failure-${width}.png`),fullPage:true});throw error}
  finally {await context.close()}
 }
}
