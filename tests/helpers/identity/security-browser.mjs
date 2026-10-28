import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {readFile,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {createRuntime} from '../emitted-runtime.mjs'
import {evidence,viewports} from '../../journeys/kit/browser.mjs'
import {totp} from './two-factor.mjs'

const api=async(origin,path,{body,token,method}={})=>{
 const response=await fetch(origin+path,{method:method||(body===undefined?'GET':'POST'),headers:{'Content-Type':'application/json',Origin:origin,...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)})
 const text=await response.text();let json;try{json=JSON.parse(text)}catch{}
 return {status:response.status,json,text}
}
const axe=await readFile(resolve('node_modules/axe-core/axe.min.js'),'utf8')

/**
 * The account-security screens in a real browser: an authenticator app and a passkey
 * (a virtual WebAuthn authenticator) on the profile, the two-factor sign-in page, the
 * step-up dialog on an export, Settings → Security, Security log and Roles, a
 * collaborator's notes-only conversation, and native session sign-out. Every screen
 * is axe-checked for serious findings and horizontal overflow, and photographed at 1440 and 390.
 */
export async function securityBrowserJourney(browser){
 const shot=await evidence('account-security'),errors=[],records=[],signouts=[]
 const runtime=await createRuntime({vars:{INTEGRATION_ENCRYPTION_KEY:randomBytes(32).toString('base64')}})
 let passed=false,current
 try{
  // Passkeys bind to a domain name, so the browser uses localhost rather than 127.0.0.1.
  const origin=runtime.origin.replace('127.0.0.1','localhost'),password='owner-correct-horse-battery'
  const created=await api(origin,'/api/identity/bootstrap',{body:{name:'Lantern Works',ownerName:'Casey Owner',email:'casey@lantern.test',password,allowedOrigin:origin}});assert.equal(created.status,201,created.text)
  const projectId=created.json.projectId,P=`/projects/${projectId}`,widgetKey=(await api(origin,`/api/identity/projects/${projectId}`,{token:created.json.token})).json.widget_key
  const open=async(viewport,token)=>{
   const context=await browser.newContext({viewport,acceptDownloads:true});if(token)await context.addCookies([{name:'h2h_session',value:token,url:origin}])
   const page=await context.newPage();page.setDefaultTimeout(20000);current=page
   page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error'&&!/status of (4|5)\d\d/.test(message.text()))errors.push(message.text())})
   return page
  }
  const inspect=async(page,name)=>{
   await page.addScriptTag({content:axe})
   const violations=await page.evaluate(async()=>(await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.filter(item=>['serious','critical'].includes(item.impact)).map(item=>({id:item.id,nodes:item.nodes.map(node=>node.target)})))
   assert.deepEqual(violations,[],name);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+': no horizontal overflow')
   await page.screenshot({path:shot(name+'.png'),fullPage:true});records.push({name,violations:violations.length})
  }

  // The owner turns on an authenticator app from the profile and keeps the recovery codes.
  const owner=await open(viewports.desktop,created.json.token)
  await owner.goto(origin+'/users/profile');await owner.getByRole('navigation',{name:'Settings sections'}).getByRole('button',{name:'Security',exact:true}).click()
  await owner.getByRole('heading',{name:'Two-factor sign-in'}).waitFor();await inspect(owner,'profile-security-off-1440')
  await owner.getByRole('button',{name:'Add an authenticator app'}).click();await owner.getByRole('button',{name:'Set up an authenticator app'}).click()
  const secret=(await owner.getByTestId('totp-secret').innerText()).replace(/\s/g,'');await inspect(owner,'authenticator-setup-1440')
  await owner.getByLabel('Code from the app').fill(totp(secret));await owner.getByRole('button',{name:'Turn on'}).click()
  await owner.getByRole('heading',{name:'Save your recovery codes'}).waitFor();assert.equal(await owner.locator('.tf-code-list li').count(),10);await inspect(owner,'recovery-codes-1440')
  await owner.getByRole('button',{name:'Done'}).click()

  // A passkey from a virtual authenticator joins the app as a second factor.
  const cdp=await owner.context().newCDPSession(owner);await cdp.send('WebAuthn.enable')
  await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}})
  await owner.getByRole('button',{name:'Add a passkey or security key'}).click();await owner.getByRole('button',{name:'Add a passkey or security key'}).click()
  await owner.getByRole('cell',{name:/Passkey or security key/}).waitFor();await inspect(owner,'profile-security-on-1440')

  // Signing in again stops at the second step; the passkey finishes it.
  assert.equal(await owner.evaluate(async()=>(await fetch('/auth/signout',{method:'POST'})).status),204);await owner.goto(origin+'/login')
  await owner.getByLabel('Email').fill('casey@lantern.test');await owner.getByLabel('Password').fill(password);await owner.getByRole('button',{name:'Login'}).click()
  await owner.waitForURL(url=>url.pathname==='/two-factor');await owner.getByRole('heading',{name:'Check it’s you'}).waitFor();await inspect(owner,'two-factor-verify-1440')
  await owner.getByRole('button',{name:'Use a passkey or security key'}).click();await owner.waitForURL(url=>url.pathname.startsWith(P))

  // An export after the step-up window asks again: the dialog takes the next authenticator code.
  await runtime.execute(`UPDATE session_factors SET verified_at=verified_at-${20*60*1000}`)
  await owner.goto(origin+P+'/security-log');await owner.getByRole('heading',{name:'Activity'}).waitFor();await inspect(owner,'security-log-1440')
  const download=owner.waitForEvent('download');await owner.getByRole('button',{name:'Export CSV'}).click()
  await owner.getByRole('dialog',{name:'Confirm it’s you'}).waitFor();await inspect(owner,'step-up-dialog-1440')
  await owner.getByRole('dialog').getByLabel('Code from your authenticator app').fill(totp(secret,1));await owner.getByRole('dialog').getByRole('button',{name:'Confirm'}).click()
  const csv=await readFile(await (await download).path(),'utf8');assert.match(csv,/two_factor\.enrolled/);assert.match(csv,/step_up\.required/)

  // Settings → Security: the owner requires two-factor for agents; Roles: a custom role.
  await owner.goto(origin+P+'/security');await owner.getByRole('heading',{name:'Two-factor sign-in'}).waitFor()
  await owner.getByLabel('Agents').check();await owner.getByRole('button',{name:'Save policy'}).click();await owner.getByRole('status').filter({hasText:'Saved'}).waitFor();await inspect(owner,'security-policy-1440')
  await owner.goto(origin+P+'/roles');await owner.getByRole('heading',{name:'Built-in roles'}).waitFor();await owner.getByRole('button',{name:'New role'}).click()
  await owner.getByLabel('Read internal help articles').check();await owner.getByLabel('Name').fill('Billing helper');await owner.getByLabel('Publish help articles').uncheck();await owner.getByRole('button',{name:'Create role'}).click()
  await owner.getByRole('heading',{name:'Billing helper'}).waitFor();await inspect(owner,'roles-1440')

  // A collaborator reads a customer's conversation, follows it and has notes instead of a reply box.
  const widget=await api(origin,'/api/identity/widget/session',{body:{widgetKey,name:'Riley Customer',email:'riley@example.test'}})
  const conversation=await api(origin,'/api/conversations',{body:{projectId},token:widget.json.token})
  await api(origin,`/api/conversations/${conversation.json.id}/messages`,{body:{localId:'riley-1',content:'Where is my order?',expectedRevision:0},token:widget.json.token})
  const unproven=await api(origin,`/api/management/projects/${projectId}/agents`,{body:{email:'casey.collab@lantern.test',role:'collaborator'},token:(await api(origin,'/api/identity/login',{body:{email:'casey@lantern.test',password}})).json.token})
  assert.equal(unproven.status,401,'a password-only owner session reaches nothing until its second factor')
  const steppedOwner=await owner.evaluate(async invitation=>(await fetch(invitation.path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(invitation.body)})).json(),{path:`/api/management/projects/${projectId}/agents`,body:{email:'casey.collab@lantern.test',role:'collaborator'}})
  const token=new URL(steppedOwner.data.invitationUrl).searchParams.get('token')
  assert.equal((await api(origin,'/api/identity/accept-token',{body:{token,name:'Jordan Collaborator',password:'collab-correct-horse-battery'}})).status,200)
  const collaboratorLogin=await api(origin,'/api/identity/login',{body:{email:'casey.collab@lantern.test',password:'collab-correct-horse-battery'}})
  const collaborator=await open(viewports.desktop,collaboratorLogin.json.token)
  await collaborator.goto(origin+`${P}/conversations/${conversation.json.id}`);await collaborator.getByRole('note').filter({hasText:'add internal notes'}).waitFor()
  assert.equal(await collaborator.getByPlaceholder('Type your reply…').count(),0,'no reply box for a collaborator')
  assert.equal(await collaborator.getByRole('button',{name:'Close',exact:true}).count(),0,'no close button for a collaborator')
  // Follow is in the notes-only box's "+" (Actions), with Internal note.
  const notesActions=collaborator.locator('#conversation-notes-tools'),follow=collaborator.getByRole('menuitemcheckbox',{name:'Follow',exact:true})
  await notesActions.click();await follow.and(collaborator.locator(':not(.disabled)')).waitFor();await follow.click()
  await notesActions.click();await collaborator.getByRole('menuitemcheckbox',{name:'Following',exact:true}).waitFor();await collaborator.keyboard.press('Escape');await inspect(collaborator,'collaborator-conversation-1440')

  // The same screens at phone width.
  for(const [page,path,heading,name] of [[owner,'/users/profile',null,'profile-security'],[owner,P+'/security','Two-factor sign-in','security-policy'],[owner,P+'/security-log','Activity','security-log'],[owner,P+'/roles','Built-in roles','roles'],[collaborator,`${P}/conversations/${conversation.json.id}`,null,'collaborator-conversation']]){
   await page.setViewportSize(viewports.mobile);await page.goto(origin+path)
   if(name==='profile-security'){await page.getByRole('navigation',{name:'Settings sections'}).getByRole('button',{name:'Security',exact:true}).click();await page.getByRole('heading',{name:'Two-factor sign-in'}).waitFor()}
   else if(heading)await page.getByRole('heading',{name:heading}).waitFor()
   // The phone conversation slides in; photograph it once it rests inside the screen.
   else await page.waitForFunction(()=>{const box=document.querySelector('.conversation-notes-only')?.getBoundingClientRect();return box&&box.left>=0&&box.right<=innerWidth})
   await inspect(page,name+'-390')
  }
  const phone=await open(viewports.mobile);await phone.goto(origin+'/login')
  await phone.getByLabel('Email').fill('casey@lantern.test');await phone.getByLabel('Password').fill(password);await phone.getByRole('button',{name:'Login'}).click()
  await phone.getByRole('heading',{name:'Check it’s you'}).waitFor();await inspect(phone,'two-factor-verify-390')
  await phone.goto(origin+'/owner-recovery');await phone.getByRole('heading',{name:'Recover owner access'}).waitFor();await inspect(phone,'owner-recovery-390')

  // A password-only sign-in can leave the second-factor screen by signing out.
  for(const viewport of [viewports.desktop,viewports.mobile]){
   const pending=await open(viewport),context=pending.context()
   try{
    const login=await context.request.post(origin+'/api/identity/login',{headers:{Origin:origin},data:{email:'casey@lantern.test',password}});assert.equal(login.status(),200)
    const oldCookie=(await context.cookies(origin)).find(cookie=>cookie.name==='h2h_session');assert.ok(oldCookie)
    await pending.goto(origin+'/two-factor');await pending.getByRole('heading',{name:'Check it’s you'}).waitFor();await inspect(pending,`signout-pending-factor-${viewport.width}`)
    const response=pending.waitForResponse(result=>result.url()===origin+'/auth/signout'&&result.request().method()==='POST')
    await pending.getByRole('button',{name:'Sign out',exact:true}).click();assert.equal((await response).status(),204)
    await pending.waitForURL(url=>url.pathname==='/login');assert.equal((await context.cookies(origin)).some(cookie=>cookie.name==='h2h_session'),false)
    const replay=await fetch(origin+'/api/identity/session',{headers:{Cookie:'h2h_session='+oldCookie.value}});assert.equal(replay.status,401)
    await inspect(pending,`signed-out-pending-factor-${viewport.width}`)
   }finally{await context.close()}
  }

  // Each browser signs out only its own native session. The owner's other browser
  // and a different account stay signed in, including after refused CSRF/replay requests.
  const sessionPath=origin+'/api/identity/session',signoutPath=origin+'/auth/signout',auditPath=origin+`/api/management${P}/audit?limit=200`
  const ownerCookie=(await owner.context().cookies(origin)).find(cookie=>cookie.name==='h2h_session');assert.ok(ownerCookie)
  const ownerActor=await (await owner.context().request.get(sessionPath)).json(),collaboratorActor=await (await collaborator.context().request.get(sessionPath)).json()
  const auditRows=async()=>{const response=await owner.context().request.get(auditPath);assert.equal(response.status(),200);return (await response.json()).data}
  const auditIds=rows=>rows.map(row=>row.id).sort()
  const retainedSessions=async()=>{
   for(const [page,actor] of [[owner,ownerActor],[collaborator,collaboratorActor]]){
    const response=await page.context().request.get(sessionPath);assert.equal(response.status(),200,'other sessions remain valid');assert.equal((await response.json()).id,actor.id)
   }
  }
  for(const viewport of [viewports.desktop,viewports.mobile]){
   const signedIn=await open(viewport,ownerCookie.value),context=signedIn.context(),anonymous=await browser.newContext({viewport})
   try{
    await signedIn.goto(origin+P+'/security-log');await signedIn.getByRole('heading',{name:'Activity'}).waitFor()
    const switched=await signedIn.evaluate(async projectId=>{const response=await fetch('/api/identity/switch-project',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId})});return response.status},projectId)
    assert.equal(switched,200)
    const cookie=(await context.cookies(origin)).find(item=>item.name==='h2h_session');assert.ok(cookie);assert.notEqual(cookie.value,ownerCookie.value,'a distinct native session signs out')
    const before=await auditRows()
    for(const headers of [{Origin:'https://untrusted.example'},{}]){
     const refused=await context.request.post(signoutPath,{headers,maxRedirects:0});assert.equal(refused.status(),403,'sign-out requires the application Origin');assert.equal(refused.headers()['set-cookie'],undefined)
     assert.equal((await context.cookies(origin)).find(item=>item.name==='h2h_session')?.value,cookie.value,'a refused request does not clear the cookie')
     assert.equal((await context.request.get(sessionPath)).status(),200,'a refused request does not revoke the session')
    }
    const unauthenticated=await anonymous.request.post(signoutPath,{headers:{Origin:origin},maxRedirects:0});assert.equal(unauthenticated.status(),401);assert.equal(unauthenticated.headers()['set-cookie'],undefined)
    assert.deepEqual(auditIds(await auditRows()),auditIds(before),'refused sign-outs write no audit events');await retainedSessions()

    await signedIn.getByRole('button',{name:'Account menu',exact:true}).click();await inspect(signedIn,`signout-menu-${viewport.width}`)
    const response=signedIn.waitForResponse(result=>result.url()===signoutPath&&result.request().method()==='POST')
    await signedIn.getByRole('button',{name:'Sign out',exact:true}).click()
    const signedOut=await response;assert.equal(signedOut.status(),204,'HTTP 204 completes without a response body')
    assert.match((await signedOut.allHeaders())['set-cookie'],/h2h_session=;.*Max-Age=0/i)
    await signedIn.waitForURL(url=>url.pathname==='/login');await signedIn.getByRole('button',{name:'Login',exact:true}).waitFor()
    assert.equal((await context.cookies(origin)).some(item=>item.name==='h2h_session'),false,'the browser removes the session cookie')
    assert.equal((await context.request.get(sessionPath)).status(),401,'the signed-out browser loses private access')
    assert.equal((await anonymous.request.get(sessionPath,{headers:{Cookie:'h2h_session='+cookie.value}})).status(),401,'replaying the old cookie loses private access')
    const after=await auditRows(),events=after.filter(row=>!before.some(previous=>previous.id===row.id))
    assert.equal(events.length,1,'one successful sign-out records one event');assert.equal(events[0].category,'auth');assert.equal(events[0].action,'session.signed_out');assert.equal(events[0].outcome,'succeeded');assert.equal(events[0].actor_id,ownerActor.id)
    const replay=await anonymous.request.post(signoutPath,{headers:{Origin:origin,Cookie:'h2h_session='+cookie.value},maxRedirects:0});assert.equal(replay.status(),401);assert.equal(replay.headers()['set-cookie'],undefined)
    assert.deepEqual(auditIds(await auditRows()),auditIds(after),'replaying sign-out adds no audit event');await retainedSessions()
    await inspect(signedIn,`signed-out-${viewport.width}`)
    await signedIn.goto(origin+P+'/security-log');await signedIn.waitForURL(url=>url.pathname==='/login');assert.equal((await context.request.get(sessionPath)).status(),401,'a private page cannot restore the signed-out session')
    await owner.setViewportSize(viewport);await owner.goto(origin+P+'/security-log');await owner.getByRole('heading',{name:'Activity'}).waitFor()
    const visibleSignouts=owner.getByRole('row').filter({hasText:/signed out/i}).filter({hasText:'Casey Owner'}).filter({hasText:'succeeded'}),expectedSignouts=after.filter(row=>row.action==='session.signed_out'&&row.actor_id===ownerActor.id).length
    await visibleSignouts.nth(expectedSignouts-1).waitFor();assert.equal(await visibleSignouts.count(),expectedSignouts,'the Security log includes the new sign-out');await inspect(owner,`signout-security-log-${viewport.width}`)
    signouts.push({width:viewport.width,status:204,cookieCleared:true,oldCookieRefused:true,otherSessionsValid:true,refusalsHaveNoEffects:true,auditAction:events[0].action})
   }finally{await context.close();await anonymous.close()}
  }
  assert.deepEqual(errors,[],'no page or console errors')
  await writeFile(shot('proof.json'),JSON.stringify({screens:records,signouts},null,2))
  passed=true
 }catch(error){await current?.screenshot({path:shot('failure.png'),fullPage:true}).catch(()=>{});throw error}
 finally{await runtime.close(passed)}
}
