import assert from 'node:assert/strict'
import {createServer} from 'node:net'
import {createRuntime} from '../emitted-runtime.mjs'
import {launchBrowser,evidence,viewports} from '../../journeys/kit/browser.mjs'

const modelKey='synthetic-built-activation-model',mailKey='synthetic-built-activation-mail'
// The log is a network-edge counter retained by createRuntime across restarts.
// Losing a mail response happens only here, after the fake provider accepts it.
export default async function activationEdge(request){
 const url=new URL(request.url)
 if(url.hostname==='api.resend.com'){
  if(request.method==='POST'){console.log('ACTIVATION_MAIL_EDGE_ACCEPTED');throw Error('Lost provider response after acceptance')}
  if(url.pathname==='/domains')return Response.json({data:[],has_more:false})
 }
 if(url.hostname==='api.openai.com'){assert.equal(request.method,'GET');return Response.json({error:'Rejected credential'},{status:401})}
 throw Error('Unexpected built activation edge '+url.hostname)
}

export async function activationBrowserJourney(){
 const reservation=createServer();await new Promise(done=>reservation.listen(0,'127.0.0.1',done))
 const port=reservation.address().port;await new Promise(done=>reservation.close(done))
 const runtime=await createRuntime({port,vars:{APP_ORIGIN:`http://127.0.0.1:${port}`,OPENAI_API_KEY:modelKey,EMAIL_PROVIDER:'resend',EMAIL_API_KEY:mailKey,EMAIL_FROM:'support@installation.test'},outboundFixture:import.meta.url})
 const browser=await launchBrowser(),context=await browser.newContext({viewport:viewports.desktop}),page=await context.newPage(),shot=await evidence('activation'),responses=[],errors=[],responseErrors=[]
 page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message))
 const pending=new Set()
 page.on('response',response=>{if(new URL(response.url()).pathname.startsWith('/api/')){const read=Promise.all([response.text(),response.allHeaders()]).then(([text,headers])=>responses.push(text,JSON.stringify(headers)),error=>responseErrors.push({path:new URL(response.url()).pathname,error:error.message}));pending.add(read);read.then(()=>pending.delete(read))}})
 const api=async(path,body,status=200)=>{const response=await context.request.fetch(runtime.origin+path,{method:body===undefined?'GET':'POST',...(body===undefined?{}:{data:body})});const text=await response.text();responses.push(text,JSON.stringify(response.headers()));assert.equal(response.status(),status,text.slice(0,300));return JSON.parse(text)}
 const settled=async()=>{await page.waitForLoadState('networkidle');await Promise.all(pending);assert.deepEqual(responseErrors,[],'all browser API responses were collected before navigation')}
 const sends=()=>runtime.logs.split('ACTIVATION_MAIL_EDGE_ACCEPTED').length-1
 let passed=false
 try{
  const body={email:'owner@activation.test',password:'synthetic-activation-password',allowedOrigin:'https://activation.test'}
  const created=await api('/api/identity/bootstrap',body,201)
  assert.equal(created.welcomeEmail,'uncertain')
  const projectId=created.projectId,path=`/api/management/projects/${projectId}/activation`
  await page.goto(`${runtime.origin}/projects/${projectId}/activation`)
  const row=(data,id)=>data.steps.find(step=>step.id===id)
  const setup=async()=> (await api(path)).data
  await page.locator('[data-need="model_key"] [data-status="problem"]').waitFor()
  assert.equal(row(await setup(),'owner_mail').state,'unknown');assert.equal(sends(),1,'Create workspace attempted exactly one welcome mail')
  // Repeating Create workspace cannot recreate or resend the uncertain welcome.
  await api('/api/identity/bootstrap',body,409)
  const before=await setup(),list=page.getByTestId('setup-list')
  await page.locator('[data-need="widget_seen"] [data-skip]').click()
  const skipped=page.locator('[data-skipped="widget_seen"]');await skipped.waitFor()
  assert.equal(await skipped.locator('[data-field="state"]').innerText(),'Skipped')
  assert.equal(await list.getAttribute('data-confirmed'),String(before.done));assert.equal(await list.getAttribute('data-applicable'),String(before.applicableTotal-1))
  assert.equal(await page.locator('[data-need="widget_seen"]').count(),0)
  await settled();await page.reload();await skipped.waitFor()
  assert.equal(row(await setup(),'widget_seen').placement,'skipped')
  await skipped.locator('[data-undo]').click();await page.locator('[data-need="widget_seen"]').waitFor()
  await settled();await page.reload();await page.locator('[data-need="widget_seen"]').waitFor()
  assert.equal(row(await setup(),'widget_seen').placement,'needs_you')
  const rejectedSkip=page.waitForResponse(response=>response.url().endsWith('/activation/skip')&&response.ok())
  await page.locator('[data-need="model_key"] [data-skip]').click();await rejectedSkip
  await page.locator('[data-need="model_key"] [data-status="problem"]').waitFor()
  assert.equal(await page.locator('[data-skipped="model_key"]').count(),0,'rejected skipped key remains a problem under Needs you')
  assert.ok(await page.locator('[data-section="needs-you"] [data-need="model_key"]').count())
  assert.equal(sends(),1,'Setup checks, skip, undo and reload never replay welcome mail')
  // A new explicit test has a distinct durable identity, and also loses its response.
  assert.equal(row((await api(path+'/test-mail',{})).data,'owner_mail').state,'unknown')
  assert.equal(sends(),2)
  for(const restart of [false,true]){
   if(restart){await settled();await runtime.restart()}
   await settled();await page.reload();await page.locator('[data-need="model_key"] [data-status="problem"]').waitFor()
   await setup();await api(path+'/check',{auto:true});await api(path+'/test-mail',{})
   await api('/api/identity/bootstrap',body,409)
   assert.equal(sends(),2,'uncertain welcome and explicit test never replay after retry, reload or restart')
  }
  await page.locator('[data-need="model_key"] [data-status="problem"]').waitFor()
  const current=await setup()
  for(const step of current.steps.filter(step=>step.state!=='not_checked'))assert.ok(Number.isFinite(Date.parse(step.checkedAt)),'every observation has a time')
  assert.equal(await page.locator('time[datetime]').count()>0,true)
  // Read server-only digests from the isolated database solely as a leak denylist.
  const deliveries=await runtime.execute('SELECT id,state FROM email_deliveries')
  assert.match(deliveries,/welcome:/);assert.equal([...deliveries.matchAll(/"state":\s*"uncertain"/g)].length,2,'both durable uncertain deliveries survive restart')
  const output=await runtime.execute('SELECT fingerprint FROM activation_receipts')
  const fingerprints=[...output.matchAll(/"fingerprint":\s*"([a-f0-9]{64})"/g)].map(match=>match[1])
  assert.ok(fingerprints.length>0,'the leak test compares actual stored fingerprints')
  await settled()
  const html=await page.content(),storage=await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}}))
  const raw=await context.request.get(page.url())
  const persisted=await context.storageState({indexedDB:true})
  const exposed=[...responses,html,await raw.text(),JSON.stringify(raw.headers()),storage,JSON.stringify(persisted)].join('\n')
  for(const secret of [modelKey,mailKey,...fingerprints])assert.ok(!exposed.includes(secret),'keys and actual fingerprints never reach API responses, Setup HTML or browser storage')
  assert.doesNotMatch(exposed,/"fingerprint"|"fingerprints"/)
  // No UI changed in this clause; capture the exercised Setup once per proof width.
  await page.screenshot({path:shot('setup-1440.png'),fullPage:true})
  await page.setViewportSize(viewports.mobile);await page.screenshot({path:shot('setup-390.png'),fullPage:true})
  assert.deepEqual(errors,[])
  passed=true
 }finally{await context.close();await browser.close();await runtime.close(passed)}
}
