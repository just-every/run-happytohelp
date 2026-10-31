import {createServer} from 'node:net'
import assert from 'node:assert/strict'
import {createSites} from '../site-read-sites.mjs'
import {startApp} from '../../journeys/kit/app.mjs'
import {createRuntime} from '../emitted-runtime.mjs'
import {launchBrowser,evidence,viewports} from '../../journeys/kit/browser.mjs'

// The only substitutes are website/DNS and mail provider responses. All setup,
// provisioning, settings, sessions and widget admission use the public doors.
const sites=createSites()
export default async function networkEdge(request){
 const url=new URL(request.url)
 if(url.hostname==='api.resend.com')return Response.json(request.method==='POST'?{id:crypto.randomUUID()}:{data:[],has_more:false})
 if(['cloudflare-dns.com','acme.example.com'].includes(url.hostname))return sites.handler(request)
 throw Error('Unexpected first-run network edge: '+url.hostname)
}

export async function firstRunOutcomes(){
 await routeOutcomes()
 await builtOutcomes()
}

async function routeOutcomes(){
 const mail=[],app=await startApp({captureQueue:true,bindings:{H2H_SETUP_TOKEN:'synthetic-outcomes-claim',APP_ORIGIN:'https://app.example',REGISTRATION_ENABLED:'true',EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'synthetic-outcomes-mail',EMAIL_FROM:'support@installation.test'},outbound:async request=>{
  if(new URL(request.url).hostname==='api.resend.com'&&request.method==='POST'){mail.push(await request.json());return Response.json({id:crypto.randomUUID()})}
  return networkEdge(request)
 }})
 try{
  const owner=(await app.call('/api/identity/bootstrap',{body:{email:'owner@company.com',password:'synthetic-outcomes-password',allowedOrigin:'https://desk.account.workers.dev',setupToken:'synthetic-outcomes-claim'},status:201})).data
  const get=async(id,path,token=owner.token)=>(await app.call(`/api/management/projects/${id}/${path}`,{token,status:200})).data.data
  assert.equal((await get(owner.projectId,'settings')).name,'My workspace','a workers.dev deployment is never the business name, even with a company email')
  assert.ok(!(await get(owner.projectId,'email-settings'))?.inbound_address,'no inbound credential means no provisioned mailbox')
  await app.configure({INBOUND_EMAIL_TOKEN:'synthetic-outcomes-inbound'})
  await app.call('/api/identity/register',{body:{email:'registered@example.test',name:'Registered Owner',projectName:'Registered Support',allowedOrigin:'https://registered.example.test',password:'synthetic-registered-password'},status:202})
  const link=mail.find(item=>item.subject==='Verify your HappyToHelp email').text.match(/https:\/\/\S+/)[0]
  const verified=(await app.call('/api/identity/verify-email',{body:{token:new URL(link).searchParams.get('token')},status:200})).data
  const signed=(await app.call('/api/identity/login',{body:{email:'registered@example.test',password:'synthetic-registered-password'},status:200})).data
  const settings=await get(verified.projectId,'settings',signed.token),ais=await get(verified.projectId,'ais',signed.token),email=await get(verified.projectId,'email-settings',signed.token)
  assert.equal(ais.length,1);assert.equal(settings.default_visitor_ai_id,ais[0].id);assert.ok(ais[0].is_enabled)
  assert.ok(email.inbound_address);assert.equal(email.from_address,'support@installation.test','installation sender is retained until domain verification')
 }finally{await app.close()}
}

