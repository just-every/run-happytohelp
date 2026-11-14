import assert from 'node:assert/strict'
import {mkdtemp,mkdir,rm,readFile} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {randomBytes} from 'node:crypto'
import {createServer} from 'node:net'
import {spawn} from 'node:child_process'
import {createRuntime} from '../emitted-runtime.mjs'
import {launchBrowser} from '../../journeys/kit/browser.mjs'
import {totp} from '../identity/two-factor.mjs'
import {publicClient,acceptedBrowserHistory,browserDelta,uploadPackage} from './browser-fixture.mjs'
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
export async function rehearsalBrowserJourney(){
 const directory=await mkdtemp(join(tmpdir(),'rehearsal-browser-')),shots=resolve(process.env.H2H_REHEARSAL_SCREENS||'test-results/rehearsal');await mkdir(shots,{recursive:true})
 const port=await new Promise(resolvePort=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolvePort(p))})})
 const runtime=await createRuntime({port,queueConsumers:true,outboundFixture:new URL('./browser-network.mjs',import.meta.url).href,vars:{APP_ORIGIN:`http://127.0.0.1:${port}`,H2H_SETUP_TOKEN:'synthetic-browser-setup',OWNER_EMAIL:'synthetic-browser-owner@example.test',INTEGRATION_ENCRYPTION_KEY:randomBytes(32).toString('base64'),EMAIL_PROVIDER:'off',REHEARSAL_PROVIDER_STATE:join(directory,'provider-state.json')}}),browser=await launchBrowser(),context=await browser.newContext({viewport:{width:1440,height:1000},bypassCSP:true}),page=await context.newPage(),api=publicClient(runtime),screens=[],errors=[]
 let success=false
 try{
  const owner=await api.call('/api/identity/bootstrap',{body:{setupToken:'synthetic-browser-setup',email:'synthetic-browser-owner@example.test',password:'Synthetic browser password 42!',name:'Synthetic support owner',allowedOrigin:runtime.origin},status:201}),base=`/api/move-in/projects/${owner.projectId}/rehearsals`
  page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(20000)
  await page.goto(runtime.origin+'/login?returnTo='+encodeURIComponent(`/projects/${owner.projectId}/settings`));await page.getByLabel('Email',{exact:true}).fill('synthetic-browser-owner@example.test');await page.getByLabel('Password',{exact:true}).fill('Synthetic browser password 42!');await page.getByRole('button',{name:'Login',exact:true}).click();await page.waitForURL('**/settings');await page.getByRole('link',{name:'Move in existing support history',exact:true}).click();await page.getByRole('heading',{name:'Move in',exact:true}).waitFor()
  const panel=page.locator('.rehearsal-panel'),refresh=async()=>{
   await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname===base&&r.request().method()==='GET'&&r.status()===200),panel.getByRole('button',{name:'Refresh consent status',exact:true}).click()])
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))
  }
  await panel.locator(':scope > summary').click();await panel.getByRole('heading',{name:'New daily copy consent'}).waitFor()
  const inspect=async(name,selector='.rehearsal-panel')=>{
   for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))
    await page.addScriptTag({path:resolve('node_modules/axe-core/axe.min.js')})
    const facts=await page.evaluate(async()=>{const r=await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}});return {overflow:document.documentElement.scrollWidth>innerWidth+1,violations:r.violations.filter(v=>['critical','serious'].includes(v.impact)).map(v=>v.id)}})
    assert.deepEqual(facts.violations,[],name);assert.equal(facts.overflow,false,name)
    const targets=await panel.locator('button,input,select,textarea').evaluateAll(es=>es.filter(e=>e.getClientRects().length).map(e=>e.getBoundingClientRect().height));assert.ok(targets.every(h=>h>=44),name)
    await page.locator(selector).screenshot({path:join(shots,`${name}-${width}.png`),animations:'disabled'});screens.push(`${name}-${width}.png`)
   }
   await page.setViewportSize({width:1440,height:1000})
  }
  await inspect('accepted-import-absent')
  const history=await acceptedBrowserHistory(runtime,api,directory,owner);await refresh()
  const review=async name=>{await panel.getByLabel('Accepted legacy adoption').selectOption(history.origin.manifestSha256);await panel.getByLabel('Existing Zendesk import').selectOption({index:1});await panel.getByLabel('Named copier').fill(name);await panel.getByRole('button',{name:'Review consent',exact:true}).click();await panel.getByRole('heading',{name:'Review daily copy consent'}).waitFor()}
  await review('synthetic-daily-support-copier');await inspect('exact-scope-review')
  await panel.getByRole('button',{name:'Grant daily copy consent',exact:true}).click();await panel.getByRole('alert').filter({hasText:'two_factor_setup_required'}).waitFor();await inspect('factor-refusal')
  const started=await page.evaluate(async()=>{const r=await fetch('/api/identity/two-factor/totp',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(!r.ok)throw Error(await r.text());return r.json()})
  const enrolled=await page.evaluate(async body=>{const r=await fetch('/api/identity/two-factor/totp/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return r.status},{factorId:started.factorId,code:totp(started.secret)});assert.equal(enrolled,201)
  await runtime.restart(()=>runtime.execute('UPDATE session_factors SET verified_at=0'))
  await panel.getByRole('button',{name:'Grant daily copy consent',exact:true}).click();await page.getByRole('dialog',{name:'Confirm it’s you'}).waitFor();await inspect('native-step-up','.step-up-dialog')
  await page.getByRole('dialog').getByLabel('Code from your authenticator app',{exact:true}).fill(totp(started.secret,1));await page.getByRole('dialog').getByRole('button',{name:'Confirm',exact:true}).click();await panel.getByLabel('Daily copy credential').waitFor()
  let credential=await panel.getByLabel('Daily copy credential').inputValue(),grant=(await page.evaluate(async base=>(await (await fetch(base)).json()).data.grants,base))[0],root=base+'/'+grant.id
  await inspect('credential-once');await panel.getByRole('button',{name:'Clear credential',exact:true}).click()
  await runtime.restart(()=>runtime.execute("UPDATE contacts SET name='Native customer name retained' WHERE id='synthetic-contact'"))
  const delta=await browserDelta(directory,history.origin),day=new Date().toISOString().slice(0,10),legacy=root+'/copy/legacy/'+delta.manifestSha256
  await uploadPackage(api,legacy,delta,credential,day);await api.call(legacy+'/start',{token:credential,body:{approvedManifestSha256:delta.manifestSha256},status:202});await refresh();await panel.getByText(/^Copy in progress/).waitFor();await inspect('daily-running')
  const copied=await api.wait(legacy+'/result',credential,r=>r.run.state==='complete');assert.equal(copied.work.unchanged,true);await refresh();await inspect('conflict-retained')
  const source=(await api.call(root+'/copy/zendesk',{token:credential})).data,pull=(await api.call(root+'/copy/zendesk/pulls',{token:credential,body:{day,cursor:source.acceptedCursor},status:202})).data,pullBase=root+'/copy/zendesk/pulls/'+pull.id
  await api.wait(pullBase,credential,r=>r.state==='applied');await api.call(pullBase+'/attachments',{token:credential,body:{},status:202})
  await api.wait(pullBase+'/result',credential,r=>r.attachments?.state==='done')
  for(let n=0;n<200;n++){const r=await api.call(pullBase+'/verify',{token:credential,body:{}});if(r.data.verified)break;await sleep(200)}
  await refresh();await panel.getByText(/Verified /).first().waitFor();const verifiedConflicts=await panel.getByText(/^Conflicts:/).first().innerText();await inspect('daily-verified')
  await panel.getByRole('button',{name:'Stop daily copying',exact:true}).click();await panel.getByText('Source cleanup: pending.',{exact:false}).first().waitFor();await inspect('stopped-cleanup-pending')
  for(let n=0;n<30;n++){
   await page.waitForFunction(()=>document.querySelector('.rehearsal-content')?.getAttribute('aria-busy')==='false')
   const button=panel.getByRole('button',{name:'Continue source cleanup',exact:true}).first()
   if(!await button.count())break
   await button.click()
  }
  await panel.getByText('Source cleanup: complete.',{exact:false}).first().waitFor();assert.equal(await panel.getByText(/^Conflicts:/).first().innerText(),verifiedConflicts,'verified conflicts survive source cleanup');await inspect('source-cleanup-complete')
  await review('synthetic-paused-copier');await panel.getByRole('button',{name:'Grant daily copy consent',exact:true}).click();await panel.getByLabel('Daily copy credential').waitFor();await panel.getByRole('button',{name:'Clear credential',exact:true}).click()
  await page.evaluate(async()=>fetch('/agents/api/pause',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paused:true})}));await refresh();await inspect('paused-revoked')
  await page.evaluate(async()=>fetch('/agents/api/pause',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({paused:false})}))
  await review('synthetic-expired-copier');await panel.getByRole('button',{name:'Grant daily copy consent',exact:true}).click();await panel.getByLabel('Daily copy credential').waitFor();await panel.getByRole('button',{name:'Clear credential',exact:true}).click()
  await runtime.restart(()=>runtime.execute(`UPDATE rehearsal_grants SET expiry_at=${Date.now()-1000} WHERE state='active'`));await refresh();await panel.getByText('Closed · expired',{exact:true}).waitFor();await inspect('expired')
  const foreign=await runtime.seedTenant({name:'Synthetic other workspace owner',email:'synthetic-other-browser@example.test',allowedOrigin:runtime.origin})
  await runtime.restart(()=>runtime.execute(`INSERT INTO memberships(project_id,user_id,role) VALUES('${owner.projectId}','${foreign.userId}','admin')`))
  await context.addCookies([{name:'h2h_session',value:foreign.token,url:runtime.origin}]);await page.reload();await panel.locator(':scope > summary').click();await panel.getByRole('alert').waitFor();await inspect('wrong-owner-refusal')
  assert.deepEqual(errors,[]);success=true;console.log('REHEARSAL_BROWSER',JSON.stringify({screens,overflow:false,criticalAccessibility:0}));return {screens,shots}
 }finally{await browser.close();await runtime.close(success);await rm(directory,{recursive:true,force:true})}
}
if(process.argv[1]===new URL(import.meta.url).pathname){
 if(process.argv.includes('--build')){const code=await new Promise(resolveCode=>{const p=spawn('pnpm',['exec','rer','build'],{stdio:'inherit'});p.once('exit',resolveCode)});if(code!==0)process.exit(code??1)}
 await rehearsalBrowserJourney()
}
