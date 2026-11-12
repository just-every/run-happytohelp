import {managedBrowserStates} from './managed.mjs'
import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {createServer} from 'node:net'
import {createRuntime} from '../../emitted-runtime.mjs'
import {evidence,viewports,auditPage} from '../../../journeys/kit/browser.mjs'
import {totp} from '../two-factor.mjs'
const root='/api/identity/owner-recovery',password='synthetic-browser-recovery-password',key=randomBytes(32).toString('hex')
export async function recoveryBrowserJourney(browser){
 const reservation=createServer();await new Promise(done=>reservation.listen(0,'127.0.0.1',done));const port=reservation.address().port;await new Promise(done=>reservation.close(done))
 const origin=`http://localhost:${port}`,runtime=await createRuntime({port,vars:{APP_ORIGIN:origin,INTEGRATION_ENCRYPTION_KEY:randomBytes(32).toString('base64'),H2H_OWNER_RECOVERY_KEY:key,EMAIL_PROVIDER:'off'}})
 const context=await browser.newContext({viewport:viewports.desktop}),page=await context.newPage(),shot=await evidence('identity-recovery'),errors=[]
 page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message))
 const api=async(path,body,token,capability)=>{const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,...(body===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:'Bearer '+token}:{}),...(capability?{'X-Recovery-Capability':capability}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await response.json();assert.ok(response.ok,`${path} returned ${response.status}: ${data.error||''}`);return data}
 const proof=async name=>{await auditPage(page,shot(name+'-1440.png'));await page.setViewportSize(viewports.mobile);await auditPage(page,shot(name+'-390.png'));await page.setViewportSize(viewports.desktop)}
 const useFactor=async token=>{const value=await api('/api/identity/two-factor/totp',{},token);await api('/api/identity/two-factor/totp/confirm',{factorId:value.factorId,code:totp(value.secret)},token);return value}
 let passed=false,approver
 try{
  const owner=await api('/api/identity/bootstrap',{name:'Lantern support',ownerName:'Casey Owner',email:'casey@lantern.test',password,allowedOrigin:'https://lantern.test'})
  await useFactor(owner.token)
  const second=await runtime.seedTenant({name:'Harbour support',email:'owner@harbour.test',allowedOrigin:'https://harbour.test'})
  await useFactor(second.token)
  const invitation=await api(`/api/management/projects/${owner.projectId}/agents`,{email:'taylor@support.test'},owner.token)
  await api('/api/identity/accept-token',{token:new URL(invitation.data.invitationUrl).searchParams.get('token'),name:'Taylor Support',password})
  const target=await api('/api/identity/login',{email:'taylor@support.test',password})
  await useFactor(target.token)
  await runtime.execute(`INSERT INTO memberships VALUES('${second.projectId}','${target.actor.id}','operator')`)
  await page.goto(origin+'/owner-recovery');await page.getByRole('heading',{name:'Recover account access'}).waitFor();await proof('initial-choice')
  await page.getByRole('button',{name:'Recover installation owner',exact:true}).click();await page.getByRole('alert').waitFor();await proof('platform-unavailable')
  await page.getByRole('button',{name:'Recover a shared account',exact:true}).click();await proof('shared-primary')
  await page.getByRole('button',{name:'Use an emailed sign-in link'}).click();await proof('mail-primary');await page.getByRole('button',{name:'Use my password'}).click()
  await page.getByLabel('Account email',{exact:true}).fill('taylor@support.test');await page.getByLabel('Password',{exact:true}).fill(password)
  await page.getByRole('button',{name:'Continue recovery',exact:true}).click();await page.getByRole('heading',{name:'Waiting for workspace owners'}).waitFor();await proof('consent-pending')
  const requestId=await page.locator('.recovery-request').innerText(),capability=await page.evaluate(()=>sessionStorage.getItem('h2h-owner-recovery'))
  assert.equal((await fetch(origin+'/api/identity/session',{headers:{'X-Recovery-Capability':capability}})).status,401)
  approver=await browser.newContext({viewport:viewports.desktop});await approver.addCookies([{name:'h2h_session',value:owner.token,url:origin}])
  const review=await approver.newPage();await review.goto(origin+'/owner-recovery');await review.getByRole('button',{name:'Approve a workspace request'}).click();await review.getByLabel('Recovery request ID').fill(requestId);await review.getByRole('button',{name:'Review request',exact:true}).click();await review.getByRole('button',{name:'Approve for this workspace'}).waitFor()
  await auditPage(review,shot('local-owner-review-1440.png'));await review.setViewportSize(viewports.mobile);await auditPage(review,shot('local-owner-review-390.png'));await review.setViewportSize(viewports.desktop)
  assert.equal((await review.locator('body').innerText()).includes('Harbour support'),false)
  await review.getByRole('button',{name:'Approve for this workspace'}).click();await review.getByRole('heading',{name:'Workspace consent recorded'}).waitFor();await auditPage(review,shot('local-consent-recorded-1440.png'));await review.setViewportSize(viewports.mobile);await auditPage(review,shot('local-consent-recorded-390.png'))
  await page.getByRole('button',{name:'Refresh status',exact:true}).click();await page.getByText('1 of 2 approved',{exact:true}).waitFor();await proof('one-consent')
  await api(root+'/account/approve',{requestId},second.token)
  await page.getByRole('button',{name:'Refresh status',exact:true}).click();await page.getByRole('heading',{name:'Prove your replacement factor'}).waitFor();await proof('replacement-choice')
  await page.getByRole('button',{name:'Set up an authenticator app',exact:true}).click();await page.getByTestId('recovery-secret').waitFor();await proof('replacement-totp')
  const secret=await page.getByTestId('recovery-secret').innerText();await page.getByLabel('Code from your authenticator app',{exact:true}).fill(totp(secret));await page.getByRole('button',{name:'Complete recovery',exact:true}).click();await page.getByRole('heading',{name:'Save your new recovery codes'}).waitFor();await proof('new-codes')
  const codes=await page.locator('.recovery-codes li').allTextContents()
  assert.equal((await fetch(origin+'/api/identity/session',{headers:{Authorization:'Bearer '+target.token}})).status,401)
  const cookie=(await context.cookies(origin)).find(c=>c.name==='h2h_session');assert.ok(cookie)
  await api('/api/identity/two-factor/verify',{recoveryCode:await page.locator('.recovery-codes li').first().innerText()},cookie.value)
  assert.equal((await api('/api/identity/session',undefined,cookie.value)).id,target.actor.id)
  await context.clearCookies();await page.goto(origin+'/login');await page.getByLabel('Email',{exact:true}).fill('taylor@support.test');await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Login',exact:true}).click();await page.waitForURL(url=>url.pathname==='/two-factor');await proof('ordinary-new-factor-signin')
  await page.getByLabel('Code from your authenticator app',{exact:true}).fill(totp(secret,1));await page.getByRole('button',{name:/Confirm|Verify|Continue|Sign in/}).first().click()
  // The public API observes real access after the ordinary factor-confirmed login.
  await page.waitForURL(url=>url.pathname.startsWith('/projects/')||url.pathname==='/users/profile');assert.equal((await context.request.get(origin+'/api/identity/session')).status(),200)
  const targetSession=(await context.cookies(origin)).find(c=>c.name==='h2h_session').value
  await context.clearCookies();await page.goto(origin+'/owner-recovery');await page.getByRole('heading',{name:'Recover account access',exact:true}).waitFor()
  await page.getByRole('button',{name:'Recover a shared account',exact:true}).click();await page.getByLabel('Account email',{exact:true}).fill('taylor@support.test');await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:'Continue recovery',exact:true}).click();await page.getByRole('heading',{name:'Waiting for workspace owners'}).waitFor();await page.getByRole('button',{name:'Cancel recovery',exact:true}).click();await page.getByRole('heading',{name:'Recovery cancelled'}).waitFor();await proof('cancelled')
  await page.getByRole('button',{name:'Start a new recovery',exact:true}).click();await page.getByText('Separately controlled installation',{exact:true}).click();await page.getByRole('button',{name:'Use an installation key',exact:true}).click();await proof('manual-primary')
  await page.getByLabel('Account email',{exact:true}).fill('casey@lantern.test');await page.getByLabel('Password',{exact:true}).fill(password);await page.getByLabel('Installation recovery key',{exact:true}).fill(key)
  await runtime.execute("UPDATE owner_setup SET claim_id='existing-installation' WHERE singleton=1")
  await page.getByRole('button',{name:'Continue recovery',exact:true}).click();await page.getByRole('alert').waitFor();await proof('sentinel-refusal')
  await runtime.execute(`UPDATE owner_setup SET claim_id='${owner.userId}' WHERE singleton=1`)
  await page.getByRole('button',{name:'Continue recovery',exact:true}).click();await page.getByRole('heading',{name:'Prove your replacement factor'}).waitFor()
  const manual=await page.evaluate(()=>sessionStorage.getItem('h2h-owner-recovery'))
  await runtime.execute("UPDATE identity_recovery_requests SET expires_at=1 WHERE mode='manual' AND state='authorized'")
  await page.reload();await page.getByRole('heading',{name:'Recovery expired'}).waitFor();await proof('expired')
  await page.getByRole('button',{name:'Start a new recovery',exact:true}).click();await page.getByText('Separately controlled installation',{exact:true}).click();await page.getByRole('button',{name:'Use an installation key',exact:true}).click()
  await page.getByLabel('Account email',{exact:true}).fill('casey@lantern.test');await page.getByLabel('Password',{exact:true}).fill(password);await page.getByLabel('Installation recovery key',{exact:true}).fill(key);await page.getByRole('button',{name:'Continue recovery',exact:true}).click();await page.getByRole('heading',{name:'Prove your replacement factor'}).waitFor()
  const passkeyCapability=await page.evaluate(()=>sessionStorage.getItem('h2h-owner-recovery'))
  const cdp=await context.newCDPSession(page);await cdp.send('WebAuthn.enable');await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}})
  await page.getByRole('button',{name:'Use a new passkey',exact:true}).click();await page.getByRole('heading',{name:'Save your new recovery codes'}).waitFor();await proof('passkey-completed')
  await page.evaluate(value=>sessionStorage.setItem('h2h-owner-recovery',value),passkeyCapability);await page.reload();await page.getByRole('heading',{name:'Recovery already completed'}).waitFor();await proof('replayed-completion')
  await page.getByRole('button',{name:'Start a new recovery',exact:true}).click();await page.getByText('Separately controlled installation',{exact:true}).click();await page.getByRole('button',{name:'Use an installation key',exact:true}).click()
  await page.getByLabel('Account email',{exact:true}).fill('casey@lantern.test');await page.getByLabel('Password',{exact:true}).fill(password);await page.getByLabel('Installation recovery key',{exact:true}).fill(key);await page.getByRole('button',{name:'Continue recovery',exact:true}).click();await page.getByRole('alert').waitFor();await proof('spent-key-refusal')
  const stale=await api(root+'/account/request',{email:'taylor@support.test',password})
  await api('/api/identity/password',{currentPassword:password,password:'replacement-shared-native-password'},targetSession)
  await page.evaluate(value=>sessionStorage.setItem('h2h-owner-recovery',value),stale.capability);await page.reload();await page.getByRole('heading',{name:'Recovery cannot continue'}).waitFor();await proof('authority-changed')
  await approver.close();approver=undefined
  await managedBrowserStates({browser,runtime,shot})
  assert.deepEqual(errors,[]);passed=true
 }finally{await approver?.close();await context.close();await runtime.close(passed)}
}
