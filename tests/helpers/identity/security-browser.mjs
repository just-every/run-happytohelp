import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {createServer} from 'node:net'
import {createRuntime} from '../emitted-runtime.mjs'
import {auditPage,evidence,viewports} from '../../journeys/kit/browser.mjs'
import {totp} from './two-factor.mjs'
import {magicSignIn} from './magic-browser.mjs'

export async function securityBrowserJourney(browser){
 const reservation=createServer();await new Promise(done=>reservation.listen(0,'127.0.0.1',done))
 const port=reservation.address().port;await new Promise(done=>reservation.close(done))
 const runtime=await createRuntime({port,vars:{INTEGRATION_ENCRYPTION_KEY:randomBytes(32).toString('base64'),APP_ORIGIN:`http://localhost:${port}`,EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'synthetic-mail-edge',EMAIL_FROM:'support@example.test'},outboundFixture:new URL('./mail-edge.mjs',import.meta.url).href})
 const origin=runtime.origin.replace('127.0.0.1','localhost'),shot=await evidence('account-security'),errors=[]
 const password='owner-correct-horse-battery'
 let passed=false
 try{
  const bootstrap=await fetch(origin+'/api/identity/bootstrap',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Lantern Works',ownerName:'Casey Owner',email:'casey@lantern.test',password,allowedOrigin:origin})})
  assert.equal(bootstrap.status,201)
  const tenant=await bootstrap.json()
  const actor=await fetch(origin+'/api/identity/session',{headers:{Authorization:'Bearer '+tenant.token}})
  assert.equal(actor.status,200);tenant.userId=(await actor.json()).id
  const owner=await magicSignIn({runtime,browser,origin,tenant,shot}),P=`/projects/${tenant.projectId}`
  owner.on('pageerror',error=>errors.push(error.message))
  await owner.goto(origin+'/users/profile')
  await owner.getByRole('navigation',{name:'Settings sections'}).getByRole('button',{name:'Security',exact:true}).click()
  await owner.getByRole('button',{name:'Add an authenticator app'}).click()
  await owner.getByRole('button',{name:'Set up an authenticator app'}).click()
  const secret=(await owner.getByTestId('totp-secret').innerText()).replace(/\s/g,'')
  await owner.getByLabel('Code from the app').fill(totp(secret))
  await owner.getByRole('button',{name:'Turn on',exact:true}).click()
  await owner.getByRole('heading',{name:'Save your recovery codes',exact:true}).waitFor()
  assert.ok(await owner.locator('.tf-code-list li').count()>0,'enrollment supplies recovery codes')
  await owner.getByRole('button',{name:'Done',exact:true}).click()
  const cdp=await owner.context().newCDPSession(owner)
  await cdp.send('WebAuthn.enable')
  await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}})
  await owner.getByRole('button',{name:'Add a passkey or security key',exact:true}).click()
  await owner.getByRole('button',{name:'Add a passkey or security key',exact:true}).click()
  await owner.getByRole('cell',{name:/Passkey or security key/}).waitFor()
  await auditPage(owner,shot('factors-enrolled.png'))
  assert.equal(await owner.evaluate(async()=>(await fetch('/auth/signout',{method:'POST'})).status),204)
  await owner.goto(origin+'/login')
  await owner.getByLabel('Email',{exact:true}).fill('casey@lantern.test')
  await owner.getByLabel('Password',{exact:true}).fill(password)
  await owner.getByRole('button',{name:'Login',exact:true}).click()
  await owner.waitForURL(url=>url.pathname==='/two-factor')
  await owner.getByRole('heading',{name:'Check it’s you',exact:true}).waitFor()
  await owner.getByRole('button',{name:'Use a passkey or security key',exact:true}).click()
  await owner.waitForURL(url=>url.pathname.startsWith(P))
  await runtime.execute(`UPDATE session_factors SET verified_at=verified_at-${20*60*1000}`)
  await owner.goto(origin+P+'/security-log')
  const downloading=owner.waitForEvent('download')
  await owner.getByRole('button',{name:'Export CSV',exact:true}).click()
  const dialog=owner.getByRole('dialog',{name:'Confirm it’s you',exact:true})
  await dialog.getByLabel('Code from your authenticator app',{exact:true}).fill(totp(secret,1))
  await dialog.getByRole('button',{name:'Confirm',exact:true}).click()
  const csv=await readFile(await (await downloading).path(),'utf8')
  assert.match(csv,/two_factor\.enrolled/);assert.match(csv,/step_up\.required/)
  await owner.goto(origin+P+'/security')
  await owner.getByLabel('Agents',{exact:true}).check()
  await owner.getByRole('button',{name:'Save policy',exact:true}).click()
  await owner.getByRole('status').filter({hasText:'Saved'}).waitFor()
  await owner.reload();assert.equal(await owner.getByLabel('Agents',{exact:true}).isChecked(),true)
  // A second native session signs out; the original proven session remains usable.
  const second=await browser.newContext({viewport:viewports.desktop})
  try{
   const original=(await owner.context().cookies(origin)).find(c=>c.name==='h2h_session')
   await second.addCookies([{name:'h2h_session',value:original.value,url:origin}])
   const page=await second.newPage();await page.goto(origin+P+'/security-log')
   assert.equal(await page.evaluate(async projectId=>(await fetch('/api/identity/switch-project',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId})})).status,tenant.projectId),200)
   const old=(await second.cookies(origin)).find(c=>c.name==='h2h_session')
   assert.notEqual(old.value,original.value)
   await page.getByRole('button',{name:'Account menu',exact:true}).click()
   await page.getByRole('button',{name:'Sign out',exact:true}).click()
   await page.waitForURL(url=>url.pathname==='/login')
   assert.equal((await second.request.get(origin+'/api/identity/session')).status(),401)
   assert.equal((await fetch(origin+'/api/identity/session',{headers:{Cookie:'h2h_session='+old.value}})).status,401)
   assert.equal((await owner.context().request.get(origin+'/api/identity/session')).status(),200)
  }finally{await second.close()}
  await owner.goto(origin+P+'/security-log')
  await owner.getByRole('row').filter({hasText:/signed out/i}).filter({hasText:'succeeded'}).first().waitFor()
  await auditPage(owner,shot('security-log.png'))
  assert.deepEqual(errors,[]);passed=true
 }finally{await runtime.close(passed)}
}
