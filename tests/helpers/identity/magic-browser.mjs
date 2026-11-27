import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {auditPage,viewports} from '../../journeys/kit/browser.mjs'

export async function magicSignIn({runtime,browser,origin,tenant,shot}){
 const context=await browser.newContext({viewport:viewports.desktop}),page=await context.newPage()
 page.setDefaultTimeout(20000)
 const destination=`/projects/${tenant.projectId}/contacts?visitors=show`
 const protectedDocument=await context.request.get(origin+destination,{maxRedirects:0})
 assert.equal(protectedDocument.status(),307)
 const login=new URL(protectedDocument.headers().location,origin)
 assert.equal(login.pathname,'/login')
 assert.equal(login.searchParams.get('returnTo'),destination)
 await page.goto(origin+destination)
 await page.getByRole('link',{name:'Email me a sign-in link',exact:true}).click()
 await page.getByLabel('Email',{exact:true}).fill('unknown@security.example.test')
 const requested=page.waitForResponse(r=>r.url().endsWith('/api/identity/magic-link')&&r.request().method()==='POST')
 await page.getByRole('button',{name:'Email me a sign-in link',exact:true}).click()
 assert.equal((await requested).status(),202)
 await page.getByRole('status').filter({hasText:'If this address belongs to a HappyToHelp account'}).waitFor()
 // Request the owner's actual invitation and read it at the fake mail edge.
 await page.getByLabel('Email',{exact:true}).fill('casey@lantern.test')
 const delivered=page.waitForResponse(r=>r.url().endsWith('/api/identity/magic-link')&&r.request().method()==='POST')
 await page.getByRole('button',{name:'Email me a sign-in link',exact:true}).click()
 assert.equal((await delivered).status(),202)
 let link;const deadline=Date.now()+10000
 while(!link&&Date.now()<deadline){
  const messages=await readFile(join(runtime.directory,'mail.jsonl'),'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error})
  const mail=messages.trim().split('\n').filter(Boolean).map(JSON.parse).find(message=>message.to.includes('casey@lantern.test')&&message.text.includes('/login/magic'))
  if(mail)link=mail.text.match(/https?:\/\/[^\s]+\/login\/magic[^\s]*/)[0]
  else await new Promise(done=>setTimeout(done,100))
 }
 assert.ok(link,'the owner receives the actual single-use sign-in link')
 assert.equal((await context.request.get(link)).status(),200)
 assert.equal((await context.request.get(origin+'/api/identity/session')).status(),401,'scanner GET creates no session')
 await page.goto(link)
 await page.getByRole('button',{name:'Sign in',exact:true}).waitFor()
 assert.equal((await context.request.get(origin+'/api/identity/session')).status(),401,'opening the link does not consume it')
 await page.getByRole('button',{name:'Sign in',exact:true}).click()
 await page.waitForURL(url=>url.pathname+url.search===destination)
 assert.equal((await context.request.get(origin+'/api/identity/session')).status(),200)
 await auditPage(page,shot('magic-signed-in.png'))
 const replay=await browser.newContext({viewport:viewports.desktop})
 try{
  const repeated=await replay.newPage();await repeated.goto(link)
  await repeated.getByRole('button',{name:'Sign in',exact:true}).click()
  await repeated.getByRole('alert').filter({hasText:'invalid, expired or already used'}).waitFor()
  assert.equal((await replay.request.get(origin+'/api/identity/session')).status(),401)
 }finally{await replay.close()}
 return page
}

// The invited teammate uses the emitted Worker, real password/session and inbox. Mail alone is suppressed.
// Assertions run at 1440; the optional candidate proof captures these same screens at 390 too.
export async function invitationJoinBrowser(browser){
 const {createRuntime}=await import('../emitted-runtime.mjs')
 const {createServer}=await import('node:net')
 const {evidence}=await import('../../journeys/kit/browser.mjs')
 const reservation=createServer();await new Promise(done=>reservation.listen(0,'127.0.0.1',done))
 const port=reservation.address().port;await new Promise(done=>reservation.close(done))
 const origin=`http://127.0.0.1:${port}`
 const runtime=await createRuntime({port,vars:{H2H_LOCAL:'true',EMAIL_PROVIDER:'development',EMAIL_FROM:'support@example.test',APP_ORIGIN:origin}})
 const shot=await evidence('teammate-invitation'),context=await browser.newContext({viewport:viewports.desktop}),page=await context.newPage(),errors=[]
 page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message))
 let passed=false
 const capture=async name=>{
  await page.screenshot({path:shot(`${name}-1440.png`),fullPage:true})
  if(process.env.H2H_D20_PROOF==='1'){
   await page.setViewportSize(viewports.mobile)
   await page.screenshot({path:shot(`${name}-390.png`),fullPage:true})
   await page.setViewportSize(viewports.desktop)
  }
 }
 try{
  const ownerResponse=await context.request.post(origin+'/api/identity/bootstrap',{data:{email:'synthetic-d20-owner@example.test',password:'synthetic-d20-owner-password',name:'ChargeDesk',ownerName:'Your owner',allowedOrigin:origin}})
  assert.equal(ownerResponse.status(),201)
  const owner=await ownerResponse.json()
  // Use a separate request context for owner authority; the teammate's browser starts signed out.
  await context.clearCookies()
  const invitation=await fetch(origin+`/api/management/projects/${owner.projectId}/agents`,{method:'POST',headers:{Authorization:'Bearer '+owner.token,'Content-Type':'application/json'},body:JSON.stringify({email:'synthetic-d20-teammate@example.test',role:'operator'})})
  assert.equal(invitation.status,201)
  const link=(await invitation.json()).data.invitationUrl
  await page.goto(link)
  await page.getByRole('button',{name:'Create account and join',exact:true}).waitFor()
  assert.equal((await context.request.get(origin+'/api/identity/session')).status(),401,'reading the invitation does not sign in')
  await page.getByLabel('Your name',{exact:true}).fill('Your teammate')
  await page.getByLabel('Password',{exact:true}).fill('synthetic-d20-teammate-password')
  await capture('accept-invitation')
  await page.getByRole('button',{name:'Create account and join',exact:true}).click()
  await page.waitForURL(url=>url.pathname===`/projects/${owner.projectId}/conversations`)
  await page.getByRole('button',{name:'Account menu',exact:true}).waitFor()
  const actor=await context.request.get(origin+'/api/identity/session');assert.equal(actor.status(),200)
  const joined=await actor.json();assert.equal(joined.projectId,owner.projectId);assert.equal(joined.role,'operator');assert.notEqual(joined.id,owner.userId)
  assert.equal((await context.request.get(origin+'/api/conversations')).status(),200,'the new session reads the inbox')
  await capture('inbox-after-password')
  // Sign out through the actual teammate menu, then inspect the ordinary sign-in doors.
  await page.getByRole('button',{name:'Account menu',exact:true}).click()
  await page.getByRole('button',{name:'Sign out',exact:true}).click()
  await page.waitForURL(url=>url.pathname==='/login')
  assert.equal((await context.request.get(origin+'/api/identity/session')).status(),401)
  assert.equal((await context.request.get(origin+'/api/identity/sign-in-options')).status(),200)
  const auth=await (await context.request.get(origin+'/api/identity/auth-options')).json()
  assert.notEqual(auth.localOwnerEntry,true,'the teammate has no local-owner custody')
  const mail=await (await context.request.get(origin+'/api/identity/sign-in-options')).json()
  assert.equal(mail.mailMode,'local','the proof reproduces the local trial where the misleading message appeared')
  await page.getByLabel('Email',{exact:true}).fill('synthetic-d20-teammate@example.test')
  await capture('teammate-sign-in')
  // No source-literal assertion: the teammate has no installer/local-owner door or instructions.
  assert.equal(await page.getByRole('link',{name:/local owner/i}).count(),0)
  const mailOptions=page.waitForResponse(response=>response.url()===origin+'/api/identity/sign-in-options')
  await page.goto(origin+'/login/magic')
  await mailOptions
  await page.getByRole('heading',{name:'Email sign-in',exact:true}).waitFor()
  await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))))
  await page.getByRole('link',{name:'Use your password',exact:true}).waitFor()
  await capture('teammate-email-sign-in')
  // Returning to the invitation in a signed-out browser cannot grant a second session.
  const reused=await context.request.post(origin+'/api/identity/accept-token',{data:{token:new URL(link).searchParams.get('token'),name:'Your teammate',password:'synthetic-d20-teammate-password'}})
  assert.equal(reused.status(),400);assert.equal(reused.headers()['set-cookie'],undefined)
  assert.equal((await context.request.get(origin+'/api/identity/session')).status(),401)
  const fallbackEmail='synthetic-d20-fallback@example.test',fallbackPassword='synthetic-d20-fallback-password'
  const fallbackInvite=await fetch(origin+`/api/management/projects/${owner.projectId}/agents`,{method:'POST',headers:{Authorization:'Bearer '+owner.token,'Content-Type':'application/json'},body:JSON.stringify({email:fallbackEmail,role:'operator'})})
  assert.equal(fallbackInvite.status,201)
  const fallbackLink=(await fallbackInvite.json()).data.invitationUrl
  await runtime.execute("CREATE TRIGGER test_invite_session_refusal BEFORE INSERT ON sessions WHEN (SELECT name FROM users WHERE id=NEW.actor_id)='Fallback teammate' BEGIN SELECT RAISE(ABORT,'synthetic session write refusal'); END")
  await page.goto(fallbackLink)
  await page.getByLabel('Your name',{exact:true}).fill('Fallback teammate')
  await page.getByLabel('Password',{exact:true}).fill(fallbackPassword)
  const fallbackResponse=page.waitForResponse(response=>response.url()===origin+'/api/identity/accept-token'&&response.request().method()==='POST')
  await page.getByRole('button',{name:'Create account and join',exact:true}).click()
  const accepted=await fallbackResponse
  assert.equal(accepted.status(),200)
  assert.equal(accepted.headers()['set-cookie'],undefined)
  const result=await accepted.json()
  assert.equal(result.accepted,true)
  assert.equal(result.loginRequired,true)
  assert.equal((await context.request.get(origin+'/api/identity/session')).status(),401)
  await runtime.execute('DROP TRIGGER test_invite_session_refusal')
  await page.getByRole('link',{name:'Sign in',exact:true}).click()
  await page.waitForURL(url=>url.pathname==='/login')
  assert.equal(await page.getByLabel('Email',{exact:true}).inputValue(),fallbackEmail)
  assert.equal(new URL(page.url()).searchParams.get('returnTo'),`/projects/${owner.projectId}/conversations`)
  await page.getByLabel('Password',{exact:true}).fill(fallbackPassword)
  await page.getByRole('button',{name:'Login',exact:true}).click()
  await page.waitForURL(url=>url.pathname===`/projects/${owner.projectId}/conversations`)
  assert.equal((await context.request.get(origin+'/api/conversations')).status(),200)
  assert.deepEqual(errors,[]);passed=true
 }finally{await context.close();await runtime.close(passed)}
}
