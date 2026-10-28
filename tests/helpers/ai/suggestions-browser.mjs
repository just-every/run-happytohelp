import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'

// The AI panel at one width: Generate waits for a customer message; Enter in the instructions requests
// suggestions once (Shift+Enter is a newline, a held Enter never repeats) and the cards appear without sending.
export async function suggestionsAtWidth({runtime,browser,shot,viewport}){
 const origin=runtime.origin,tenant=await runtime.seedTenant({name:'Suggestions '+viewport.width,email:`suggest-${viewport.width}@example.test`,allowedOrigin:origin})
 await runtime.execute(`INSERT INTO ai_profiles(id,project_id,name,role,prompt,model,created_at) VALUES('ai-${viewport.width}','${tenant.projectId}','Helper','support','Use evidence','gpt-5.6-luna',1); INSERT INTO project_settings(project_id,settings_json,updated_at) VALUES('${tenant.projectId}','{"default_visitor_ai_id":"ai-${viewport.width}"}',1);`)
 const json=async(path,body,token,headers={},method=body?'POST':'GET')=>{const response=await fetch(origin+path,{method,headers:{'Content-Type':'application/json',Origin:origin,...(token?{Authorization:'Bearer '+token}:{}),...headers},body:body?JSON.stringify(body):undefined});assert.ok(response.ok,path+': '+response.status);return response.json()}
 const project=await json(`/api/identity/projects/${tenant.projectId}`,undefined,tenant.token)
 const visitor=await json('/api/identity/widget/session',{widgetKey:project.widget_key,name:'Shopper'}),conversation=await json('/api/conversations',{projectId:tenant.projectId},visitor.token)
 // A person owns the conversation, so only requested suggestions are generated.
 await json(`/api/dashboard/projects/${tenant.projectId}/conversations/${conversation.id}/actions`,{action:'assignAi',data:{ai_id:null}},tenant.token)
 const context=await browser.newContext({viewport}),page=await context.newPage(),errors=[],assists=[]
 page.on('pageerror',error=>errors.push(error.message))
 page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/actions')&&request.postDataJSON()?.action==='agentAssist')assists.push(request.postDataJSON())})
 try{
  await context.addCookies([{name:'h2h_session',value:tenant.token,url:origin}])
  const open=async()=>{await page.goto(`${origin}/projects/${tenant.projectId}/conversations/${conversation.id}`);const toggle=page.getByRole('button',{name:'Show conversation panel',exact:true});await page.locator('.conversation-assistant-toggle').waitFor();if(viewport.width===1440){await page.locator('.conversation-assistant-toggle').focus();await page.locator('.ui-tooltip').filter({hasText:'conversation panel'}).waitFor({state:'visible'});}if(await toggle.isVisible())await toggle.click();await page.getByRole('tab',{name:'Suggest',exact:true}).click()}
  await open();const generate=page.getByRole('button',{name:'Generate',exact:true})
  await page.getByText('Add a customer message first.',{exact:true}).waitFor();assert.ok(await generate.isDisabled())
  await json(`/api/conversations/${conversation.id}/messages`,{localId:randomUUID(),content:'How do I cancel my order?',expectedRevision:0},visitor.token)
  await open();const instructions=page.locator('#conversation-ai-instructions');await page.waitForFunction(()=>!document.querySelector('#conversation-ai-instructions')?.disabled)
  await instructions.fill('Be brief');await page.keyboard.press('Shift+Enter');await page.keyboard.type('and kind');assert.equal(await instructions.inputValue(),'Be brief\nand kind','Shift+Enter is a newline');assert.equal(assists.length,0)
  await page.keyboard.down('Enter');await page.keyboard.down('Enter');await page.keyboard.up('Enter')
  await page.getByRole('button',{name:'Cancel order'}).first().waitFor({timeout:30000})
  assert.equal(assists.length,1,'one request for Enter, none for the held repeat');assert.ok(JSON.stringify(assists[0]).includes('Be brief\\nand kind'),'the instructions travel with the request')
  const transcript=await json(`/api/conversations/${conversation.id}/messages`,undefined,visitor.token);assert.equal(transcript.messages.length,1,'suggestions never send')
  await page.screenshot({path:shot(`suggestions-${viewport.width}.png`),fullPage:true})
  await json(`/api/dashboard/projects/${tenant.projectId}/conversations/${conversation.id}/actions`,{action:'assignAi',data:{ai_id:'ai-'+viewport.width}},tenant.token)
  // Two native resolution cycles with different customer feedback; no latest-label copying.
  const conversationPath=`/api/dashboard/projects/${tenant.projectId}/conversations/${conversation.id}`
  const tracePath=`/api/ai-support/projects/${tenant.projectId}/conversations/${conversation.id}/trace`
  const transcriptPath=`/api/conversations/${conversation.id}/messages`
  const solve=()=>json(conversationPath,{resolved:true},tenant.token,{},'PUT')
  const rate=(resolutionId,value)=>json(`/api/conversations/${conversation.id}/widget-events`,{action:'rateResolution',data:{resolutionId,value,comment:'Private customer feedback'}},visitor.token)
  const waitCommitted=async(exclude=null)=>{const deadline=Date.now()+30000;while(Date.now()<deadline){const run=(await json(tracePath,undefined,tenant.token)).generations.find(run=>run.id!==exclude&&run.committedAnswer);if(run)return run;await new Promise(resolve=>setTimeout(resolve,250))}assert.fail('the native trace must contain the committed answer before resolving')}
  const firstExecution=await waitCommitted()
  await solve()
  const firstResolution=(await json(transcriptPath,undefined,visitor.token)).resolution
  await rate(firstResolution.id,-1)
  const solvedExecution=(await json(tracePath,undefined,tenant.token)).generations.find(run=>run.id===firstExecution.id)
  assert.equal(solvedExecution.customerOutcome.cycle.id,firstResolution.id)
  // Inspect the real conversation's execution record, with an interrupted historical attempt alongside it.
  await runtime.restart(()=>runtime.execute(`INSERT INTO ai_generations(id,project_id,conversation_id,state,source_revision,source_context_revision,actor_json,model,ai_id,ai_profile_json,created_at,updated_at) VALUES('trace-${viewport.width}','${tenant.projectId}','${conversation.id}','uncertain',1,0,'{"role":"contact"}','gpt-5.6-luna','ai-${viewport.width}','{}','2026-01-01T00:00:00Z','2026-01-01T00:00:01Z'); INSERT INTO ai_attempts(id,generation_id,state,started_at,finished_at,error) VALUES('trace-attempt-${viewport.width}','trace-${viewport.width}','uncertain','2026-01-01T00:00:00Z','2026-01-01T00:00:01Z','TimeoutError: synthetic-hh-private'); INSERT INTO ai_attempt_events(attempt_id,type,event_json,created_at) VALUES('trace-attempt-${viewport.width}','tool_trace','{"name":"cite_knowledge","outcome":"denied","durationMs":1}','2026-01-01T00:00:01Z');`))
  await page.reload();await page.locator('.conversation-assistant-toggle').waitFor()
  const reopenedPanel=page.getByRole('button',{name:'Show conversation panel',exact:true});if(await reopenedPanel.isVisible())await reopenedPanel.click()
  await page.getByRole('tab',{name:'Ticket',exact:true}).click()
  const traceToggle=page.getByRole('button',{name:'Execution trace',exact:true});await traceToggle.click()
  const tracePanel=page.getByRole('region',{name:'Execution trace',exact:true})
  await tracePanel.getByText('unknown · uncertain',{exact:true}).waitFor()
  const committed=tracePanel.locator('summary').filter({hasText:/^\s*committed answer · completed\s*$/}).first()
  await committed.click()
  if(viewport.width===1440){
   await committed.locator('..').getByText('completed',{exact:true}).waitFor()
   assert.match(await committed.locator('..').innerText(),/revision [0-9]+/)
   await committed.locator('..').getByText('Feedback: -1 (thumbs), revision 1',{exact:true}).waitFor()
   assert.equal(await committed.locator('..').getByRole('link',{name:'Open conversation'}).getAttribute('href'),`/projects/${tenant.projectId}/conversations/${conversation.id}`)
   assert.ok(await committed.locator('..').getByText('explicit operator request',{exact:true}).count()===0,'operator requests are not falsely attributed to the automatic reply')
  }
  await committed.locator('..').getByText('Feedback: -1 (thumbs), revision 1',{exact:true}).scrollIntoViewIfNeeded()
  await page.screenshot({path:shot(`cycle-negative-${viewport.width}.png`),fullPage:true})
  await committed.click()
  const details=tracePanel.locator('summary').filter({hasText:'unknown · uncertain'})
  await details.focus();await page.keyboard.press('Enter')
  await tracePanel.getByText('timeout',{exact:true}).waitFor()
  if(viewport.width===1440){
   assert.ok(await tracePanel.getByText('cite_knowledge · denied · 1 ms',{exact:true}).isVisible())
   assert.doesNotMatch(await tracePanel.innerText(),/synthetic-hh-private/)
   assert.ok(await tracePanel.getByText('Provider cost: unavailable.',{exact:false}).isVisible())
  }
  await traceToggle.evaluate(element=>element.scrollIntoView({block:'start'}))
  await page.screenshot({path:shot(`trace-overview-${viewport.width}.png`),fullPage:true})
  await tracePanel.getByText('cite_knowledge · denied · 1 ms',{exact:true}).scrollIntoViewIfNeeded()
  await page.screenshot({path:shot(`trace-${viewport.width}.png`),fullPage:true})
  const refresh=tracePanel.getByRole('button',{name:'Refresh trace'})
  const capture=async name=>page.screenshot({path:shot(`${name}-${viewport.width}.png`),fullPage:true})
  const expandCycles=async feedback=>{
   // A pre-refresh summary can still be attached while the new read is in flight.
   // Wait for this cycle's updated label before expanding the rendered records.
   await tracePanel.getByText(feedback,{exact:true}).waitFor({state:'attached'})
   for(const summary of await tracePanel.locator('summary').all())if((await summary.innerText()).trim().startsWith('committed answer')&&await summary.locator('..').getAttribute('open')===null){
    await summary.press('Enter')
    if(viewport.width===1440)assert.ok(await summary.evaluate(element=>element.parentElement.open&&element===document.activeElement),'keyboard expansion opens the record and keeps focus')
   }
   await tracePanel.getByText(feedback,{exact:true}).waitFor()
  }
  await rate(firstResolution.id,1);await refresh.click()
  await tracePanel.locator('summary').first().waitFor();await expandCycles('Feedback: 1 (thumbs), revision 2')
  if(viewport.width===1440)await tracePanel.getByText('Feedback: 1 (thumbs), revision 2',{exact:true}).waitFor()
  await tracePanel.getByText('Feedback: 1 (thumbs), revision 2',{exact:true}).scrollIntoViewIfNeeded();await capture('cycle-rerated')
  await rate(firstResolution.id,-1)
  const beforeReopen=await json(transcriptPath,undefined,visitor.token)
  await json(transcriptPath,{localId:randomUUID(),content:'I still need help with the cancellation.',expectedRevision:beforeReopen.revision,expectedLastMessageId:beforeReopen.lastMessageId},visitor.token)
  await waitCommitted(firstExecution.id)
  const humanHead=await json(transcriptPath,undefined,visitor.token)
  await json(transcriptPath,{localId:randomUUID(),content:'I checked the cancellation personally.',authoring:{kind:'human'},expectedRevision:humanHead.revision,expectedLastMessageId:humanHead.lastMessageId,resolve:true},tenant.token)
  const nextResolution=(await json(transcriptPath,undefined,visitor.token)).resolution
  await rate(nextResolution.id,1);await refresh.click();await tracePanel.locator('summary').first().waitFor();await expandCycles('Feedback: -1 (thumbs), revision 3')
  if(viewport.width===1440){
   await tracePanel.getByText('Feedback: -1 (thumbs), revision 3',{exact:true}).waitFor()
   await tracePanel.getByText('Feedback: 1 (thumbs), revision 1',{exact:true}).waitFor()
   assert.match(await tracePanel.innerText(),/Reopened 20/)
   assert.doesNotMatch(await tracePanel.innerText(),/Private customer feedback/)
   const focused=tracePanel.locator('summary').last();await focused.focus();await page.keyboard.press('Enter');assert.ok(await focused.evaluate(element=>element===document.activeElement));await page.keyboard.press('Enter')
   assert.ok(await tracePanel.evaluate(element=>element.scrollWidth<=element.clientWidth),'trace details fit their panel')
  }
  await tracePanel.getByText('Feedback: -1 (thumbs), revision 3',{exact:true}).scrollIntoViewIfNeeded();await capture('cycle-reopened')
  await tracePanel.getByText('Feedback: 1 (thumbs), revision 1',{exact:true}).scrollIntoViewIfNeeded();await capture('cycle-second')
  // Hold a real read at the browser network edge, then release it unchanged.
  let release;const pending=new Promise(resolve=>{release=resolve})
  await page.route('**/trace',async route=>{await pending;await route.continue()})
  await refresh.click();await tracePanel.getByRole('status').waitFor();await capture('trace-loading');release();await page.unrouteAll({behavior:'wait'})
  await tracePanel.locator('summary').first().waitFor()
  await page.route('**/trace',route=>route.abort('failed'));await refresh.click();await tracePanel.getByRole('alert').waitFor();await capture('trace-failed');await page.unroute('**/trace')
  await refresh.click();await tracePanel.locator('summary').first().waitFor()
  await json(`/api/management/projects/${tenant.projectId}/contacts/${visitor.contactId}/erase`,{},tenant.token)
  await refresh.click();await tracePanel.locator('summary').first().waitFor()
  const erasedDetail=tracePanel.locator('details').filter({hasText:'Contribution or cycle evidence was erased.'}).first()
  await erasedDetail.waitFor()
  if(await erasedDetail.getAttribute('open')===null)await erasedDetail.locator('summary').click()
  await erasedDetail.getByText('Unknown: Contribution or cycle evidence was erased.',{exact:true}).scrollIntoViewIfNeeded()
  await capture('trace-erased')
  await runtime.restart(()=>runtime.execute(`DELETE FROM memberships WHERE project_id='${tenant.projectId}' AND user_id='${tenant.userId}'`))
  await refresh.click();await tracePanel.getByRole('alert').waitFor();await capture('trace-revoked')
  await runtime.restart(()=>runtime.execute(`INSERT INTO memberships(project_id,user_id,role) VALUES('${tenant.projectId}','${tenant.userId}','owner')`))
  const emptyVisitor=await json('/api/identity/widget/session',{widgetKey:project.widget_key,name:'Another shopper'})
  const emptyConversation=await json('/api/conversations',{projectId:tenant.projectId},emptyVisitor.token)
  await page.goto(`${origin}/projects/${tenant.projectId}/conversations/${emptyConversation.id}`)
  const show=page.getByRole('button',{name:'Show conversation panel',exact:true});await page.locator('.conversation-assistant-toggle').waitFor();if(await show.isVisible())await show.click()
  await page.getByRole('tab',{name:'Ticket',exact:true}).click();await page.getByRole('button',{name:'Execution trace',exact:true}).click()
  await page.getByText('No recorded executions.',{exact:true}).waitFor();await capture('trace-empty')
  assert.deepEqual(errors,[])
 }catch(error){await page.screenshot({path:shot(`trace-failure-${viewport.width}.png`),fullPage:true});throw error}finally{await context.close()}
}
