import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'

// The AI panel at one width: Generate waits for a customer message; Enter in the instructions requests
// suggestions once (Shift+Enter is a newline, a held Enter never repeats) and the cards appear without sending.
export async function suggestionsAtWidth({runtime,browser,shot,viewport}){
 const origin=runtime.origin,tenant=await runtime.seedTenant({name:'Suggestions '+viewport.width,email:`suggest-${viewport.width}@example.test`,allowedOrigin:origin})
 await runtime.execute(`INSERT INTO ai_profiles(id,project_id,name,role,prompt,model,created_at) VALUES('ai-${viewport.width}','${tenant.projectId}','Helper','support','Use evidence','gpt-5.6-luna',1); INSERT INTO project_settings(project_id,settings_json,updated_at) VALUES('${tenant.projectId}','{"default_visitor_ai_id":"ai-${viewport.width}"}',1);`)
 const json=async(path,body,token,headers={})=>{const response=await fetch(origin+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Origin:origin,...(token?{Authorization:'Bearer '+token}:{}),...headers},body:body?JSON.stringify(body):undefined});assert.ok(response.ok,path+': '+response.status);return response.json()}
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
  await page.waitForFunction(async({projectId,id})=>{const response=await fetch(`/api/ai-support/projects/${projectId}/conversations/${id}/trace`);return response.ok&&(await response.json()).generations.some(run=>run.committedAnswer)},{projectId:tenant.projectId,id:conversation.id},{timeout:30000})
  // Inspect the real conversation's execution record, with an interrupted historical attempt alongside it.
  await runtime.execute(`INSERT INTO ai_generations(id,project_id,conversation_id,state,source_revision,source_context_revision,actor_json,model,ai_id,ai_profile_json,created_at,updated_at) VALUES('trace-${viewport.width}','${tenant.projectId}','${conversation.id}','uncertain',1,0,'{"role":"contact"}','gpt-5.6-luna','ai-${viewport.width}','{}','2026-01-01T00:00:00Z','2026-01-01T00:00:01Z'); INSERT INTO ai_attempts(id,generation_id,state,started_at,finished_at,error) VALUES('trace-attempt-${viewport.width}','trace-${viewport.width}','uncertain','2026-01-01T00:00:00Z','2026-01-01T00:00:01Z','TimeoutError: synthetic-hh-private'); INSERT INTO ai_attempt_events(attempt_id,type,event_json,created_at) VALUES('trace-attempt-${viewport.width}','tool_trace','{"name":"cite_knowledge","outcome":"denied","durationMs":1}','2026-01-01T00:00:01Z');`)
  await page.getByRole('tab',{name:'Ticket',exact:true}).click()
  const traceToggle=page.getByRole('button',{name:'Execution trace',exact:true});await traceToggle.click()
  const tracePanel=page.getByRole('region',{name:'Execution trace',exact:true})
  await tracePanel.getByText('unknown · uncertain',{exact:true}).waitFor()
  const committed=tracePanel.locator('summary').filter({hasText:'committed answer · completed'}).first()
  await committed.click()
  if(viewport.width===1440){
   await committed.locator('..').getByText('completed',{exact:true}).waitFor()
   assert.match(await committed.locator('..').innerText(),/revision [0-9]+/)
   assert.ok(await committed.locator('..').getByText('explicit operator request',{exact:true}).count()===0,'operator requests are not falsely attributed to the automatic reply')
  }
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
  assert.deepEqual(errors,[])
 }finally{await context.close()}
}
