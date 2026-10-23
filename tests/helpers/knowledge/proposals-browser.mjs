import assert from 'node:assert/strict'
import {randomUUID,createHmac} from 'node:crypto'
export async function proposalsBrowserJourney({runtime,browser,shot}){
 for(const width of [1440,390]){
  const origin=runtime.origin,tenant=await runtime.seedTenant({name:'Knowledge editorial '+width,email:`editor-${width}@example.test`,allowedOrigin:origin}),pid=tenant.projectId
  const call=async(path,{body,method=body===undefined?'GET':'POST',token=tenant.token,status=200}={})=>{const response=await fetch(origin+path,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:body===undefined?undefined:JSON.stringify(body)});const text=await response.text();assert.equal(response.status,status,path+': '+text.slice(0,250));return text?JSON.parse(text):null}
  const secret='synthetic-happytohelp-42'
  await runtime.execute(`UPDATE projects SET verification_secret='${secret}' WHERE id='${pid}'`)
  const project=await call(`/api/identity/projects/${pid}`),email=`reader-${width}@trusted.test`,customer=await call('/api/identity/widget/session',{status:201,body:{widgetKey:project.widget_key,name:'Avery Synthetic',identifier:email,email,contact_hash:createHmac('sha256',secret).update(email).digest('hex')}})
  const conversation=await call('/api/conversations',{token:customer.token,status:201,body:{projectId:pid}}),messages=`/api/conversations/${conversation.id}/messages`
  await call(messages,{token:customer.token,body:{localId:randomUUID(),content:'My export was broken. How did you repair it?',expectedRevision:0}})
  const transcript=await call(messages,{token:customer.token}),quote=`Avery Synthetic: select UTF-8 export encoding. Contact ${email}; api_key=synthetic-happytohelp-41`
  const answer=(await call(messages,{body:{localId:randomUUID(),content:quote,expectedRevision:transcript.revision,expectedLastMessageId:transcript.lastMessageId}})).message
  await call(`/api/dashboard/projects/${pid}/conversations/${conversation.id}`,{method:'PUT',body:{resolved:true}})
  const state=(await call(`/api/dashboard/projects/${pid}/conversations/${conversation.id}`)).data,cycle=state.resolution
  assert.ok(cycle?.id,'native conversation identifies the resolution cycle')
  await call(`/api/conversations/${conversation.id}/widget-events`,{token:customer.token,body:{action:'rateResolution',data:{resolutionId:cycle.id,value:1}}})
  const category=await call(`/api/knowledge/${pid}/categories`,{status:201,body:{title:'Trusted customer guidance',audience:'domains',allowedDomains:['trusted.test']}})
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[]
  await context.addCookies([{name:'h2h_session',value:tenant.token,url:origin}]);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());page.setDefaultTimeout(20000)
  try{
   await page.goto(`${origin}/projects/${pid}/articles`);await page.getByRole('button',{name:'Review proposals',exact:true}).click();await page.getByRole('button',{name:'Load proposals and gaps',exact:true}).click()
   for(const [label,value] of [['Source conversation ID',conversation.id],['Source resolution cycle ID',cycle.id],['Source message ID',answer.id],['Proposed article title','Export recovery'],['Exact resolution quote',quote]])await page.getByLabel(label,{exact:true}).fill(value)
   await page.getByLabel('Private destination collection',{exact:true}).selectOption(category.id)
   await page.getByRole('button',{name:'Prepare private draft',exact:true}).click();await page.getByText('Private draft prepared.',{exact:false}).waitFor()
   const content=page.getByLabel('Reviewed article content',{exact:true});assert.doesNotMatch(await content.inputValue(),/Avery|reader-|synthetic-happytohelp-41/)
   assert.ok(await page.getByRole('button',{name:'Publish reviewed private guidance',exact:true}).isDisabled())
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'draft review fits the viewport')
   await page.screenshot({path:shot(`knowledge-sourced-draft-${width}.png`),fullPage:true})
   await page.getByLabel('Editorial rejection reason',{exact:true}).fill('Remove identifying details and state only the verified fix.')
   await page.getByRole('button',{name:'Reject draft',exact:true}).click();await page.getByText('Rejection retained for review.',{exact:true}).waitFor()
   await content.fill('Select UTF-8 export encoding and retry the export.')
   await page.getByLabel('Published article slug',{exact:true}).fill('export-recovery')
   await page.getByLabel('I reviewed personal data and the private publication scope',{exact:true}).check()
   await page.getByRole('button',{name:'Publish reviewed private guidance',exact:true}).click();await page.getByText('Edited private guidance published by you.',{exact:true}).waitFor()
   const decisions=await page.locator('[aria-label="Editorial decisions"]').innerText();assert.match(decisions,/rejected/);assert.match(decisions,/approved/)
   await call(`/api/knowledge/public/${pid}/articles/export-recovery`,{token:'',status:404})
   assert.equal((await call(`/api/knowledge/public/${pid}/articles/export-recovery`,{token:customer.token})).content,'Select UTF-8 export encoding and retry the export.')
   await page.screenshot({path:shot(`knowledge-reviewed-publication-${width}.png`),fullPage:true})
   await call(`/api/dashboard/projects/${pid}/conversations/${conversation.id}`,{method:'PUT',body:{resolved:false}})
   await page.getByRole('button',{name:'Load proposals and gaps',exact:true}).click();await page.getByText('A source or cited customer cycle reopened.',{exact:false}).waitFor()
   await page.getByRole('button',{name:'Analyze corrective proposals',exact:true}).click();await page.getByText('Retained corrective proposals: 1.',{exact:true}).waitFor()
   assert.equal((await call(`/api/knowledge/public/${pid}/articles/export-recovery`,{token:customer.token})).content,'Select UTF-8 export encoding and retry the export.')
   await page.screenshot({path:shot(`knowledge-corrective-review-${width}.png`),fullPage:true});assert.deepEqual(errors,[])
  }finally{await context.close()}
 }
}
