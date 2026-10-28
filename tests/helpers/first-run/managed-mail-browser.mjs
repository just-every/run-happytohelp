import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {mkdir} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createRuntime} from '../../activation/browser-runtime.mjs'
import {launchBrowser,viewports} from '../../journeys/kit/browser.mjs'
import {managedEdge,ingressOptions,inboundPath,mime} from '../email/rer-edge.mjs'

export async function managedMailBrowser(){
 const directory=resolve(process.env.H2H_EVIDENCE_DIR||'test-results/managed-mail');await mkdir(directory,{recursive:true})
 const edge=managedEdge(),assigned=edge.add('browser'),server=createServer(async(req,res)=>{
  try{
   const url=new URL(new URL(req.url,'http://fixture.example').searchParams.get('provider')),chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks).toString()
   if(url.hostname==='northstar.example.test'){res.writeHead(200,{'content-type':url.pathname==='/robots.txt'?'text/plain':'text/html'});res.end(url.pathname==='/robots.txt'?'User-agent: *\nAllow: /':'<html><head><title>Northstar Outfitters</title></head><body><h1>Northstar Outfitters</h1><p>Outdoor equipment and order support.</p></body></html>');return}
   const response=await edge.outbound(new Request(url,{method:req.method,headers:req.headers,...(body?{body}:{})}),{url:url.href,body})
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()))
  }catch{res.destroy()}
 });await new Promise((done,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',done)})
 const fixtureOrigin=`http://127.0.0.1:${server.address().port}`
 let runtime,browser,success=false
 const errors=[]
 try{
  runtime=await createRuntime({providerFixtureOrigin:fixtureOrigin,providerHosts:['mail-service.example.test','northstar.example.test'],vars:assigned,queueConsumers:true})
  browser=await launchBrowser();const context=await browser.newContext({viewport:viewports.desktop}),page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message))
  await page.goto(runtime.origin+'/setup');await page.getByLabel('Your email',{exact:true}).fill('owner-browser@example.test');await page.getByLabel('Password',{exact:true}).fill('synthetic-managed-browser-password');await page.getByLabel('Setup token',{exact:true}).fill(assigned.H2H_SETUP_TOKEN);await page.getByLabel('Your website',{exact:true}).fill('https://northstar.example.test')
  assert.equal(await page.locator('input[name*=MAIL],select[name*=MAIL]').count(),0,'first owner has no mail fields')
  await page.getByRole('button',{name:'Create workspace',exact:true}).click();await page.waitForURL(/\/projects\/[^/]+\/activation/)
  const projectId=new URL(page.url()).pathname.split('/')[2]
  const api=async(path,body,method=body===undefined?'GET':'POST')=>{const result=await page.evaluate(async({path,body,method})=>{const response=await fetch(path,{method,headers:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:response.status,data:await response.json()};},{path,body,method});assert.ok(result.status>=200&&result.status<300,JSON.stringify(result));return result.data}
  const screenshot=async(name)=>{await page.evaluate(()=>window.scrollTo(0,0));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,name+' horizontal overflow');await page.screenshot({path:join(directory,name+'.png'),fullPage:true})}
  const emailPath=`/projects/${projectId}/email-settings`
  for(const [name,viewport] of Object.entries(viewports)){
   await page.setViewportSize(viewport);await page.goto(runtime.origin+`/projects/${projectId}/activation`);await page.getByText(assigned.RER_MAIL_ADDRESS,{exact:false}).first().waitFor();await screenshot(name+'-setup')
   await page.goto(runtime.origin+emailPath);await page.getByRole('heading',{name:'Managed email',exact:true}).waitFor();await screenshot(name+'-email-waiting')
   const copy=await page.locator('.email-preferences').innerText();assert.ok(!/MAIL_|API_KEY|INBOUND_EMAIL_TOKEN/.test(copy));assert.equal(await page.getByRole('button',{name:'Update',exact:true}).count(),0)
   await page.getByText('Use your own email domain later',{exact:true}).click();await page.getByRole('button',{name:'Add mailbox',exact:true}).waitFor();const details=page.locator('details').filter({hasText:'Use your own email domain later'});assert.equal(await details.getAttribute('open'),'')
   await page.getByLabel('Email customers and your team about conversations',{exact:true}).uncheck();await page.getByRole('status',{name:'',exact:true}).filter({hasText:/Saved/}).first().waitFor();assert.equal(await details.getAttribute('open'),'','save refresh preserves open options')
   await page.getByLabel('Email customers and your team about conversations',{exact:true}).check();await page.getByText('Saved',{exact:true}).waitFor()
   await page.getByText('Use your own email domain later',{exact:true}).click()
  }
  const raw=mime({id:'synthetic-browser-intake',text:'My Northstar order arrived without its rain cover. Can you send a replacement?'}),response=await fetch(runtime.origin+inboundPath,ingressOptions(assigned,raw,{workspaceId:projectId}));assert.equal(response.status,200);const inbound=await response.json();assert.ok(inbound.conversationId)
  const changed=mime({id:'synthetic-browser-intake',text:'Changed bytes under the same delivery identity'}),held=await fetch(runtime.origin+inboundPath,ingressOptions(assigned,changed,{workspaceId:projectId}));assert.equal(held.status,200);assert.equal((await held.json()).state,'held')
  edge.loseResponse=true
  await page.getByRole('button',{name:'Send me a test',exact:true}).click();await page.getByRole('button',{name:'Check retained send receipt',exact:true}).waitFor()
  for(const [name,viewport] of Object.entries(viewports)){await page.setViewportSize(viewport);await screenshot(name+'-email-uncertain')}
  await page.getByRole('link',{name:'Review Suspended mail',exact:true}).click();await page.waitForURL(/\/suspended$/);await page.getByRole('heading',{name:'Suspended email',exact:true}).waitFor();await page.goto(runtime.origin+emailPath);await page.getByRole('button',{name:'Check retained send receipt',exact:true}).waitFor()
  const attempts=edge.sends.length;await page.getByRole('button',{name:'Check retained send receipt',exact:true}).click();await page.getByRole('button',{name:'Check retained send receipt',exact:true}).waitFor({state:'hidden'});assert.equal(edge.sends.length,attempts,'reconciliation never sends');edge.loseResponse=false
  await page.goto(runtime.origin+`/projects/${projectId}/conversations/${inbound.conversationId}`)
  await page.getByPlaceholder('Type your reply…').fill('We will send the missing rain cover today.')
  const replied=page.waitForResponse(response=>response.url().endsWith(`/conversations/${inbound.conversationId}/messages`)&&response.request().method()==='POST')
  await page.getByRole('button',{name:'Send',exact:true}).click();assert.equal((await replied).status(),200)
  await page.getByText('Email sent to provider · delivery not confirmed',{exact:true}).waitFor()
  const sent=edge.sends.find(row=>row.payload.text.includes('We will send the missing rain cover today.'));assert.ok(sent?.payload.replyTo)
  const back=mime({id:'synthetic-browser-followup',text:'Thank you, that resolves my order question.'}),backResponse=await fetch(runtime.origin+inboundPath,ingressOptions(assigned,back,{workspaceId:projectId,deliveryId:'synthetic-browser-followup',envelopeTo:sent.payload.replyTo,verdict:'unproven'}));assert.equal(backResponse.status,200);assert.equal((await backResponse.json()).conversationId,inbound.conversationId)
  await page.goto(runtime.origin+emailPath);await page.getByRole('heading',{name:'Managed email',exact:true}).waitFor()
  for(const [name,viewport] of Object.entries(viewports)){
   await page.setViewportSize(viewport);await screenshot(name+'-email-observed');await page.goto(runtime.origin+`/projects/${projectId}/conversations/${inbound.conversationId}`);await page.getByText('My Northstar order arrived without its rain cover. Can you send a replacement?',{exact:false}).first().waitFor();await screenshot(name+'-thread');await page.goto(runtime.origin+emailPath);await page.getByRole('heading',{name:'Managed email',exact:true}).waitFor()
  }
  edge.statusFailures=1
  await runtime.execute(`UPDATE rer_mailboxes SET route_check_next_at=0 WHERE project_id='${projectId}'`)
  assert.equal((await fetch(runtime.origin+'/cdn-cgi/local/scheduled')).status,200)
  const deadline=Date.now()+20000
  while(!(await api(`/api/management/projects/${projectId}/email-settings`)).managed.routeUncertain){if(Date.now()>deadline)throw new Error('Route check did not expose the failed read');await new Promise(done=>setTimeout(done,100))}
  await page.reload();await page.getByText('Active at last check',{exact:true}).waitFor();await page.getByText('Uncertain · retrying',{exact:true}).waitFor()
  for(const [name,viewport] of Object.entries(viewports)){await page.setViewportSize(viewport);await screenshot(name+'-email-route-uncertain')}
  await runtime.execute(`UPDATE rer_mailboxes SET route_check_next_at=0 WHERE project_id='${projectId}'`)
  assert.equal((await fetch(runtime.origin+'/cdn-cgi/local/scheduled')).status,200)
  while((await api(`/api/management/projects/${projectId}/email-settings`)).managed.routeUncertain){if(Date.now()>deadline)throw new Error('Route check did not recover');await new Promise(done=>setTimeout(done,100))}
  await page.reload();await page.getByText('Active',{exact:true}).waitFor();await page.getByText('Checked',{exact:true}).waitFor()
  edge.conflict=true
  const failed=await api('/api/management/projects',{name:'Northstar Warehouse',allowed_origin:'https://warehouse.example.test'})
  await page.goto(runtime.origin+`/projects/${failed.id}/email-settings`);await page.getByRole('button',{name:'Retry connection',exact:true}).waitFor()
  for(const [name,viewport] of Object.entries(viewports)){await page.setViewportSize(viewport);await screenshot(name+'-email-binding-failed')}
  edge.conflict=false;const retried=page.waitForResponse(response=>response.url().endsWith('/email-settings/managed/retry')&&response.request().method()==='POST');await page.getByRole('button',{name:'Retry connection',exact:true}).click();assert.equal((await retried).status(),200);await page.getByRole('button',{name:'Retry connection',exact:true}).waitFor({state:'hidden'});assert.ok((await api(`/api/management/projects/${failed.id}/email-settings`)).managed.routeActive)
  assert.deepEqual(errors,[]);success=true
  console.log('Managed browser screens checked at 1440 and 390:',directory)
 }finally{await browser?.close();await runtime?.close(success);await new Promise(done=>server.close(done))}
}
