import assert from 'node:assert/strict'
import {startApp} from '../../../journeys/kit/app.mjs'
import {auditPage,viewports} from '../../../journeys/kit/browser.mjs'
import {bindings,bind,envelope,random,root} from '../recovery-authority/kit.mjs'
export async function managedBrowserStates({browser,runtime,shot}){
 const app=await startApp({bindings:{...bindings,OWNER_EMAIL:'managed-owner@lantern.test'}})
 const context=await browser.newContext({viewport:viewports.desktop}),page=await context.newPage()
 const proof=async name=>{await auditPage(page,shot(name+'-1440.png'));await page.setViewportSize(viewports.mobile);await auditPage(page,shot(name+'-390.png'));await page.setViewportSize(viewports.desktop)}
 try{
  await app.call('/auth/bootstrap',{body:{token:bindings.H2H_SETUP_TOKEN},status:303});await bind(app)
  // Local HTTPS transport: every API byte is answered by the real mounted Hono
  // app/workerd/D1. Built pages/assets come unchanged from the emitted runtime.
  // No app response, success, storage or factor operation is simulated.
  await context.route('https://app.example/**',async route=>{
   const req=route.request(),url=new URL(req.url()),api=url.pathname.startsWith('/api/')||url.pathname.startsWith('/auth/')
   const response=api?await app.request(url.pathname+url.search,{method:req.method(),headers:req.headers(),body:req.postData()??undefined,raw:true}):await fetch(runtime.origin+url.pathname+url.search,{redirect:'manual'})
   const headers=Object.fromEntries(response.headers);delete headers['content-length'];delete headers['content-encoding'];await route.fulfill({status:response.status,headers,body:Buffer.from(await response.arrayBuffer())})
  })
  // Only the external platform identity/proof issuer is doubled. It signs the
  // exact app challenge and POSTs to the actual native verifier before messaging.
  let held
  await context.route('https://platform.example/**',async route=>{
   if(new URL(route.request().url()).pathname==='/proof'){
    const payload=JSON.parse(Buffer.from(held.payload,'base64url'))
    const result=await app.call(root+'/authorize',{body:envelope({...payload,type:'platform-authorization',iss:bindings.RER_MANAGEMENT_ORIGIN,aud:bindings.APP_ORIGIN+root+'/authorize',platform_proof_id:random()})})
    assert.equal(result.status,200);await route.fulfill({json:{challengeId:payload.challenge_id}});return
   }
   await route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="en"><title>Synthetic external platform proof</title><body><button id="proof">Prove platform ownership</button><script>let challenge;addEventListener('message',event=>{if(event.origin!=='https://app.example'||event.source!==opener||event.data.type!=='h2h-owner-recovery-challenge')return;challenge=event.data.challenge;fetch('/challenge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(challenge)})});opener.postMessage({type:'h2h-owner-recovery-ready',installationId:'${bindings.RER_INSTALLATION_ID}'},'https://app.example');document.getElementById('proof').onclick=async()=>{const response=await fetch('/proof',{method:'POST'});const data=await response.json();opener.postMessage({type:'h2h-owner-recovery-authorized',installationId:'${bindings.RER_INSTALLATION_ID}',challengeId:data.challengeId},'https://app.example')}</script></body></html>`})
  })
  await context.route('https://platform.example/challenge',async route=>{held=route.request().postDataJSON();await route.fulfill({json:{accepted:true}})})
  await page.goto('https://app.example/owner-recovery')
  const opened=page.waitForEvent('popup');await page.getByRole('button',{name:'Recover installation owner',exact:true}).click();const popup=await opened
  await page.getByRole('heading',{name:'Confirm ownership in Managed settings'}).waitFor();await proof('managed-proof-required')
  await popup.getByRole('button',{name:'Prove platform ownership'}).waitFor();await app.until(()=>held)
  await popup.getByRole('button',{name:'Prove platform ownership'}).click();await page.getByRole('heading',{name:'Prove your replacement factor'}).waitFor();await proof('password-creation-required')
  await page.getByLabel('Create a password',{exact:true}).fill('managed-replacement-owner-password')
  const cdp=await context.newCDPSession(page);await cdp.send('WebAuthn.enable');await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}})
  await page.getByRole('button',{name:'Use a new passkey'}).click();await page.getByRole('heading',{name:'Save your new recovery codes'}).waitFor();await proof('managed-completed')
  await popup.close()
 }finally{await context.close();await app.close()}
}
