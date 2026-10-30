import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {createRuntime} from '../emitted-runtime.mjs'
import {viewports} from '../../journeys/kit/browser.mjs'

// AGENT-001 disclosure through the shipped widget and public conversation API.
// Reuse the model protocol fixture; no widget routes, responses or components are mocked.
export async function widgetIdentityBrowser({browser,shot}){
 const runtime=await createRuntime({queueConsumers:true,vars:{OPENAI_API_KEY:'synthetic-hh-1'},outboundFixture:new URL('../ai/suggestion-network.mjs',import.meta.url).href})
 const context=await browser.newContext({viewport:viewports.desktop}),page=await context.newPage(),errors=[],measurements=[]
 page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message))
 let passed=false
 try{
  const owner=await runtime.seedTenant({name:'Casey',email:'synthetic-happytohelp-widget@example.test',allowedOrigin:runtime.origin})
  const call=async(path,{body,token=owner.token,method=body===undefined?'GET':'POST',status=body===undefined?200:201}={})=>{
   const response=await fetch(runtime.origin+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})})
   assert.equal(response.status,status,`${method} ${path}`);return response.json()
  }
  const p=owner.projectId,base=`/api/management/projects/${p}`
  const ai=(await call(base+'/ais',{body:{name:'Robin',role:'Product support',prompt:'Answer the visitor briefly.',model:'gpt-5.6-luna'}})).data
  await call(base+'/ai',{method:'PUT',body:{default_visitor_ai_id:ai.id,is_human_response_enabled:true},status:200})
  await call(base+'/availability',{method:'PUT',body:{is_availability_schedule_enabled:false,is_presence_away_enabled:false},status:200})
  const project=await call('/api/identity/projects/'+p)
  const options={widgetKey:project.widget_key,apiOrigin:runtime.origin,open:true,settings:{collector:{enabled:false}}}
  const mount=async()=>{
   await page.addScriptTag({url:runtime.origin+'/widget.js'})
   await page.evaluate(options=>window.h2h('init',options),options)
   await page.locator('textarea[name=content]').waitFor()
  }
  await page.goto(runtime.origin+'/help/'+p);await mount()
  await page.locator('textarea[name=content]').fill('Hello, can you help me?')
  await page.locator('button[name=submit]').click()
  const storageKey=`rer-widget:${runtime.origin}:${project.widget_key}`
  await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key)||'null')?.conversationId,storageKey)
  const session=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)),storageKey)
  const path=`/api/conversations/${session.conversationId}/messages`,transcript=()=>call(path,{token:session.token})
  const header=page.locator('.happytohelp-chat-header'),disclosure=header.locator('.happytohelp-ai-disclosure')
  const answer=page.locator('.happytohelp-chat-agent .happytohelp-chat-message').getByText('Thanks for your message.',{exact:true})
  const aiGroup=page.locator('.happytohelp-chat-agent').filter({has:page.getByText('Thanks for your message.',{exact:true})})
  await answer.waitFor()
  const admitted=(await transcript()).messages.find(message=>message.actor_role==='ai')
  assert.ok(admitted?.id,'the queue admitted a real AI-authored message')
  assert.equal(admitted.actor_id,ai.id);assert.equal(await answer.innerText(),admitted.content)
  const trace=await call(`/api/ai-support/projects/${p}/conversations/${session.conversationId}/trace`)
  assert.ok(trace.generations.some(generation=>generation.result==='committed answer'&&generation.committedAnswer.id===admitted.id),'the rendered answer is the committed generation output')
  const assertAi=async()=>{
   await answer.waitFor();await disclosure.waitFor({state:'visible'})
   assert.match(await disclosure.innerText(),/\bAI\b/i,'visitors see AI disclosure as rendered text')
   assert.ok((await header.locator('.happytohelp-insight-agent-name').innerText()).includes(ai.name),'the visible disclosure names the admitted AI author')
   assert.ok(await disclosure.evaluate(element=>{const range=document.createRange();range.selectNodeContents(element);const box=range.getBoundingClientRect();return box.width>0&&box.height>0&&getComputedStyle(element).visibility==='visible'}),'disclosure text occupies visible pixels')
   await assertAiHistory()
  }
  const assertAiHistory=async()=>{
   assert.equal(await aiGroup.locator('.happytohelp-chat-agent-name').getByText(ai.name,{exact:true}).innerText(),ai.name,'AI history names its actual author')
   const label=aiGroup.locator('.happytohelp-ai-disclosure');await label.waitFor({state:'visible'})
   assert.match(await label.innerText(),/\bAI\b/i,'the actual AI message retains visible disclosure after handoff and reload')
  }
  const capture=async phase=>{
   for(const viewport of [viewports.desktop,viewports.mobile]){
    await page.setViewportSize(viewport)
    await page.locator('.happytohelp-chat-header').waitFor()
    await page.screenshot({path:shot(`widget-${phase}-${viewport.width}.png`),fullPage:true,animations:'disabled'})
    measurements.push(await header.evaluate((element,{phase,width})=>{
     const root=element.getRootNode(),rect=element.getBoundingClientRect(),label=root.querySelector('.happytohelp-ai-disclosure'),bounds=label?.getBoundingClientRect()
     const box=r=>r?{x:r.x,y:r.y,width:r.width,height:r.height}:null
     const labels=[...root.querySelectorAll('.happytohelp-ai-disclosure')].map(label=>{
      const range=document.createRange();range.selectNodeContents(label);const text=range.getBoundingClientRect()
      const clips=[];for(let parent=label.parentElement;parent;parent=parent.parentElement){const style=getComputedStyle(parent);if([style.overflowX,style.overflowY].some(value=>/hidden|clip|auto|scroll/.test(value))){const r=parent.getBoundingClientRect();if(text.left<r.left-1||text.right>r.right+1||text.top<r.top-1||text.bottom>r.bottom+1)clips.push(parent.className)}}
      return {text:label.innerText,bounds:box(text),clips}
     })
     return {phase,width,documentWidth:document.documentElement.scrollWidth,header:box(rect),disclosure:box(bounds),labels,headerText:element.innerText,groups:[...root.querySelectorAll('.happytohelp-chat-agent')].map(group=>({text:group.innerText,width:group.clientWidth,scrollWidth:group.scrollWidth}))}
    },{phase,width:viewport.width}))
   }
   await page.setViewportSize(viewports.desktop)
  }
  await assertAi()
  await page.reload();await mount();await assertAi()
  assert.equal((await transcript()).messages.find(message=>message.id===admitted.id).actor_id,ai.id)
  await capture('ai-history')
  console.log('PROBE AGENT-001 W1: built /widget.js -> visitor message -> queued model-edge fixture -> admitted AI answer; visible author and AI disclosure survive reload')

  // An ordinary operator reply takes over; the visitor then fetches both authors.
  const current=await transcript(),content='I am Casey, your support teammate. I will help from here.'
  const human=(await call(path,{token:owner.token,status:200,body:{localId:'synthetic-happytohelp-widget-human',content,expectedRevision:current.revision,expectedLastMessageId:current.lastMessageId}})).message
  assert.equal(human.actor_id,owner.userId);assert.equal(human.actor_role,'owner')
  const humanGroup=page.locator('.happytohelp-chat-agent').filter({has:page.getByText(content,{exact:true})})
  const assertHuman=async()=>{
   await humanGroup.getByText(content,{exact:true}).waitFor()
   await disclosure.waitFor({state:'hidden'})
   assert.ok((await header.innerText()).includes('Casey'),'the current human responder is visibly named')
   assert.match(await header.innerText(),/\bhuman\b/i,'the responder is visibly identified as human')
   assert.equal(await humanGroup.locator('.happytohelp-ai-disclosure').count(),0)
   assert.doesNotMatch(await humanGroup.innerText(),/\bAI\b/i,'the human response is not presented as AI')
   await assertAiHistory()
  }
  await assertHuman()
  await page.reload();await mount();await assertHuman()
  const history=(await transcript()).messages
  assert.equal(history.find(message=>message.id===admitted.id).actor_role,'ai')
  assert.equal(history.find(message=>message.id===human.id).actor_id,owner.userId)
  await capture('human-history')
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'desktop widget fits its viewport')
  assert.deepEqual(errors,[])
  console.log('PROBE AGENT-001 W2: ordinary operator reply -> human takeover -> widget reload -> distinct AI history author and visible Human responder; human message carries no AI label')
  await writeFile(shot('widget-identity-geometry.json'),JSON.stringify(measurements,null,2)+'\n')
  console.log('PROBE AGENT-001 W3: existing brand/widget browser registration -> rendered disclosure and fetched-history assertions; no additional test registration')
  passed=true
 }catch(error){await page.screenshot({path:shot('widget-identity-failure.png'),fullPage:true});throw error}
 finally{await context.close();await runtime.close(passed)}
}
