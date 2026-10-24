import assert from 'node:assert/strict'
import {createServer} from 'node:net'
import {createServer as createHttpServer} from 'node:http'
import {createHash,randomUUID} from 'node:crypto'
import {writeFile} from 'node:fs/promises'
import {createConfiguredMailRuntime,mailReceipts} from '../configured-mail-runtime.mjs'
import {evidence,launchBrowser,viewports} from '../../journeys/kit/browser.mjs'

const freePort=async()=>{const socket=createServer();await new Promise(done=>socket.listen(0,'127.0.0.1',done));const port=socket.address().port;await new Promise(done=>socket.close(done));return port}
const sha=value=>createHash('sha256').update(value).digest('hex')
// The bounds a visitor can notice (src/modules/collaboration/presence.ts, the widget's live re-check): a closed
// dashboard lingers 10 seconds, an unrefreshed entry 90, and an open widget asks again every 30.
const CLOSE_GRACE_MS=10_000,ONLINE_TTL_MS=90_000,WIDGET_RECHECK_MS=30_000,SLACK_MS=15_000

// Two teammates with the dashboard open (the owner at 1440, an agent at 390) and a visitor whose widget is open on the
// workspace's own site, against the emitted Worker: online, away once both leave, back when one returns, the entry a
// Worker restart leaves behind expiring on its own, and the lead's setting in Settings -> Availability.
export async function presenceBrowserJourney(){
 const apiPort=await freePort(),api=`http://127.0.0.1:${apiPort}`,runtime=await createConfiguredMailRuntime({port:apiPort,workerFirst:true,vars:{APP_ORIGIN:api}})
 const site=`http://127.0.0.1:${await freePort()}`,shot=await evidence('widget-presence'),checks=[]
 let browser,server,success=false
 try{
  const json=async(path,{token,body,method=body===undefined?'GET':'POST'}={})=>{const response=await fetch(api+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});assert.ok(response.ok,`${method} ${path}: ${response.status} ${await response.clone().text()}`);return response.json()}
  const owner=await json('/api/identity/bootstrap',{body:{password:'synthetic-presence-owner-password-2026',name:'Northwind Support',ownerName:'Ana Ortiz',email:'ana@example.test',allowedOrigin:site}}),p=owner.projectId
  const project=await json(`/api/identity/projects/${p}`,{token:owner.token})
  // The second teammate: an agent with a live session (invitation acceptance is the identity journey's).
  const agent={id:randomUUID(),token:randomUUID()},now=Date.now()
  await runtime.execute(`INSERT INTO users(id,email,name,created_at) VALUES('${agent.id}','bo@example.test','Bo Chen',${now}); INSERT INTO memberships(project_id,user_id,role) VALUES('${p}','${agent.id}','operator'); INSERT INTO sessions(token_hash,actor_id,project_id,role,expires_at) VALUES('${sha(agent.token)}','${agent.id}','${p}','operator',${now+3600000}); INSERT INTO session_factors(token_hash,user_id,method,verified_at) VALUES('${sha(agent.token)}','${agent.id}','password',${now});`)
  const online=async()=>(await json(`/api/management/projects/${p}/presence`,{token:owner.token})).data.online.map(person=>person.name).sort()
  const availability=async()=>(await json(`/api/widget/settings?widgetKey=${encodeURIComponent(project.widget_key)}`)).availability
  const until=async(check,timeout,message)=>{const deadline=Date.now()+timeout;for(;;){const value=await check();if(value)return value;if(Date.now()>deadline)throw new Error(`Timed out: ${message} (online: ${JSON.stringify(await online())})`);await new Promise(done=>setTimeout(done,250))}}

  server=createHttpServer((request,response)=>{response.setHeader('Content-Type','text/html; charset=utf-8');response.end(`<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="background:#eef1f6"><h1>Northwind outdoor gear</h1><script src="${api}/widget.js"></script><script>h2h("init",${JSON.stringify({widgetKey:project.widget_key,apiOrigin:api,open:true,settings:{collector:{enabled:false}}})})</script></body></html>`)})
  await new Promise(done=>server.listen(Number(new URL(site).port),'127.0.0.1',done))
  browser=await launchBrowser()
  const errors=[],watch=page=>page.on('pageerror',error=>errors.push(error.message))
  const dashboard=async(token,viewport,path=`/projects/${p}/conversations`)=>{const context=await browser.newContext({viewport});await context.addCookies([{name:'h2h_session',value:token,url:api}]);const page=await context.newPage();watch(page);await page.goto(api+path);return {context,page}}

  // Both teammates open the dashboard: each counts as online.
  const ana=await dashboard(owner.token,viewports.desktop),bo=await dashboard(agent.token,viewports.mobile)
  await ana.page.locator('#chat').waitFor();await bo.page.locator('#chat').waitFor()
  await until(async()=>JSON.stringify(await online())===JSON.stringify(['Ana Ortiz','Bo Chen']),15_000,'both teammates online')
  await ana.page.screenshot({path:shot('dashboard-owner-1440.png')});await bo.page.screenshot({path:shot('dashboard-agent-390.png')})
  checks.push('the owner (1440) and an agent (390) with the dashboard open are both online')

  // The visitor's open widget: the team is available, with its usual reply time and no away notice.
  const visitorContext=await browser.newContext({viewport:viewports.desktop}),visitor=await visitorContext.newPage();watch(visitor)
  await visitor.goto(site);await visitor.locator('textarea[name=content]').waitFor()
  const notice=visitor.locator('.happytohelp-away-notice'),header=visitor.locator('.happytohelp-insight-agent-info')
  await header.filter({hasText:'Responds within 24 hours'}).first().waitFor();assert.equal(await notice.count(),0)
  const both=async name=>{await visitor.setViewportSize(viewports.desktop);await visitor.waitForTimeout(300);await visitor.screenshot({path:shot(`${name}-1440.png`)});await visitor.setViewportSize(viewports.mobile);await visitor.waitForTimeout(300);assert.ok(await visitor.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${name}: no horizontal scroll at 390`);await visitor.screenshot({path:shot(`${name}-390.png`)});await visitor.setViewportSize(viewports.desktop)}
  await both('widget-online');checks.push('with a teammate online the widget shows the usual reply time and no away notice')

  const responseTime='Responds within two business days'
  await json(`/api/management/projects/${p}/widget-settings`,{token:owner.token,method:'PUT',body:{text:{ai:{human_response:responseTime}}}})
  await visitor.reload();await header.filter({hasText:responseTime}).first().waitFor()

  // The owner leaves: the agent keeps the team available. The agent leaves too: the open widget turns to the away
  // notice and email field by itself, within the close grace and its 30-second re-check.
  await ana.context.close()
  await until(async()=>JSON.stringify(await online())===JSON.stringify(['Bo Chen']),CLOSE_GRACE_MS+SLACK_MS,'the owner leaves')
  assert.equal((await availability()).available,true,'one teammate online keeps the team available')
  const left=Date.now();await bo.context.close()
  await notice.waitFor({timeout:CLOSE_GRACE_MS+WIDGET_RECHECK_MS+SLACK_MS})
  checks.push(`nobody online: the open widget turned away by itself ${Math.round((Date.now()-left)/1000)} s after the last teammate left`)
  assert.ok((await notice.innerText()).includes(responseTime),'the away notice shows the configured response estimate')
  await header.filter({hasText:responseTime}).first().waitFor()
  const email=visitor.locator('input[name=email]');await email.waitFor();await visitor.getByText("We'll email our reply to this address.",{exact:true}).waitFor()
  await both('widget-away-by-presence')
  await email.fill('night-owl@example.test');await email.press('Enter')
  await notice.filter({hasText:"We'll reply here and email you at night-owl@example.test."}).waitFor()
  await visitor.locator('textarea[name=content]').fill('Do you ship tents to Norway?');await visitor.locator('button[name=submit]').click()
  const awayReply=visitor.locator('.happytohelp-chat-message').filter({hasText:"Thanks for your message. Northwind Support is away right now. We'll reply here and by email. Responds within two business days"})
  await awayReply.waitFor()
  await visitor.locator('textarea[name=content]').fill('Order 5521, if that helps.');await visitor.locator('button[name=submit]').click()
  await visitor.getByText('Order 5521, if that helps.',{exact:true}).waitFor()
  const session=await visitor.evaluate(()=>Object.entries(localStorage).map(([key,value])=>key.startsWith('rer-widget:')?JSON.parse(value):null).find(Boolean))
  // The widget shows a message as it sends; the inbox has it once it commits.
  const transcript=await until(async()=>{const read=await json(`/api/conversations/${session.conversationId}/messages`,{token:owner.token});return read.messages.length===3&&read},10_000,'the second message committed')
  assert.deepEqual(transcript.messages.map(message=>message.actor_role),['contact','system','contact'],'one away reply, and the conversation is in the inbox');assert.equal(await awayReply.count(),1)
  await both('widget-away-reply');checks.push('the visitor left an email and got the away reply once')

  // The agent comes back: the widget is available again within its re-check, and the answer reaches the visitor and
  // their email.
  const back=await dashboard(agent.token,viewports.mobile),returned=Date.now();await back.page.locator('#chat').waitFor()
  await notice.waitFor({state:'detached',timeout:WIDGET_RECHECK_MS+SLACK_MS})
  checks.push(`a teammate opening the dashboard turned the widget available ${Math.round((Date.now()-returned)/1000)} s later`)
  await header.filter({hasText:responseTime}).first().waitFor()
  const answer=await json(`/api/conversations/${session.conversationId}/messages`,{token:agent.token,body:{localId:'presence-answer',content:'Yes, we ship tents to Norway within five days.',expectedRevision:transcript.revision,expectedLastMessageId:transcript.lastMessageId}})
  assert.equal(answer.accepted,true);await visitor.getByText('Yes, we ship tents to Norway within five days.',{exact:true}).waitFor()
  const mailed=async()=>(await json(`/api/dashboard/projects/${p}/conversations/${session.conversationId}/buckets`,{token:owner.token})).data.flatMap(bucket=>bucket.messages).find(message=>message.id===answer.message.id)?.email_status?.state==='sent'
  await until(mailed,10_000,'the answer is accepted by the mail provider fake')
  assert.ok(mailReceipts(runtime).some(receipt=>[].concat(receipt.to).includes('night-owl@example.test')&&receipt.text?.includes('Yes, we ship tents to Norway within five days.')),'the mail boundary receives the answer text addressed to the captured visitor email')
  await both('widget-back-online')
  checks.push('back online: the answer reached the widget; the mail provider fake observed the captured email recipient and exact answer text')

  await json(`/api/management/projects/${p}/settings`,{token:owner.token,method:'PUT',body:{is_available:false}})
  await visitorContext.clearCookies();await visitor.evaluate(()=>localStorage.clear());await visitor.reload()
  await notice.waitFor();assert.ok((await notice.innerText()).includes(responseTime))
  await header.filter({hasText:responseTime}).first().waitFor()
  await both('widget-accept-off')
  await visitor.locator('textarea[name=content]').fill('Can I leave a request while acceptance is off?');await visitor.locator('button[name=submit]').click()
  await visitor.locator('.happytohelp-chat-message').filter({hasText:responseTime}).waitFor()
  await both('widget-accept-off-reply')
  await json(`/api/management/projects/${p}/settings`,{token:owner.token,method:'PUT',body:{is_available:true}})
  await notice.waitFor({state:'detached',timeout:WIDGET_RECHECK_MS+SLACK_MS})
  checks.push('with Accept new conversations off and a teammate online, notice, header and away reply show the configured response estimate at 1440/390')

  // A Worker restart while both are online, with the owner's tab closed while the Worker is down: every entry written
  // before the restart has expired 90 seconds later, so the agent, whose open dashboard reconnected and reported again,
  // is the only one online then, and the widget stays available.
  const again=await dashboard(owner.token,viewports.desktop);await again.page.locator('#chat').waitFor()
  await until(async()=>(await online()).length===2,15_000,'both online before the restart')
  const restarting=Date.now();await runtime.restart(()=>again.context.close())
  await new Promise(done=>setTimeout(done,Math.max(0,restarting+ONLINE_TTL_MS+2000-Date.now())))
  assert.deepEqual(await online(),['Bo Chen'],'90 seconds after a restart only the reconnected dashboard is online')
  assert.equal(await notice.count(),0,'the widget stayed available');assert.equal((await availability()).available,true)
  checks.push('after a Worker restart the agent\'s reconnected dashboard kept the team online and the entry of the owner\'s dashboard, closed while the Worker was down, expired within 90 seconds')
  // The agent leaves: the open widget turns away again within the close grace and its re-check.
  const leaving=Date.now();await back.context.close()
  await notice.waitFor({timeout:CLOSE_GRACE_MS+WIDGET_RECHECK_MS+SLACK_MS})
  checks.push(`the last teammate leaving after the restart turned the widget away ${Math.round((Date.now()-leaving)/1000)} s later`)

  // Settings -> Availability: the lead sees who is online and turns presence-based away off and on again; each change
  // is in the security log.
  const lead=await dashboard(owner.token,viewports.desktop,`/projects/${p}/settings`)
  await until(async()=>JSON.stringify(await online())===JSON.stringify(['Ana Ortiz']),15_000,'the lead is online')
  await lead.page.getByRole('button',{name:'Availability',exact:true}).click()
  const toggle=lead.page.getByLabel('Show away when no teammate is online',{exact:true});await toggle.waitFor();assert.equal(await toggle.isChecked(),true,'on by default')
  assert.equal(await lead.page.getByLabel('A teammate counts as away after',{exact:true}).inputValue(),'15')
  await lead.page.getByRole('status').filter({hasText:'Right now:'}).filter({hasText:'Online now: Ana Ortiz.'}).waitFor()
  await lead.page.screenshot({path:shot('settings-availability-1440.png'),fullPage:true})
  await lead.page.setViewportSize(viewports.mobile);await lead.page.waitForTimeout(300);await lead.page.screenshot({path:shot('settings-availability-390.png'),fullPage:true});await lead.page.setViewportSize(viewports.desktop)
  const update=async()=>{await lead.page.getByRole('button',{name:'Update',exact:true}).click();await lead.page.getByText('Saved.',{exact:true}).waitFor()}
  await toggle.uncheck();await update()
  assert.equal((await availability()).live,false,'with it off the widget no longer follows presence')
  await toggle.check();await lead.page.getByLabel('A teammate counts as away after',{exact:true}).selectOption('30');await update()
  const log=(await json(`/api/management/projects/${p}/audit`,{token:owner.token})).data.filter(event=>event.action==='availability.presence_changed').map(event=>event.detail)
  assert.deepEqual(log,[{from:'Off, 15 min idle',to:'On, 30 min idle'},{from:'On, 15 min idle',to:'Off, 15 min idle'}])
  await lead.page.goto(`${api}/projects/${p}/security-log`);await lead.page.getByText('Away when nobody is online changed').first().waitFor()
  await lead.page.screenshot({path:shot('security-log-1440.png'),fullPage:true})
  checks.push('the setting is on by default, shows who is online, turns off and on, and each change is in the security log')
  assert.deepEqual(errors,[])
  await writeFile(shot('presence.json'),JSON.stringify({checks},null,2))
  success=true
 }finally{
  if(browser)await browser.close()
  server?.close()
  await runtime.close(success)
 }
}
