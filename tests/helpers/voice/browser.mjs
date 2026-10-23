import assert from 'node:assert/strict'
import {randomBytes,createHmac} from 'node:crypto'
import {createRuntime} from '../emitted-runtime.mjs'
import {launchBrowser,evidence} from '../../journeys/kit/browser.mjs'

export async function voiceBrowserProof({widths=[1440,390]}={}){
 const runtime=await createRuntime({outboundFixture:new URL('./browser-network.mjs',import.meta.url).href,vars:{INTEGRATION_ENCRYPTION_KEY:randomBytes(32).toString('base64')}}),browser=await launchBrowser(),shot=await evidence('voice')
 let passed=false
 try{
 for(const width of widths){
  const owner=await runtime.seedTenant({name:'Telephone support '+width,email:`voice-${width}@example.test`}),context=await browser.newContext({viewport:{width,height:1000}})
  try{
   await context.addCookies([{name:'h2h_session',value:owner.token,url:runtime.origin}]);const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(25000)
   const base=`/api/voice/projects/${owner.projectId}`,req=async(path,body,method=body===undefined?'GET':'POST')=>{const result=await context.request.fetch(runtime.origin+path,{method,...(body===undefined?{}:{data:body})});assert.ok(result.ok(),`${path}: ${result.status()} ${await result.text()}`);return result.json()}
   const capture=async name=>{assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${name} fits ${width}`);await page.screenshot({path:shot(`${name}-${width}.png`),fullPage:true})}
   await page.goto(runtime.origin+`/projects/${owner.projectId}/settings`)
   await page.getByRole('button',{name:'Telephone',exact:true}).click()
   await page.getByRole('button',{name:'Account menu',exact:true}).focus();await page.getByRole('tooltip').waitFor()
   await page.getByRole('button',{name:'Connect support number',exact:true}).click()
   await page.getByLabel('Provider number ID',{exact:true}).fill('synthetic-happytohelp-3')
   await page.getByLabel('Account SID or API ID',{exact:true}).fill('synthetic-happytohelp-2')
   await page.getByLabel('Provider auth token',{exact:true}).fill('synthetic-happytohelp-1')
   await page.getByLabel('Human support phone',{exact:true}).fill('+12025550103')
   await page.getByLabel('Offer recording and transcription after caller opt-in',{exact:true}).check()
   await page.getByLabel('Every receiving support teammate has opted in to recording and transcription',{exact:true}).check()
   await page.getByRole('button',{name:'Save voice number',exact:true}).click()
   await page.getByText('Voice number saved. Configure the provider webhook before testing.',{exact:true}).waitFor()
   let number=(await req(base+'/numbers')).data[0];assert.ok(number.enabled)
   await page.getByRole('button',{name:'Edit routing for +12025550101',exact:true}).click()
   await page.getByLabel('Media retention in days',{exact:true}).fill('2')
   await page.getByRole('button',{name:'Save voice number',exact:true}).click()
   await page.getByText('Voice number saved. Configure the provider webhook before testing.',{exact:true}).waitFor()
   number=(await req(base+'/numbers')).data[0];assert.equal(number.settings.retention_days,2)
   await page.getByRole('button',{name:'Edit routing for +12025550101',exact:true}).click();await capture('settings')
   const hook=async(step,extra={},remote='synthetic-happytohelp-'+width)=>{const path='/api/voice/hooks/'+number.id+(step?'?step='+step:''),form={AccountSid:'synthetic-happytohelp-2',CallSid:remote,...(step==='recording'?{}:{From:'+12025550102',To:'+12025550101'}),...extra};let value=runtime.origin+path;for(const key of Object.keys(form).sort())value+=key+form[key];const signature=createHmac('sha1','synthetic-happytohelp-1').update(value).digest('base64');const result=await context.request.post(runtime.origin+path,{data:new URLSearchParams(form).toString(),headers:{'Content-Type':'application/x-www-form-urlencoded','X-Twilio-Signature':signature}});assert.equal(result.status(),200);return result.text()}
   assert.match(await hook(),/Press 1 to consent/);assert.match(await hook('consent',{Digits:'1'}),/<Record /)
   await hook('recording',{RecordingStatus:'completed',RecordingSid:'synthetic-happytohelp-13'})
   await hook('transcript',{TranscriptionStatus:'completed',TranscriptionText:'I need help with my export.'})
   const inbox=await req(`/api/dashboard/projects/${owner.projectId}/conversations`),ticket=inbox.data.find(c=>c.channel==='phone');assert.ok(ticket)
   const root=base+`/conversations/${ticket.id}`,history=await req(root+'/calls');assert.equal(history.data.length,1)
   const contact=(await req(`/api/management/projects/${owner.projectId}/contacts`,{name:'Existing customer',email:'voice-context@example.test'})).data
   await page.goto(runtime.origin+`/projects/${owner.projectId}/conversations/${ticket.id}`)
   await page.getByLabel('Reply to conversation',{exact:true}).waitFor()
   if(await page.locator('#conversation-assistant').getAttribute('aria-hidden')==='true')await page.getByRole('button',{name:'Show conversation panel',exact:true}).click()
   await page.getByRole('tab',{name:'Ticket',exact:true}).click()
   await page.locator('#ticket-section-voice-heading').click()
   const panel=page.locator('#ticket-section-voice')
   await panel.getByText('Call transcript',{exact:true}).click()
   await panel.locator('pre').filter({hasText:'I need help with my export.'}).waitFor()
   const download=page.waitForEvent('download');await panel.getByRole('button',{name:'Download recording',exact:true}).click();assert.equal((await download).suggestedFilename(),'support-call.mp3')
   await panel.getByRole('button',{name:'Call back',exact:true}).click();await panel.getByRole('button',{name:'Confirm callback',exact:true}).click()
   await panel.getByText('callback: uncertain',{exact:true}).waitFor()
   await panel.getByRole('button',{name:'Call back',exact:true}).click();await panel.getByRole('button',{name:'Confirm callback',exact:true}).click()
   assert.equal((await req(root+'/calls')).commands.length,1,'repeat click preserves the command identity')
   await panel.getByLabel('Find customer by email',{exact:true}).fill('voice-context@example.test');await panel.getByRole('button',{name:'Find customer',exact:true}).click();await panel.getByRole('button',{name:'Link this customer',exact:true}).click()
   await panel.getByRole('button',{name:'Unlink customer context',exact:true}).waitFor();assert.equal((await req(root+'/calls')).linked_context.id,contact.id)
   await panel.scrollIntoViewIfNeeded();await capture('inbox')
   page.once('dialog',d=>d.accept());await panel.getByRole('button',{name:'Withdraw recording consent',exact:true}).click()
   await panel.getByText(/Provider call stop: uncertain/).waitFor()
   assert.equal((await req(root+'/calls')).data[0].transcript,null);assert.equal(await panel.getByRole('button',{name:'Download recording',exact:true}).count(),0)
   await capture('withdrawn')
   // A new active call exercises the inbox human-transfer control.
   await req(base+'/numbers/'+number.id,{version:number.version,settings:{...number.settings,hours:Array.from({length:7},(_,day)=>({day,start:'00:00',end:'23:59'}))}},'PATCH')
   await hook('',{},'synthetic-happytohelp-active-'+width)
   await panel.getByRole('button',{name:'Refresh call history',exact:true}).click()
   await panel.getByRole('button',{name:'Transfer to human',exact:true}).click();await panel.getByRole('button',{name:'Confirm transfer',exact:true}).click()
   await panel.getByText('transfer: uncertain',{exact:true}).waitFor();await panel.getByText('transfer failed · Follow-up needed',{exact:true}).waitFor()
   await capture('transfer')
   await page.goto(runtime.origin+`/projects/${owner.projectId}/reports`)
   await page.getByRole('button',{name:'Load telephone report',exact:true}).click()
   await page.locator('.voice-report tbody tr').first().waitFor();await page.locator('.voice-report').scrollIntoViewIfNeeded();await capture('report')
   assert.equal((await req(base+'/report')).data.reduce((n,r)=>n+r.calls,0),2)
   await page.goto(runtime.origin+`/projects/${owner.projectId}/settings`);await page.getByRole('button',{name:'Telephone',exact:true}).click()
   page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Disconnect +12025550101',exact:true}).click();await page.getByText('Disconnected',{exact:true}).waitFor()
   assert.equal((await req(base+'/numbers')).data[0].enabled,0);assert.deepEqual(errors,[])
  }catch(error){for(const p of context.pages()){await p.screenshot({path:shot(`failure-${width}.png`),fullPage:true}).catch(()=>{});console.error('Voice form validity',await p.locator('input:invalid,select:invalid').evaluateAll(nodes=>nodes.map(n=>({name:n.name,message:n.validationMessage}))).catch(()=>[]));}throw error}finally{await context.close()}
 }
 passed=true
 }finally{await browser.close();await runtime.close(passed)}
}
