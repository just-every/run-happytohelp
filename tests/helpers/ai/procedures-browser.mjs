import assert from 'node:assert/strict'
import {holdNativeResponse} from '../training-readiness.mjs'
import {procedureDefinition} from './procedures.mjs'

export async function proceduresBrowserJourney({runtime,browser,shot}){
 const tenant=await runtime.seedTenant({name:'Synthetic procedures',email:'synthetic-hh-procedures@example.test',allowedOrigin:runtime.origin}),{projectId,token,userId}=tenant
 const context=await browser.newContext({viewport:{width:1440,height:1000}})
 await context.addCookies([{name:'h2h_session',value:token,url:runtime.origin}])
 const page=await context.newPage(),root=`/api/projects/${projectId}/procedures`,url=`${runtime.origin}/projects/${projectId}/procedures`,errors=[],holds=[]
 page.on('pageerror',error=>errors.push(error.message))
 const button=name=>page.getByRole('button',{name,exact:true})
 const settled=async control=>{
  await page.waitForFunction(element=>element.getAttribute('aria-disabled')!=='true',await control.elementHandle())
  assert.ok(await control.evaluate(element=>document.activeElement===element),'the action keeps keyboard focus')
  assert.ok(await control.evaluate(element=>getComputedStyle(element).outlineStyle!=='none'),'the action keeps a visible focus ring')
 }
 const activate=async(control,ready)=>{await control.focus();await control.press('Enter');await ready();await settled(control)}
 const visibleResult=async()=>{
  const result=page.locator('.procedure-result');await result.waitFor()
  const box=await result.boundingBox();assert.ok(box.y>=0&&box.y+box.height<=1000,'action feedback is visible without searching above the form')
 }
 try{
  const initial=await holdNativeResponse(page,root);holds.push(initial)
  await page.goto(url);await initial.responseReady
  await page.getByRole('status').filter({hasText:'Loading procedure versions'}).waitFor()
  assert.equal(await page.locator('.procedure-settings form').count(),0,'loading never exposes an unavailable draft')
  initial.release();await initial.deliveryDone;await initial.close();await button('Save immutable version').waitFor()
  const fail=route=>route.abort('failed')
  await page.route('**'+root,fail);await page.reload();await page.getByRole('alert').waitFor()
  assert.equal(await page.locator('.procedure-settings form').count(),0,'a failed read never exposes a draft')
  assert.doesNotMatch(await page.locator('.workspace-page-content').innerText(),/Failed to fetch/)
  await page.unroute('**'+root,fail)
  await activate(button('Refresh versions'),()=>button('Save immutable version').waitFor());await visibleResult()

  // A committed save held in flight remains one POST even when Enter is repeated.
  let saves=0;page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/refund/versions'))saves++})
  const pending=await holdNativeResponse(page,root+'/refund/versions','POST');holds.push(pending)
  const save=button('Save immutable version');await save.focus();await save.press('Enter');await pending.responseReady
  await save.press('Enter');assert.equal(saves,1)
  assert.ok(await save.evaluate(element=>document.activeElement===element))
  pending.release();await pending.deliveryDone;await pending.close();await button('refund · Version 1').waitFor();await settled(save);await visibleResult()

  await page.getByLabel('Procedure key',{exact:true}).fill('Invalid key')
  await activate(save,()=>page.getByRole('alert').waitFor());await visibleResult()
  await page.getByLabel('Procedure key',{exact:true}).fill('refund')
  await page.getByLabel('Search knowledge',{exact:true}).uncheck()
  await activate(save,()=>page.getByRole('alert').waitFor());await visibleResult()
  await page.getByLabel('Search knowledge',{exact:true}).check()
  await page.getByLabel('Human escalation',{exact:true}).fill('Refund review team')
  await page.getByLabel('Instructions',{exact:true}).fill('synthetic-hh-failing: read policy and escalate to a human; never issue a refund.')
  await activate(save,()=>button('refund · Version 2').waitFor());await visibleResult()
  const getVersions=await context.request.get(runtime.origin+root),versions=(await getVersions.json()).versions
  assert.equal(versions.length,2);assert.notEqual(versions[0].definition.instructions,versions[1].definition.instructions)
  for(const version of [1,2]){
   const versionButton=button(`refund · Version ${version}`)
   await activate(versionButton,()=>button('Run synthetic simulation').waitFor());await visibleResult()
   assert.equal(await versionButton.getAttribute('aria-pressed'),'true')
   await activate(button('Run synthetic simulation'),()=>page.getByText('Simulation queued. Refresh receipts to inspect its outcome.').waitFor())
   let state
   for(let index=0;index<60;index++){
    const response=await context.request.get(runtime.origin+`${root}/refund/versions/${versions.find(item=>item.version===version).id}/simulations`)
    state=(await response.json()).runs[0]?.status
    if(state==='completed'||state==='uncertain')break
    await page.waitForTimeout(500)
   }
   assert.equal(state,'completed')
   await activate(button('Refresh receipts'),()=>page.getByText(`${version===1?4:0} of 4 passed · Completed`,{exact:true}).waitFor())
   assert.equal(await page.locator('.procedure-run time[datetime]').count(),1)
   await activate(button('Inspect cases'),()=>page.getByRole('heading',{name:'Allowed read',exact:true}).waitFor());await visibleResult()
   const receipt=page.getByLabel('Simulation receipt')
   assert.equal(await receipt.getByText(version===1?'Passed':'Not passed',{exact:true}).count(),4)
   assert.match(await receipt.innerText(),/Search knowledge: denied/)
   assert.match(await receipt.innerText(),/Search knowledge: timed out/)
   assert.equal(await receipt.locator('pre').count(),0,'receipts present results rather than raw evaluator objects')
   assert.doesNotMatch(await receipt.innerText(),/response_digest|harness_failures|must_not_include_per_reply/)
   await activate(button('Check release'),()=>version===1?page.getByText('Simulation qualified. Production rollout remains unavailable.').waitFor():page.getByRole('alert').filter({hasText:'Release refused'}).waitFor());await visibleResult()
   if(version===2)for(const width of [1440]){
    await page.setViewportSize({width,height:1000})
    await page.screenshot({path:shot(`procedures-v${version}-${width}.png`),fullPage:true})
   }
   await page.setViewportSize({width:1440,height:1000})
  }

  // Review a saved change, then revise the older definition without changing its cases or receipts.
  const original=versions.find(item=>item.version===1),revised=versions.find(item=>item.version===2)
  const comparison=page.getByRole('table',{name:'refund: Version 1 compared with selected Version 2',exact:true})
  const instructionChange=comparison.getByRole('row').filter({has:page.getByRole('rowheader',{name:'Instructions Changed',exact:true})})
  await instructionChange.waitFor()
  assert.deepEqual(await instructionChange.getByRole('cell').evaluateAll(cells=>cells.map(cell=>cell.innerText.trim())),[original.definition.instructions,revised.definition.instructions])
  await comparison.getByRole('rowheader',{name:'Human escalation Changed',exact:true}).waitFor()
  await comparison.getByRole('rowheader',{name:'Read-only sandbox tools Unchanged',exact:true}).waitFor()
  await page.getByLabel('Compare with',{exact:true}).selectOption('')
  await page.getByRole('table',{name:'refund: saved Version 2',exact:true}).waitFor()
  await page.getByLabel('Compare with',{exact:true}).selectOption(original.id)
  await activate(button('refund · Version 1'),()=>page.getByRole('heading',{name:'Version 1 definition',exact:true}).waitFor())
  await page.getByLabel('Instructions',{exact:true}).fill('Unsaved work that must not be replaced silently')
  page.once('dialog',dialog=>dialog.dismiss())
  await button('Draft from this version').click()
  assert.equal(await page.getByLabel('Instructions',{exact:true}).inputValue(),'Unsaved work that must not be replaced silently')
  page.once('dialog',dialog=>dialog.accept())
  await button('Draft from this version').click()
  await page.waitForFunction(()=>document.activeElement?.id==='procedure-instructions')
  assert.equal(await page.getByLabel('Instructions',{exact:true}).inputValue(),original.definition.instructions)
  await page.getByLabel('Instructions',{exact:true}).fill('Revised synthetic policy: read the policy and ask a human to approve.')
  const revisionInstructions=await page.getByLabel('Instructions',{exact:true}).inputValue()
  await activate(save,()=>button('refund · Version 3').waitFor())
  const savedVersions=(await (await context.request.get(runtime.origin+root)).json()).versions
  const saved=savedVersions.find(item=>item.version===3)
  assert.deepEqual(saved.definition,{...original.definition,basedOnVersionId:original.id,instructions:revisionInstructions},'a revision retains its source cases, tools and budgets through the public save door')
  assert.deepEqual(savedVersions.find(item=>item.id===original.id),original,'the source snapshot remains unchanged')
  await activate(button('refund · Version 3'),()=>page.getByRole('heading',{name:'Version 3 definition',exact:true}).waitFor())
  assert.equal(await page.locator('.procedure-run').count(),0,'a revision never inherits qualification from its source')
  await page.reload()
  await activate(button('refund · Version 3'),()=>page.getByRole('heading',{name:'Version 3 definition',exact:true}).waitFor())
  await page.getByText('Based on refund · Version 1.',{exact:true}).waitFor()
  await page.getByLabel('Compare with',{exact:true}).selectOption(original.id)
  await page.getByRole('table',{name:'refund: Version 1 compared with selected Version 3',exact:true}).getByRole('rowheader',{name:'Instructions Changed',exact:true}).waitFor()

  // A configuration refusal stops one attempt; untouched cases are not failures.
  await page.getByLabel('Procedure key',{exact:true}).fill('configuration')
  await page.getByLabel('Model',{exact:true}).fill('synthetic-hh-unconfigured-model')
  await activate(save,()=>button('configuration · Version 1').waitFor())
  await activate(button('configuration · Version 1'),()=>button('Run synthetic simulation').waitFor())
  await activate(button('Run synthetic simulation'),()=>page.getByText('Simulation queued. Refresh receipts to inspect its outcome.').waitFor())
  const configVersions=await (await context.request.get(runtime.origin+root)).json(),configVersion=configVersions.versions.find(item=>item.procedure_key==='configuration')
  let configRun
  for(let index=0;index<60;index++){
   configRun=(await (await context.request.get(runtime.origin+`${root}/configuration/versions/${configVersion.id}/simulations`)).json()).runs[0]
   if(configRun?.status==='uncertain')break
   await page.waitForTimeout(500)
  }
  assert.equal(configRun.status,'uncertain')
  await activate(button('Refresh receipts'),()=>button('Inspect cases').waitFor())
  await activate(button('Inspect cases'),()=>page.getByLabel('AI provider setup').waitFor())
  const uncertain=page.getByLabel('Simulation receipt')
  assert.equal(await uncertain.getByText('Not run',{exact:true}).count(),3)
  assert.equal(await uncertain.getByText('No sandbox read',{exact:true}).count(),4)
  assert.equal(await uncertain.locator('pre').count(),0)
  assert.doesNotMatch(await uncertain.innerText(),/CONFIGURATION_REQUIRED|TRAINING_PRICE_CEILINGS|\bnull\b/)
  await uncertain.getByText(/This attempt will not be replayed automatically/).waitFor()

  for(const [key,instructions] of [['provider','synthetic-hh-provider-error'],['unread','synthetic-hh-no-read']]){
   const created=await context.request.post(runtime.origin+`${root}/${key}/versions`,{data:{...procedureDefinition(),instructions}})
   assert.equal(created.status(),201)
   const version=await created.json(),base=`${root}/${key}/versions/${version.id}`
   const queued=await context.request.post(runtime.origin+`${base}/simulations`,{data:{}});assert.equal(queued.status(),201)
   let run
   for(let index=0;index<60;index++){
    run=(await (await context.request.get(runtime.origin+`${base}/simulations`)).json()).runs[0]
    if(['completed','uncertain'].includes(run?.status))break
    await page.waitForTimeout(500)
   }
   assert.equal(run.status,key==='provider'?'uncertain':'completed')
   await activate(button('Refresh versions'),()=>button(`${key} · Version 1`).waitFor())
   await activate(button(`${key} · Version 1`),()=>button('Inspect cases').waitFor())
   await activate(button('Inspect cases'),()=>page.getByLabel('Simulation receipt').waitFor())
   const cases=page.getByLabel('Simulation receipt')
   assert.equal(await cases.getByText('No sandbox read',{exact:true}).count(),4)
   assert.doesNotMatch(await cases.innerText(),/OpenAI streaming error|server_error|must_include_any_per_reply|required_sandbox_read|\bnull\b/)
   if(key==='provider'){
    assert.equal(await cases.getByText('Not run',{exact:true}).count(),3)
    await cases.getByText(/This attempt will not be replayed automatically/).waitFor()
   }else assert.equal(await cases.getByText('Did not read the sandbox as required.',{exact:true}).count(),4)
  }

  for(const role of ['operator','admin']){
   await runtime.execute(`UPDATE memberships SET role='${role}' WHERE user_id='${userId}'; UPDATE sessions SET role='${role}' WHERE actor_id='${userId}';${role==='admin'?`INSERT INTO project_roles(id,project_id,name,base,permissions_json,created_at,updated_at) VALUES('synthetic-hh-procedure-admin','${projectId}','Synthetic narrowed admin','admin','[]',1,1); INSERT INTO member_roles(project_id,user_id,role_key,assigned_at) VALUES('${projectId}','${userId}','synthetic-hh-procedure-admin',1);`:''}`)
   await page.goto(url);await page.getByRole('alert').waitFor()
   assert.equal(await page.locator('.workspace-page-content form').count(),0,'a denied role sees no form it can never save')
   assert.equal(await page.locator('.workspace-page-content input').count(),0)
   assert.equal(await page.locator('.workspace-page-content button').count(),0)
  }
  assert.deepEqual(errors,[])
 }finally{for(const held of holds){held.release();await held.deliveryDone.catch(()=>{});await held.close()}await context.close()}
}
