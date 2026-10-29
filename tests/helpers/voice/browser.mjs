import assert from 'node:assert/strict'
import {randomBytes,createHmac} from 'node:crypto'
import {createRuntime} from '../emitted-runtime.mjs'
import {launchBrowser,evidence} from '../../journeys/kit/browser.mjs'

export async function voiceBrowserProof(){
 const runtime=await createRuntime({outboundFixture:new URL('./browser-network.mjs',import.meta.url).href,vars:{INTEGRATION_ENCRYPTION_KEY:randomBytes(32).toString('base64')}}),browser=await launchBrowser(),shot=await evidence('voice')
 let passed=false
 try{
 for(const width of [1440,390]){
  const owner=await runtime.seedTenant({name:'Telephone support '+width,email:`voice-${width}@example.test`}),context=await browser.newContext({viewport:{width,height:1000}})
  try{
   await context.addCookies([{name:'h2h_session',value:owner.token,url:runtime.origin}]);const page=await context.newPage();page.setDefaultTimeout(25000)
   const base=`/api/voice/projects/${owner.projectId}`,req=async(path,body,method=body===undefined?'GET':'POST')=>{const result=await context.request.fetch(runtime.origin+path,{method,...(body===undefined?{}:{data:body})});assert.ok(result.ok(),`${path}: ${result.status()}`);return result.json()}
   const settings={timezone:'America/Los_Angeles',hours:[],human_phone:'+12025550103',aircall_user_id:'',group_id:null,ivr:[],jurisdiction:'US-CA',recording_enabled:true}
   const {data:number}=await req(base+'/numbers',{provider:'twilio',provider_id:'synthetic-happytohelp-3',account_id:'synthetic-happytohelp-2',token:'synthetic-happytohelp-1',settings})
   const hook=async(step,extra={})=>{const path='/api/voice/hooks/'+number.id+(step?'?step='+step:''),form={AccountSid:'synthetic-happytohelp-2',CallSid:'synthetic-happytohelp-'+width,From:'+12025550102',To:'+12025550101',...extra};let value=runtime.origin+path;for(const key of Object.keys(form).sort())value+=key+form[key];const signature=createHmac('sha1','synthetic-happytohelp-1').update(value).digest('base64');const result=await context.request.post(runtime.origin+path,{data:new URLSearchParams(form).toString(),headers:{'Content-Type':'application/x-www-form-urlencoded','X-Twilio-Signature':signature}});assert.equal(result.status(),200);return result.text()}
   assert.match(await hook(),/Press 1 to consent/);assert.match(await hook('consent',{Digits:'1'}),/<Record /)
   await hook('recording',{RecordingStatus:'completed',RecordingSid:'synthetic-happytohelp-13'})
   await hook('transcript',{TranscriptionStatus:'completed',TranscriptionText:'I need help with my export.'})
   const inbox=await req(`/api/dashboard/projects/${owner.projectId}/conversations`),ticket=inbox.data.find(c=>c.channel==='phone');assert.ok(ticket)
   const root=base+`/conversations/${ticket.id}`,history=await req(root+'/calls');assert.equal(history.data.length,1);assert.equal(history.data[0].transcript,'I need help with my export.');assert.equal(history.data[0].consent,'granted')
   await page.goto(runtime.origin+`/projects/${owner.projectId}/conversations/${ticket.id}`)
   await page.getByLabel('Reply to conversation',{exact:true}).waitFor()
   await page.getByText(/Telephone voicemail; follow-up needed/).first().waitFor()
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'voice receipt fits the viewport')
   await page.screenshot({path:shot(`inbox-${width}.png`),fullPage:true})
   const result=await req(root+'/commands',{kind:'callback',call_id:history.data[0].id,number_id:number.id,request_id:'browser-callback'})
   assert.equal(result.data.state,'uncertain');assert.equal((await req(root+'/commands',{kind:'callback',call_id:history.data[0].id,number_id:number.id,request_id:'browser-callback'})).data.state,'uncertain')
   assert.equal((await context.request.get(runtime.origin+root+`/calls/${history.data[0].id}/recording`)).status(),200)
   const report=await req(base+'/report');assert.equal(report.data.reduce((n,r)=>n+r.calls,0),1)
  }finally{await context.close()}
 }
 passed=true
 }finally{await browser.close();await runtime.close(passed)}
}
