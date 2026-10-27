import test,{before,after} from 'node:test'
import assert from 'node:assert/strict'
import {randomBytes,createHash} from 'node:crypto'
import {writeFile} from 'node:fs/promises'
import {createRuntime} from '../helpers/emitted-runtime.mjs'
import {createKit} from '../helpers/identity-browser-kit.mjs'
import {checkAfterSetup,checkForgotPasswordWithoutEmail,checkFreshInstall,checkInvitationAcceptance,checkLinkProblems,createOwner} from '../helpers/identity-browser-default.mjs'
import {checkPendingInvitationsWithEmail,checkPendingInvitationsWithoutEmail} from '../helpers/identity-browser-invitations.mjs'
import {checkForgotPasswordWithEmail,checkRegistrationBeforeSetup,checkRegistrationOpen,checkResetPassword,checkVerifyEmail} from '../helpers/identity-browser-email.mjs'
import {launchBrowser,viewports,evidence} from './kit/browser.mjs'
import {emailStepUpBrowserJourney} from '../helpers/identity/email-step-up-browser.mjs'
import {securityBrowserJourney} from '../helpers/identity/security-browser.mjs'

let browser
before(async()=>{browser=await launchBrowser()})
after(async()=>{await browser?.close()})

async function withRuntime(options,work){const runtime=await createRuntime(options);let passed=false;try{await work(runtime);passed=true}finally{await runtime.close(passed)}}
async function identityKit(name){const shot=await evidence('identity/'+name),errors=[];return {errors,kit:createKit({browser,evidenceDir:shot(''),errors})}}

