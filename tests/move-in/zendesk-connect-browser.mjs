import assert from 'node:assert/strict'

// Only the Zendesk HTTP boundary is faked. The first authorization returns 204
// to keep Move in loaded for a second press; the second reaches the provider page.
export async function zendeskConnectBrowserFlow({page,origin,base,project,shot}){
 const endpoint=`/api/move-in/projects/${project}/zendesk/connect`,provider='https://synthetic-hh-support.zendesk.com',clientId='synthetic-hh-move-in'
 const navigations=[],posts=[],replies=[]
 const authorize=async route=>{
  navigations.push(route.request().url())
  await route.fulfill(navigations.length===1?{status:204}:{status:200,contentType:'text/html',body:'<!doctype html><title>Zendesk authorization</title>'})
 }
 // Read the real app response before releasing it to the navigating browser.
 // Pass it through unchanged; the emitted Worker's Connect route handles the POST.
 const capture=async route=>{
  const request=route.request(),response=await route.fetch()
  posts.push({method:request.method(),body:request.postDataJSON()});replies.push(await response.json())
  await route.fulfill({response})
 }
 await page.route(origin+endpoint,capture)
 await page.route(`${provider}/oauth/authorizations/new?*`,authorize)
 try{
  const subdomain=page.getByRole('textbox',{name:'Zendesk subdomain',exact:true}),identifier=page.getByRole('textbox',{name:'OAuth client Identifier',exact:true}),connect=page.getByRole('button',{name:'Connect',exact:true})
  await subdomain.fill('synthetic-hh-support');await identifier.fill(clientId)
  const loadedAt=await page.evaluate(()=>performance.timeOrigin)
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000})
   await page.locator('[data-zendesk-connection]').screenshot({path:shot(`zendesk-connect-${width}.png`)})
  }
  await page.setViewportSize({width:1440,height:1000})
  for(let press=1;press<=2;press++){
   assert.equal(page.url(),origin+base+'/move-in');assert.equal(await page.evaluate(()=>performance.timeOrigin),loadedAt)
   assert.equal(await subdomain.inputValue(),'synthetic-hh-support');assert.equal(await identifier.inputValue(),clientId)
   const posted=page.waitForResponse(response=>new URL(response.url()).pathname===endpoint&&response.request().method()==='POST')
   const arrived=page.waitForResponse(response=>response.request().isNavigationRequest()&&response.url().startsWith(provider+'/oauth/authorizations/new?'))
   const [response,authorization]=await Promise.all([posted,arrived,connect.click()])
   assert.equal(response.status(),200)
   assert.deepEqual(posts.at(-1),{method:'POST',body:{subdomain:'synthetic-hh-support',clientId}})
   const {url}=replies.at(-1),target=new URL(url)
   assert.equal(target.origin,provider);assert.equal(target.pathname,'/oauth/authorizations/new');assert.equal(target.searchParams.get('client_id'),clientId)
   assert.equal(target.searchParams.get('redirect_uri'),`${origin}/api/move-in/zendesk/callback`)
   assert.equal(authorization.url(),url);assert.equal(authorization.status(),press===1?204:200)
   assert.equal(navigations.length,press);assert.equal(navigations.at(-1),url)
   if(press===2)await page.waitForURL(url)
  }
  assert.equal(posts.length,2)
  console.log('Zendesk Connect: both presses POSTed and navigated to their returned authorize URL from the same page load')
 }finally{
  await page.unroute(origin+endpoint,capture);await page.unroute(`${provider}/oauth/authorizations/new?*`,authorize)
 }
}
