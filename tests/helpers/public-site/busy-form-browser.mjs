import assert from 'node:assert/strict'
import {join,resolve} from 'node:path'
import {startApp} from '../../journeys/kit/app.mjs'

// Called by the public browser journey, without another registration. The kit application over HTTP, so a request can
// meet D1's overload (x-test-fault): requests enter the Worker entry's doors in order (x-test-door), built files are
// served from the build output as the Worker's asset binding would, and the mail provider is the only fake.
// A page load refused throughout shows the busy page and loads itself again; a native form post refused once keeps what
// was typed, and sending it again lands like a calm post.
export async function busyFormBrowser({browser,shot}){
 const client=resolve('dist/client'),sent=[]
 const app=await startApp({listen:true,bindings:{APP_ORIGIN:'http://127.0.0.1',EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'synthetic-provider-key',EMAIL_FROM:'support@example.test'},outbound:async request=>{
  if(request.url==='https://api.resend.com/emails'){sent.push(await request.json());return Response.json({id:'synthetic-busy-mail'})}
  if(request.url.startsWith('https://cloudflare-dns.com/'))return Response.json({Status:0,Answer:[{type:15,data:'10 mx.example.test.'}]})
  throw Error('Unexpected provider request '+request.url)
 }})
 const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage()
 page.setDefaultTimeout(20000)
 const errors=[];page.on('pageerror',error=>errors.push(error.message))
 try{
  const w=await app.seedWorkspace('busy-browser',{allowedOrigin:app.url}),p=w.projectId
  await app.ok(`/api/knowledge/${p}/articles`,{token:w.tokens.owner,body:{slug:'busy-guide',title:'Busy guide',summary:'busy guide',content:'Instructions.',status:'published'}})
  let refuse=null
  // Every request enters the Worker entry's doors (an extra header, so a followed redirect carries it too); the next
  // request `refuse` picks meets D1's overload throughout.
  await context.setExtraHTTPHeaders({'x-test-door':'public'})
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url())
   if(url.pathname.startsWith('/site-assets/')||url.pathname.startsWith('/homepage/'))return route.fulfill({path:join(client,decodeURIComponent(url.pathname))}).catch(()=>route.fulfill({status:404}))
   if(!refuse||!refuse(request))return route.continue()
   refuse=null
   return route.continue({headers:{...request.headers(),'x-test-fault':'d1-overloaded'}})
  })
  const capture=async name=>{for(const width of [1440,390]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${name} fits ${width}`);await page.screenshot({path:shot(`busy-${name}-${width}.png`),fullPage:true})}await page.setViewportSize({width:1440,height:900})}
  const article=`${app.url}/help/${p}/busy-guide`
  // A page load refused throughout: the busy page, which loads the article by itself once D1 answers.
  refuse=request=>request.isNavigationRequest()&&request.method()==='GET'
  const busy=await page.goto(article)
  assert.equal(busy.status(),503);assert.match(busy.headers()['content-type'],/^text\/html/)
  await page.getByRole('heading',{name:'This page is busy right now',exact:true}).waitFor()
  await capture('page')
  await page.getByRole('heading',{name:'Busy guide',exact:true}).waitFor({timeout:15000})
  assert.equal(page.url(),article,'the busy page loaded the same address again by itself')
  // "Was this helpful?": the post refused once keeps the comment and the answer; sending it again records one vote.
  const comment='The second step "Save" is <missing> on my screen'
  await page.getByLabel('Tell us more (optional)',{exact:true}).fill(comment)
  refuse=request=>request.method()==='POST'
  const refused=page.waitForResponse(response=>response.request().method()==='POST')
  await page.getByRole('button',{name:'No',exact:true}).click()
  assert.equal((await refused).status(),503)
  await page.getByRole('heading',{name:'We couldn’t send this yet',exact:true}).waitFor()
  assert.equal(await page.getByLabel('Comment',{exact:true}).inputValue(),comment,'the typed comment is kept')
  assert.match(await page.locator('.help-center-busy-choice').innerText(),/Was this helpful\? No/)
  assert.equal(await page.locator('meta[http-equiv="refresh"]').count(),0,'the form page never posts by itself')
  assert.equal(await app.first('SELECT count(*) AS n FROM knowledge_feedback WHERE project_id=?',p).then(row=>row.n),0,'the refused post recorded nothing')
  await capture('form')
  await page.getByRole('button',{name:'Send again',exact:true}).click()
  await page.getByText('Thank you for your feedback.',{exact:true}).waitFor()
  assert.equal(new URL(page.url()).searchParams.get('feedback'),'1')
  const vote=await app.first('SELECT helpful,comment FROM knowledge_feedback WHERE project_id=?',p)
  assert.deepEqual({...vote},{helpful:0,comment},'the vote sent again is the one typed, recorded once')
  // Portal sign-in (same-origin proof required): refused once, the address is kept and sending it again emails the link.
  await page.goto(`${app.url}/portal/${p}`)
  await page.getByLabel('Email address',{exact:true}).fill('busy-reader@example.test')
  refuse=request=>request.method()==='POST'
  await page.getByRole('button',{name:'Email a sign-in link',exact:true}).click()
  await page.getByRole('heading',{name:'We couldn’t send this yet',exact:true}).waitFor()
  assert.equal(await page.getByLabel('Email address',{exact:true}).inputValue(),'busy-reader@example.test')
  assert.equal(sent.length,0,'the refused sign-in sent nothing')
  await page.getByRole('button',{name:'Send again',exact:true}).click()
  await page.getByText('If delivery is available, a sign-in link is on its way.',{exact:false}).waitFor()
  assert.deepEqual(sent.map(message=>[].concat(message.to)).flat(),['busy-reader@example.test'],'one sign-in link, sent once')
  // A forged sign-in posted from another site, refused by the overload before the route's same-origin check: the busy page
  // without a form and without any posted field, so nothing can be sent again from this site; it records nothing.
  const forged='forged-reader@example.test'
  await context.route('http://busy-cross-site.test/**',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><title>Other site</title><form method="post" action="${app.url}/api/portal/${p}/access/request"><input name="email" value="${forged}"><input name="returnTo" value="/portal/${p}/preferences"><button>Go</button></form>`}))
  await page.goto('http://busy-cross-site.test/forged')
  refuse=request=>request.method()==='POST'
  const crossSite=page.waitForResponse(response=>response.request().method()==='POST')
  await page.getByRole('button',{name:'Go',exact:true}).click()
  const crossSiteAnswer=await crossSite
  assert.equal(crossSiteAnswer.status(),503);assert.match(crossSiteAnswer.headers()['content-type'],/^text\/html/)
  assert.equal(crossSiteAnswer.request().headers()['origin'],'http://busy-cross-site.test','the post was cross-site')
  await page.getByRole('heading',{name:'We couldn’t send this yet',exact:true}).waitFor()
  await page.getByText('Go back to the form and send it again in a few seconds.',{exact:false}).waitFor()
  assert.equal(await page.locator('form').count(),0,'no form to send again')
  assert.equal(await page.getByRole('button',{name:'Send again',exact:true}).count(),0)
  assert.ok(!(await crossSiteAnswer.text()).includes(forged),'no posted field comes back')
  assert.equal(await page.locator('meta[http-equiv="refresh"]').count(),0,'the busy page never posts by itself')
  assert.equal(await app.first('SELECT count(*) AS n FROM portal_links WHERE project_id=? AND email=?',p,forged).then(row=>row.n),0,'the forged post recorded nothing')
  assert.equal(sent.length,1,'the forged post sent nothing')
  await capture('cross-site')
  assert.deepEqual(errors,[])
 }finally{await context.close();await app.close()}
}