async function builtOutcomes(){
 const reservation=createServer();await new Promise(done=>reservation.listen(0,'127.0.0.1',done))
 const port=reservation.address().port;await new Promise(done=>reservation.close(done))
 const runtime=await createRuntime({port,queueConsumers:true,vars:{APP_ORIGIN:`http://127.0.0.1:${port}`,EMAIL_PROVIDER:'resend',EMAIL_API_KEY:'synthetic-outcomes-mail',EMAIL_FROM:'support@installation.test',INBOUND_EMAIL_TOKEN:'synthetic-outcomes-inbound'},outboundFixture:import.meta.url})
 const browser=await launchBrowser(),context=await browser.newContext({viewport:viewports.desktop}),page=await context.newPage(),shot=await evidence('first-run-outcomes'),errors=[]
 page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message))
 let passed=false
 const api=async(path,body,method=body===undefined?'GET':'POST')=>{const response=await context.request.fetch(runtime.origin+path,{method,...(body===undefined?{}:{data:body})});assert.ok(response.ok(),`${method} ${path}: ${response.status()}`);return response.json()}
 const setup=async id=>{await page.waitForURL(url=>url.pathname===`/projects/${id}/activation`);await page.locator('[data-need="widget_seen"] [data-field="snippet"]').waitFor();assert.equal(await page.locator('.sl-needs > li').first().getAttribute('data-need'),'widget_seen','Setup leads with installation');await page.getByRole('heading',{name:'What we’ve set',exact:true}).waitFor()}
 // Assertions use desktop unless the outcome specifically requires a phone.
 // Proof captures each changed screen once at both widths without a test matrix.
 const proof=async name=>{await page.screenshot({path:shot(name+'-1440.png'),fullPage:true});await page.setViewportSize(viewports.mobile);await page.screenshot({path:shot(name+'-390.png'),fullPage:true});await page.setViewportSize(viewports.desktop)}
 try{
  await page.goto(runtime.origin+'/setup')
  await page.getByLabel('Your email',{exact:true}).fill('first@acme.example.com')
  await page.getByLabel('Password',{exact:true}).fill('synthetic-outcomes-password')
  await page.getByLabel('Your website',{exact:true}).fill('https://acme.example.com')
  await page.getByRole('button',{name:'Create workspace',exact:true}).click()
  await page.waitForURL(url=>/^\/projects\/[^/]+\/activation$/.test(url.pathname))
  const first=await api('/api/identity/session'),P=`/api/management/projects/${first.projectId}`
  await setup(first.projectId)
  const settings=async()=>(await api(P+'/settings')).data
  const deadline=Date.now()+30000
  while((await settings()).site_read?.state!=='done'&&Date.now()<deadline)await new Promise(done=>setTimeout(done,150))
  assert.equal((await settings()).site_read.state,'done','the real website-read queue finishes before inspecting derived values')
  assert.equal((await settings()).name,'Acme Widgets & Co');assert.equal((await settings()).primary_color,'#1a7f64')
  const ais=(await api(P+'/ais')).data,email=(await api(P+'/email-settings')).data
  assert.equal(ais.length,1);assert.equal((await settings()).default_visitor_ai_id,ais[0].id)
  assert.ok(email.inbound_address);assert.equal(email.from_address,'support@installation.test')
  const ai=page.locator('[data-need="model_key"]');await ai.getByRole('button',{name:'Show me how',exact:true}).click()
  assert.match(await ai.innerText(),/Without a key, every conversation stays with your team/)
  const snippet=await page.locator('[data-need="widget_seen"] [data-field="snippet"]').innerText()
  assert.ok(snippet.includes(runtime.origin+'/widget.js'),'the supplied snippet points at this installation');assert.match(snippet,/<script src=/);assert.doesNotMatch(snippet,/verificationSecret|serverSecret/)
  await proof('first-owner-setup')
  await page.locator('[data-need="widget_seen"] [data-skip]').click()
  await page.locator('[data-skipped="widget_seen"] [data-undo]').waitFor()
  await page.goto(`${runtime.origin}/projects/${first.projectId}/edit`)
  assert.equal(await page.getByLabel('Name',{exact:true}).inputValue(),'Acme Widgets & Co')
  await page.getByLabel('Name',{exact:true}).fill('Acme Care')
  await page.getByRole('button',{name:'Update',exact:true}).click();await page.getByRole('status').filter({hasText:'Saved.'}).waitFor()
  await page.reload();assert.equal(await page.getByLabel('Name',{exact:true}).inputValue(),'Acme Care')
  await page.getByRole('button',{name:'Appearance',exact:true}).click()
  assert.equal(await page.getByLabel('Workspace color hex',{exact:true}).inputValue(),'#1a7f64')
  await page.getByLabel('Workspace color hex',{exact:true}).fill('#2548aa')
  await page.getByRole('button',{name:'Update',exact:true}).click();await page.getByRole('status').filter({hasText:'Saved.'}).waitFor()
  await page.reload();await page.getByRole('button',{name:'Appearance',exact:true}).click()
  assert.equal(await page.getByLabel('Workspace color hex',{exact:true}).inputValue(),'#2548aa')
  await page.goto(`${runtime.origin}/projects/${first.projectId}/widget-settings`)
  await page.getByText('Advanced',{exact:true}).click();await page.getByRole('heading',{name:'Server secret',exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'Reveal server secret',exact:true}).isEnabled(),true)
  await page.getByRole('tablist',{name:'Verification example language'}).waitFor()
  assert.match(await page.locator('#widget-code-verification-example').innerText(),/HMAC|hash_hmac|createHmac/i)
  await proof('widget-advanced')
  await page.goto(`${runtime.origin}/projects/${first.projectId}/ais`)
  await page.getByTestId('ai-key-status').waitFor();assert.equal(await page.getByTestId('ai-key-status').getAttribute('data-state'),'missing')
  assert.match(await page.getByTestId('ai-key-status').innerText(),/new conversations stay with your team/)
  await page.goto(runtime.origin+'/projects/create')
  await page.getByLabel('Name',{exact:true}).fill('Wholesale support');await page.getByLabel('Website',{exact:true}).fill('https://wholesale.example.test');await page.getByLabel('Widget website origin',{exact:true}).fill('https://wholesale.example.test')
  await page.getByRole('button',{name:'Create project',exact:true}).click()
  await page.waitForURL(url=>/^\/projects\/[^/]+\/activation$/.test(url.pathname))
  const second={id:new URL(page.url()).pathname.split('/')[2]};await setup(second.id);await proof('signed-in-setup')
  const secondSettings=(await api(`/api/management/projects/${second.id}/settings`)).data
  assert.ok(secondSettings.default_visitor_ai_id);assert.notEqual(secondSettings.default_visitor_ai_id,ais[0].id)
  assert.ok((await api(`/api/management/projects/${second.id}/email-settings`)).data.inbound_address)
  await page.setViewportSize(viewports.mobile)
  await page.getByRole('button',{name:'Switch workspace: Wholesale support',exact:true}).click()
  await page.getByRole('button',{name:'Acme Care',exact:true}).click()
  await page.waitForURL(url=>url.pathname===`/projects/${first.projectId}/conversations`)
  await page.getByRole('button',{name:'Switch workspace: Acme Care',exact:true}).waitFor()
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'mobile workspace header fits')
  await page.getByRole('button',{name:'Switch workspace: Acme Care',exact:true}).click();await page.getByRole('button',{name:'Wholesale support',exact:true}).click()
  await page.waitForURL(url=>url.pathname===`/projects/${second.id}/conversations`)
  await page.getByRole('button',{name:'Switch workspace: Wholesale support',exact:true}).waitFor()
  await page.setViewportSize(viewports.desktop)
  // Install the exact supplied snippet on the customer's website. Only the
  // customer's HTML is supplied at the network edge; widget/API calls are real.
  const visitor=await browser.newContext({viewport:viewports.desktop,permissions:['local-network-access']}),widget=await visitor.newPage()
  try{
   await widget.route('https://acme.example.com/support-proof',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><body>${snippet}</body></html>`}))
   await widget.goto('https://acme.example.com/support-proof')
   await widget.waitForFunction(()=>typeof window.h2h==='function'&&window.h2hQueue?.length===0)
   await widget.evaluate(()=>window.h2h('open'))
   const sent=widget.waitForResponse(response=>/\/api\/conversations\/[^/]+\/messages$/.test(new URL(response.url()).pathname)&&response.request().method()==='POST')
   await widget.locator('textarea[name=content]').fill('Please help with my order')
   await widget.locator('button[name=submit]').click()
   const receipt=await sent;assert.equal(receipt.status(),200,'the installed widget receives a durable message receipt')
   const conversationId=new URL(receipt.url()).pathname.split('/')[3]
   const conversation=(await api(`/api/dashboard/projects/${first.projectId}/conversations/${conversationId}`)).data
   assert.equal(conversation.project_id,first.projectId,'the installed widget creates a real conversation in this workspace')
   assert.equal(conversation.ai,null,'without a model key the installed widget leaves its visitor with the team')
   await widget.screenshot({path:shot('installed-widget-1440.png'),fullPage:true})
   await widget.setViewportSize(viewports.mobile)
   await widget.screenshot({path:shot('installed-widget-390.png'),fullPage:true})
   assert.deepEqual(errors,[])
  }finally{await visitor.close()}
  passed=true
 }finally{await context.close();await browser.close();await runtime.close(passed)}
}
