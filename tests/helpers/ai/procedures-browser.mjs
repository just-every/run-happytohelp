import assert from 'node:assert/strict'
export async function proceduresBrowserJourney({runtime,browser,shot}){
 const tenant=await runtime.seedTenant({name:'Synthetic procedures',email:'synthetic-hh-procedures@example.test',allowedOrigin:runtime.origin}),{projectId,token}=tenant
 const context=await browser.newContext({viewport:{width:1440,height:1000}})
 await context.addCookies([{name:'h2h_session',value:token,url:runtime.origin}])
 const page=await context.newPage(),root=`/api/projects/${projectId}/procedures`,errors=[]
 page.on('pageerror',e=>errors.push(e.message))
 try{
  await page.goto(`${runtime.origin}/projects/${projectId}/procedures`)
  await page.getByRole('button',{name:'Save immutable version'}).waitFor()
  await page.getByRole('button',{name:'Save immutable version'}).click()
  await page.getByRole('button',{name:'refund · Version 1',exact:true}).waitFor()
  await page.getByLabel('Instructions',{exact:true}).fill('synthetic-hh-failing: read policy and escalate to a human; never issue a refund.')
  await page.getByRole('button',{name:'Save immutable version'}).click()
  await page.getByRole('button',{name:'refund · Version 2',exact:true}).waitFor()
  const getVersions=await context.request.get(runtime.origin+root),versions=(await getVersions.json()).versions
  assert.equal(versions.length,2);assert.notEqual(versions[0].definition.instructions,versions[1].definition.instructions)
  for(const version of [1,2]){
   await page.getByRole('button',{name:`refund · Version ${version}`,exact:true}).click()
   await page.getByRole('button',{name:'Run synthetic simulation'}).click()
   await page.getByText('Simulation queued. Refresh receipts to inspect its outcome.').waitFor()
   let state
   for(let i=0;i<60;i++){
    const r=await context.request.get(runtime.origin+`${root}/refund/versions/${versions.find(v=>v.version===version).id}/simulations`)
    state=(await r.json()).runs[0]?.status
    if(state==='completed'||state==='uncertain')break
    await page.waitForTimeout(500)
   }
   assert.equal(state,'completed')
   await page.getByRole('button',{name:'Refresh receipts'}).click()
   await page.getByText('Simulation completed',{exact:true}).waitFor()
   await page.getByRole('button',{name:'Inspect cases'}).click()
   await page.getByRole('heading',{name:'allowed',exact:true}).waitFor()
   const receipt=page.getByLabel('Simulation receipt')
   assert.equal(await receipt.getByText(version===1?'completed · Passed':'completed · Not passed',{exact:true}).count(),4)
   assert.match(await receipt.innerText(),/search_knowledge: denied/)
   assert.match(await receipt.innerText(),/search_knowledge: timeout/)
   await page.getByRole('button',{name:'Check release'}).click()
   if(version===1)await page.getByText('Simulation qualified. Production rollout remains unavailable.').waitFor()
   else await page.getByRole('alert').filter({hasText:'Release refused'}).waitFor()
   for(const width of [1440,390]){
    await page.setViewportSize({width,height:width===390?844:1000})
    await page.screenshot({path:shot(`procedures-v${version}-${width}.png`),fullPage:true})
   }
   await page.setViewportSize({width:1440,height:1000})
  }
  assert.deepEqual(errors,[])
 }finally{await context.close()}
}