test('a default deployment: fresh-install pages, closed sign-up, plain link problems, invitation acceptance, safe sign-in return and pending invitations without mail',async()=>{
 const {kit,errors}=await identityKit('default')
 await withRuntime({},async runtime=>{
  const context={origin:runtime.origin,kit,runtime}
  await checkFreshInstall(context);await checkForgotPasswordWithoutEmail(context)
  const owner=await createOwner(context)
  await checkAfterSetup(context);await checkLinkProblems(context)
  const {operator}=await checkInvitationAcceptance(context,owner)
  const operatorLogin=await kit.api(runtime.origin,'/api/identity/login',{body:{...operator,projectId:owner.projectId}})
  await checkPendingInvitationsWithoutEmail(context,owner,{token:operatorLogin.json.token})
  // The no-script sign-in form resumes only internal dashboard and invitation destinations.
  const formLogin=async returnTo=>{const response=await fetch(runtime.origin+'/login'+(returnTo===undefined?'':'?returnTo='+encodeURIComponent(returnTo)),{method:'POST',redirect:'manual',headers:{Origin:runtime.origin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({email:owner.email,password:owner.password})});assert.equal(response.status,303,String(returnTo));return response.headers.get('Location')}
  const deep=`/projects/${owner.projectId}/conversations/c1?q=follow%20up&view=active#message`
  assert.equal(await formLogin(deep),deep);assert.equal(await formLogin('/accept-invitation?token=abc123'),'/accept-invitation?token=abc123')
  for(const target of [undefined,'https://evil.example','//evil.example','/\\evil.example','/%5cevil.example','/conversations%0a','/projects/abc/../../login','/login','/api/identity/session','javascript:alert(1)','/accept-invitation/extra','https://evil.example/accept-invitation?token=1','/verify-email?token=1'])assert.equal(await formLogin(target),'/conversations',String(target))
  const crossSite=await fetch(runtime.origin+'/login',{method:'POST',redirect:'manual',headers:{Origin:'https://evil.example','Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({email:owner.email,password:owner.password})});assert.equal(crossSite.status,403)
 })
 assert.deepEqual(errors,[],'no page or console errors')
})

test('with sign-up and mail configured: registration waits for setup, then registration, recovery, reset, email verification and pending invitations work with no mail sent',async()=>{
 const {kit,errors}=await identityKit('email')
 await withRuntime({vars:{REGISTRATION_ENABLED:'true',EMAIL_API_KEY:'fixture-key-never-sent',EMAIL_FROM:'HappyToHelp <support@example.test>',APP_ORIGIN:'http://localhost',INTEGRATION_ENCRYPTION_KEY:randomBytes(32).toString('base64')},outboundFixture:new URL('../helpers/notification-mail-fixture.mjs',import.meta.url).href},async runtime=>{
  const context={origin:runtime.origin,kit,runtime}
  await checkRegistrationBeforeSetup(context)
  const created=await kit.api(runtime.origin,'/api/identity/bootstrap',{body:{name:'Lantern Works',ownerName:'Casey Owner',email:'casey@review.test',password:'lantern-owner-pass-1',allowedOrigin:'https://lantern.example'}});assert.equal(created.status,201,created.text)
  const owner={projectId:created.json.projectId,token:created.json.token}
  await checkRegistrationOpen(context);await checkForgotPasswordWithEmail(context);await checkResetPassword(context,owner);await checkVerifyEmail(context);await checkPendingInvitationsWithEmail(context,owner)
 })
 assert.deepEqual(errors,[],'no page or console errors')
})

// A magic link: neutral request receipt, a scanner-safe GET, one explicit POST into a session, and replay refused.
const name='desktop',viewport=viewports.desktop
test(`magic sign-in in a ${viewport.width}px browser: neutral request, scanner-safe link, one explicit sign-in and refused replay`,async()=>{
 const shot=await evidence('magic-link')
 await withRuntime({vars:{APP_ORIGIN:'http://127.0.0.1',EMAIL_PROVIDER:'sendgrid',EMAIL_API_KEY:'test-never-sent',EMAIL_FROM:'support@example.test'}},async runtime=>{
  const tenant=await runtime.seedTenant({name:'Magic browser',email:'owner@magic-browser.test',allowedOrigin:runtime.origin})
  const context=await browser.newContext({viewport}),page=await context.newPage(),posts=[];page.setDefaultTimeout(15000)
  try{
   page.on('request',request=>{if(request.method()==='POST')posts.push(new URL(request.url()).pathname)})
   await page.goto(runtime.origin+'/login');await page.getByRole('link',{name:'Email me a sign-in link'}).click();await page.getByLabel('Email',{exact:true}).fill(`unknown-${viewport.width}@magic-browser.test`)
   const response=page.waitForResponse(r=>r.url().endsWith('/api/identity/magic-link')&&r.request().method()==='POST');await page.getByRole('button',{name:'Email me a sign-in link',exact:true}).click();assert.equal((await response).status(),202)
   await page.getByRole('status').filter({hasText:'If this address belongs to a HappyToHelp account'}).waitFor();await page.screenshot({path:shot(name+'-request.png'),fullPage:true})
   const token=randomBytes(32).toString('hex'),hash=createHash('sha256').update(token).digest('hex')
   await runtime.execute(`INSERT INTO magic_signins VALUES('${hash}','${tenant.userId}','${tenant.projectId}','owner@magic-browser.test',${Date.now()+60000},NULL)`)
   const link=runtime.origin+'/login/magic#token='+token
   assert.equal((await context.request.get(link)).status(),200);assert.equal((await context.request.get(runtime.origin+'/api/identity/session')).status(),401,'a link scanner GET signs nobody in')
   const before=posts.length;await page.goto(link);await page.getByRole('button',{name:'Sign in',exact:true}).waitFor();await page.waitForFunction(()=>location.hash==='')
   assert.equal(posts.length,before,'opening the link does not consume it');assert.equal((await context.request.get(runtime.origin+'/api/identity/session')).status(),401)
   await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL(url=>url.pathname===`/projects/${tenant.projectId}/activation`)
   const session=await context.request.get(runtime.origin+'/api/identity/session');assert.equal(session.status(),200);assert.equal((await session.json()).id,tenant.userId)
   const cookie=(await context.cookies()).find(c=>c.name==='h2h_session');assert.ok(cookie.httpOnly);assert.equal(cookie.sameSite,'Lax')
   assert.equal(posts.filter(p=>p==='/api/identity/magic-link/consume').length,1);await page.screenshot({path:shot(name+'-signed-in.png'),fullPage:true})
   const replay=await browser.newContext({viewport}),replayPage=await replay.newPage()
   try{await replayPage.goto(link);await replayPage.getByRole('button',{name:'Sign in',exact:true}).click();await replayPage.getByRole('alert').filter({hasText:'invalid, expired or already used'}).waitFor();assert.equal((await replay.request.get(runtime.origin+'/api/identity/session')).status(),401);await replayPage.screenshot({path:shot(name+'-replay-denied.png'),fullPage:true})}finally{await replay.close()}
   await writeFile(shot(name+'-proof.json'),JSON.stringify({viewport,requestStatus:202,explicitConsumePosts:1,actorId:tenant.userId,replayDenied:true},null,2))
  }finally{await context.close()}
 })
})

test('account security in a 1440 and 390px browser: an authenticator app and a passkey, two-factor sign-in, the step-up dialog on an export, Settings → Security, Security log and Roles, a collaborator\'s notes-only conversation, and scoped native sign-out',{timeout:10*60_000},async()=>{await securityBrowserJourney(browser);await emailStepUpBrowserJourney(browser)})
