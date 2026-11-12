import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {createRuntime} from '../../helpers/emitted-runtime.mjs'
import {totp} from '../../helpers/identity/two-factor.mjs'
import {loginDestination} from '../../../src/platform/dashboard-path.js'

// Extend the existing identity browser registration through real password and TOTP doors.
export async function legacyMoveInAuthReturn(browser,{width=1440,inspect=async()=>{}}={}){
 const runtime=await createRuntime({vars:{INTEGRATION_ENCRYPTION_KEY:randomBytes(32).toString('base64')}})
 const contexts=[],owner={email:'synthetic-move-in-owner@example.test',password:randomBytes(24).toString('base64url')}
 const continuation='/app/move-in?from=business&note=synthetic%20continuation'
 let passed=false
 try{
  // Keep the existing relative-URL/origin/control-character refusals around the new entry.
  for(const target of ['https://outside.example/app/move-in','//outside.example/app/move-in','/\\outside.example/app/move-in','/%5coutside.example/app/move-in','/app/move-in%0a','/app/move-in?x=%00','/app/move-in?x=%ZZ','/app/move-in/other','/app/other']){
   assert.equal(loginDestination(target,runtime.origin),'/conversations')
   assert.equal(loginDestination(target,runtime.origin,true),'/projects/create')
  }
  assert.equal(loginDestination(continuation,runtime.origin),continuation)
  assert.equal(loginDestination(continuation,runtime.origin,true),continuation)
  const setup=await fetch(runtime.origin+'/api/identity/bootstrap',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...owner,name:'Synthetic Import Owner',allowedOrigin:runtime.origin})})
  assert.equal(setup.status,201)
  const {projectId}=await setup.json(),destination=`/projects/${projectId}/move-in?legacy=1`
  const fresh=async()=>{
   const context=await browser.newContext({viewport:{width,height:1000},bypassCSP:true});contexts.push(context)
   const page=await context.newPage();page.setDefaultTimeout(20000);return page
  }
  const prepareLogin=async page=>{
   await page.goto(runtime.origin+continuation)
   await page.waitForURL(url=>url.pathname==='/login')
   assert.equal(new URL(page.url()).searchParams.get('returnTo'),continuation)
   await page.getByLabel('Email',{exact:true}).fill(owner.email)
   await page.getByLabel('Password',{exact:true}).fill(owner.password)
   await inspect(page,`legacy-login-${width}`)
  }
  const resumed=page=>page.waitForRequest(request=>request.isNavigationRequest()&&request.url()===runtime.origin+continuation)
  const ready=async(page,name)=>{
   await page.waitForURL(url=>url.pathname+url.search===destination)
   await page.getByRole('heading',{name:'HappyToHelp export',exact:true}).waitFor()
   await inspect(page,`${name}-${width}`)
  }
  const passwordPage=await fresh();await prepareLogin(passwordPage)
  const passwordReturn=resumed(passwordPage)
  await passwordPage.getByRole('button',{name:'Login',exact:true}).click()
  await passwordReturn;await ready(passwordPage,'legacy-password-return')
  // Enrol through the native owner session; the secret stays only inside this synthetic test.
  const enrolled=await passwordPage.evaluate(async()=>{
   const response=await fetch('/api/identity/two-factor/totp',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})
   if(response.status!==201)throw Error('Synthetic TOTP enrolment refused')
   return response.json()
  })
  const confirmed=await passwordPage.evaluate(async body=>(await fetch('/api/identity/two-factor/totp/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).status,{factorId:enrolled.factorId,code:totp(enrolled.secret)})
  assert.equal(confirmed,201)
  const factorPage=await fresh()
  await prepareLogin(factorPage);await factorPage.getByRole('button',{name:'Login',exact:true}).click()
  await factorPage.waitForURL(url=>url.pathname==='/two-factor')
  assert.equal(new URL(factorPage.url()).searchParams.get('returnTo'),continuation)
  // A pending native session also follows the entry's own second-factor redirect with its query.
  await factorPage.goto(runtime.origin+continuation)
  await factorPage.waitForURL(url=>url.pathname==='/two-factor')
  assert.equal(new URL(factorPage.url()).searchParams.get('returnTo'),continuation)
  await factorPage.getByLabel('Code from your authenticator app',{exact:true}).fill(totp(enrolled.secret,1))
  await inspect(factorPage,`legacy-totp-${width}`)
  const factorReturn=resumed(factorPage)
  await factorPage.getByRole('button',{name:'Continue',exact:true}).click()
  await factorReturn;await ready(factorPage,'legacy-totp-return')
  passed=true
 }finally{
  for(const context of contexts)await context.close()
  await runtime.close(passed)
 }
}
