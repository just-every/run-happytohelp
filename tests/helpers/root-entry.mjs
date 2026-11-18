import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {writeFile} from 'node:fs/promises'
import {createRuntime} from './emitted-runtime.mjs'
import {client} from '../journeys/kit/http.mjs'
import {launchBrowser,viewports,evidence} from '../journeys/kit/browser.mjs'

// One native installation changes state through setup and knowledge's real HTTP doors.
export async function rootEntryJourney(){
 const runtime=await createRuntime({vars:{APP_ORIGIN:'http://127.0.0.1',H2H_LOCAL:'true',EMAIL_PROVIDER:'development',PUBLIC_HELP_HOSTS:JSON.stringify({localhost:'synthetic-happytohelp-help'})}})
 const browser=await launchBrowser(),{request}=client(runtime.origin),shot=await evidence('root-entry'),receipts=[]
 let passed=false
 try{
  const context=await browser.newContext({viewport:viewports.desktop,reducedMotion:'reduce'}),page=await context.newPage()
  const capture=async state=>{
   await page.evaluate(()=>document.fonts.ready)
   for(const width of [1440,390]){await page.setViewportSize({width,height:900});await page.screenshot({path:shot(`${state}-${width}.png`),fullPage:true})}
   await page.setViewportSize(viewports.desktop)
  }
  const visit=async path=>{
   const response=await page.goto(runtime.origin+path)
   assert.equal(response.status(),200,'the destination loads without a redirect loop')
   return new URL(page.url())
  }
  await visit('/')
  assert.ok(await page.locator('.h2h-home').isVisible(),'a first owner retains the installation entry page')
  await capture('unconfigured')
  receipts.push({state:'unconfigured',destination:'/',status:200})

  const bootstrap=await request('/api/identity/bootstrap',{body:{email:'synthetic-happytohelp-1@example.test',password:randomBytes(24).toString('base64url'),name:'Synthetic support',allowedOrigin:runtime.origin}})
  assert.equal(bootstrap.status,201,await bootstrap.clone().text())
  const owner=await bootstrap.json(),token=owner.token
  const signIn=await browser.newContext({viewport:viewports.desktop})
  await signIn.addCookies([{name:'h2h_session',value:token,url:runtime.origin}])
  const member=await signIn.newPage()
  await member.goto(runtime.origin+'/?returnTo=%2Fconversations')
  assert.equal(new URL(member.url()).pathname,'/','a native signed-in owner keeps the existing root behavior')
  assert.ok(await member.locator('.h2h-home').isVisible())
  await signIn.close()

  const rootRedirect=async(query,target)=>{
   const response=await request('/'+query)
   assert.equal(response.status,302,'root uses an ordinary temporary HTTP redirect')
   assert.match(response.headers.get('cache-control')||'',/no-store/)
   assert.match(response.headers.get('vary')||'',/Cookie/)
   assert.equal(response.headers.get('location'),target)
   assert.equal(await response.text(),'','redirect contains no workspace identity as running text')
   const head=await request('/'+query,{method:'HEAD'})
   assert.equal(head.status,302);assert.equal(head.headers.get('location'),target)
   assert.match(head.headers.get('cache-control')||'',/no-store/)
  }
  await rootRedirect('?returnTo=%2Fconversations&locale=fr&ignored=drop','/login?returnTo=%2Fconversations')
  assert.equal((await visit('/')).pathname,'/login')
  assert.ok(await page.getByLabel('Email', {exact:true}).isVisible(),'configured empty installation offers native sign-in')
  assert.equal(await page.locator('.h2h-home').count(),0)
  await capture('configured-signin')
  receipts.push({state:'configured-without-help',destination:'/login',status:302,cacheControl:'no-store'})

  const publish=await request(`/api/knowledge/${owner.projectId}/articles`,{token,body:{slug:'getting-help',title:'Getting help',content:'Contact our support team from this Help Center.',status:'published'}})
  assert.equal(publish.status,201,await publish.clone().text())
  const help=`/help/${owner.projectId}`
  await rootRedirect('?locale=en&returnTo=%2Fconversations&ignored=drop',help+'?locale=en')
  assert.equal((await visit('/')).pathname,help)
  assert.ok(await page.getByRole('link',{name:'Getting help',exact:true}).isVisible(),'a published article is reachable from the company root')
  assert.equal(await page.locator('.h2h-home').count(),0)
  assert.ok(!(await page.locator('body').innerText()).includes(owner.projectId),'workspace identity appears only in its normal URLs')
  await capture('configured-help')
  receipts.push({state:'configured-published',destination:'built-in Help Center',status:302,cacheControl:'no-store'})

  // An explicitly published built-in center remains the root destination even when it has no articles.
  const article=await publish.json()
  assert.equal((await request(`/api/knowledge/${owner.projectId}/articles/${article.id}`,{method:'DELETE',token})).status,200)
  assert.equal((await request(`/api/knowledge/${owner.projectId}/experience`,{method:'PUT',token,body:{defaultLocale:'en',locales:['en'],publishedHost:''}})).status,200)
  await rootRedirect('',help)
  assert.equal((await visit('/')).pathname,help)
  assert.ok(await page.locator('[data-help-center-nav]').isVisible())
  // Returning from a site document uses the same root guard during client navigation.
  await page.goto(runtime.origin+'/docs')
  await page.getByRole('link',{name:'HappyToHelp',exact:true}).first().click()
  await page.waitForURL(runtime.origin+help)
  assert.equal(await page.locator('.h2h-home').count(),0)
  receipts.push({state:'configured-enabled-empty',destination:'built-in Help Center',status:302,clientNavigation:'same destination'})
  await context.close()
  await writeFile(shot('receipt.json'),JSON.stringify({assertionViewport:1440,screenshotWidths:[1440,390],states:receipts,signedInRoot:'unchanged'},null,2)+'\n')
  passed=true
 }finally{await browser.close();await runtime.close(passed)}
}
