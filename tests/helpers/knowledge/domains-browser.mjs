import assert from 'node:assert/strict'
import {createHmac} from 'node:crypto'

// Publish only a deployment-approved address using the actual native settings.
// The local host aliases exercise routing; they do not claim DNS/TLS provisioning.
export async function domainsBrowserJourney({runtime,browser,fixture,viewport,shot}){
 const {origin}=runtime,width=viewport.width,errors=[]
 const call=async(path,{body,method=body===undefined?'GET':'POST',token=fixture.token,status=200}={})=>{
  const response=await fetch(origin+path,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:body===undefined?undefined:JSON.stringify(body)})
  const text=await response.text();assert.equal(response.status,status,path+': '+text.slice(0,300));return text?JSON.parse(text):null
 }
 const publicHost=new URL(origin);publicHost.hostname='localhost'
 const context=await browser.newContext({viewport}),page=await context.newPage()
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept())
 try{
  await context.addCookies([{name:'h2h_session',value:fixture.token,url:origin}])
  await page.goto(`${origin}/projects/${fixture.projectId}/articles`)
  await page.getByRole('button',{name:'Help Center settings',exact:true}).click()
  await page.getByLabel('Help Center address',{exact:true}).selectOption('localhost')
  await page.getByLabel('Article link color',{exact:true}).fill('#ffffff')
  await page.getByRole('button',{name:'Save Help Center settings',exact:true}).click()
  await page.getByRole('alert').filter({hasText:'4.5:1 contrast'}).waitFor()
  await page.getByLabel('Article link color',{exact:true}).fill('#204b3a')
  await page.getByLabel('Available locales',{exact:true}).fill('en\nfr')
  await page.getByRole('button',{name:'Save Help Center settings',exact:true}).click()
  await page.getByText('Saved.',{exact:true}).waitFor()
  assert.equal((await call(`/api/knowledge/${fixture.projectId}/experience`)).publishedHost,'localhost')
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'domain settings fit the viewport')
  await page.screenshot({path:shot(`knowledge-domain-settings-${width}.png`),fullPage:true})
  const logo='/homepage/media/brands/happytohelp-mark.svg'
  await call(`/api/management/projects/${fixture.projectId}/settings`,{method:'PUT',body:{brand_name:'Alpha Help',primary_color:'#204b3a',logo_url:logo}})
  await page.goto(publicHost.href)
  await page.locator('.help-center-brand strong').filter({hasText:'Alpha Help'}).waitFor()
  assert.ok(await page.locator('.help-center-logo').evaluate(img=>img.complete&&img.naturalWidth>0))
  await page.screenshot({path:shot(`knowledge-alpha-host-${width}.png`),fullPage:true})
  // Another help center has its own exact host, logo, color and content.
  const beta=await runtime.seedTenant({name:'Beta Help',email:`beta-help-${width}@example.test`,allowedOrigin:origin})
  await runtime.execute(`DELETE FROM public_project_aliases WHERE slug='second-browser-help'; INSERT INTO public_project_aliases(slug,project_id) VALUES('second-browser-help','${beta.projectId}')`)
  await call(`/api/management/projects/${beta.projectId}/settings`,{token:beta.token,method:'PUT',body:{brand_name:'Beta Help',primary_color:'#513573',logo_url:logo}})
  await call(`/api/knowledge/${beta.projectId}/experience`,{token:beta.token,method:'PUT',body:{defaultLocale:'en',locales:['en'],templates:{article:'Beta article {{title}}\n{{content}}'},publishedHost:'second.localhost',linkColor:'#513573'}})
  await call(`/api/knowledge/${beta.projectId}/articles`,{token:beta.token,status:201,body:{title:'Beta guide',slug:'beta-guide',content:'Guidance only for the Beta brand.',status:'published'}})
  const betaHost=new URL(origin);betaHost.hostname='second.localhost';betaHost.pathname='/beta-guide'
  await page.goto(betaHost.href);await page.getByText('Guidance only for the Beta brand.',{exact:true}).waitFor()
  assert.match(await page.locator('.help-center-content').innerText(),/Beta article Beta guide/)
  assert.equal(await page.locator('.help-center-brand strong').innerText(),'Beta Help')
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1))
  await page.screenshot({path:shot(`knowledge-beta-host-${width}.png`),fullPage:true})
  // Private translations retain the same audience on custom hosts and built-in paths.
  const category=await call(`/api/knowledge/${fixture.projectId}/categories`,{status:201,body:{title:`Private ${width}`,audience:'domains',allowedDomains:['trusted.test']}})
  const article=await call(`/api/knowledge/${fixture.projectId}/articles`,{status:201,body:{title:'Private export guide',slug:`private-export-${width}`,content:'Use the approved export queue.',categoryIds:[category.id],status:'published'}})
  const translation=`/api/knowledge/${fixture.projectId}/articles/${article.id}/translations/fr`
  await call(translation,{method:'PUT',body:{title:'Guide privé',content:'Utilisez la file approuvée.',reviewStatus:'reviewed'}})
  const secret=(await call(`/api/identity/projects/${fixture.projectId}`)).verification_secret
  const session=async email=>call('/api/identity/widget/session',{status:201,body:{widgetKey:(await call(`/api/identity/projects/${fixture.projectId}`)).widget_key,identifier:email,email,contact_hash:createHmac('sha256',secret).update(email).digest('hex')}})
  const member=await session(`member-${width}@trusted.test`),forbidden=await session(`reader-${width}@other.test`)
  const privateUrl=new URL(`/private-export-${width}?locale=fr`,publicHost).href
  for(const [identity,allowed] of [[null,false],[forbidden,false],[member,true]]){
   const reader=await browser.newContext({viewport}),readerPage=await reader.newPage()
   try{
    if(identity)await reader.addCookies([{name:'h2h_session',value:identity.token,url:publicHost.origin}])
    const response=await readerPage.goto(privateUrl);assert.equal(response.status(),allowed?200:404)
    if(allowed){await readerPage.getByText('Utilisez la file approuvée.',{exact:true}).waitFor();await readerPage.screenshot({path:shot(`knowledge-private-translation-${width}.png`),fullPage:true})}
    else assert.doesNotMatch(await readerPage.locator('body').innerText(),/Utilisez la file approuvée/)
   }finally{await reader.close()}
  }
  // An unreviewed replacement cannot displace the approved translation.
  await call(translation,{method:'PUT',body:{title:'Brouillon',content:'Unreviewed private translation.',reviewStatus:'draft'}})
  const reader=await browser.newContext({viewport});await reader.addCookies([{name:'h2h_session',value:member.token,url:publicHost.origin}]);const readerPage=await reader.newPage()
  try{
   await readerPage.goto(privateUrl);await readerPage.getByText('Utilisez la file approuvée.',{exact:true}).waitFor()
   await call(`/api/knowledge/${fixture.projectId}/articles`,{status:201,body:{id:article.id,title:'Private export guide',slug:`private-export-${width}`,content:'Use the newly reviewed export queue.',status:'published'}})
   await readerPage.reload();await readerPage.getByText('Use the newly reviewed export queue.',{exact:true}).waitFor();await readerPage.locator('.help-center-translation-note').waitFor()
   assert.match(await readerPage.locator('.help-center-translation-note').innerText(),/available in en/)
   await readerPage.screenshot({path:shot(`knowledge-source-fallback-${width}.png`),fullPage:true})
  }finally{await reader.close()}
  assert.deepEqual(errors,[])
 }finally{await context.close()}
}
