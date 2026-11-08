import assert from 'node:assert/strict'

/** The emitted dashboard and real failed authorization: a different signed-in
 * account cannot save this workspace. No route or response interception. */
export async function replyModeBrowserJourney({runtime,browser,shot}){
 const owner=await runtime.seedTenant({name:'AI reply modes',email:'modes@example.test',allowedOrigin:runtime.origin})
 const other=await runtime.seedTenant({name:'Other workspace',email:'other-modes@example.test',allowedOrigin:runtime.origin})
 const context=await browser.newContext({viewport:{width:1440,height:1000}})
 try{
  await context.addCookies([{name:'h2h_session',value:owner.token,url:runtime.origin}])
  const page=await context.newPage();page.setDefaultTimeout(20000)
  await page.goto(`${runtime.origin}/projects/${owner.projectId}/ais`)
  const select=page.getByLabel('AI replies',{exact:true}),path=`/api/management/projects/${owner.projectId}/ai`
  await select.waitFor();assert.equal(await select.inputValue(),'auto')
  const saved=page.waitForResponse(response=>new URL(response.url()).pathname===path&&response.request().method()==='PUT')
  await select.selectOption('draft');assert.equal((await saved).status(),200)
  await page.waitForFunction(()=>!document.querySelector('#ai_reply_mode').disabled)
  assert.equal(await select.inputValue(),'draft')
  await page.reload();await select.waitFor();assert.equal(await select.inputValue(),'draft','the successful choice persists')
  await context.addCookies([{name:'h2h_session',value:other.token,url:runtime.origin}])
  const refused=page.waitForResponse(response=>new URL(response.url()).pathname===path&&response.request().method()==='PUT')
  await select.selectOption('off');assert.equal((await refused).status(),403)
  await page.locator('#ai_reply_mode-error').waitFor()
  assert.equal(await select.inputValue(),'draft','a failed save shows the stored mode again')
  assert.match(await page.locator('#ai_reply_mode-error').innerText(),/access|permission|member/i)
  const read=await fetch(runtime.origin+path,{headers:{Authorization:`Bearer ${owner.token}`}})
  assert.equal(read.status,200);assert.equal((await read.json()).data.ai_reply_mode,'draft')
  // Assertions use one width; the changed screen is captured once at each proof width.
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   await page.screenshot({path:shot(`ai-reply-mode-failed-${width}.png`),fullPage:true})
  }
 }finally{await context.close()}
}
