import {feedbackBrowserJourney} from '../helpers/feedback/browser.mjs'
import {hubspotBrowser} from '../helpers/hubspot/browser.mjs';
import {runSteps} from './kit/steps.mjs';
import test,{before,after} from 'node:test'
import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {randomBytes} from 'node:crypto'
import {createRuntime} from '../helpers/emitted-runtime.mjs'
import {launchBrowser,evidence} from './kit/browser.mjs'

// API tokens, webhooks, Slack and the delivery log in the emitted Worker; only the network edge is a fixture.
let runtime,browser,shot,success=true;const records=[]
before(async()=>{runtime=await createRuntime({outboundFixture:new URL('../connections/browser-network.mjs',import.meta.url).href,vars:{INTEGRATION_ENCRYPTION_KEY:randomBytes(32).toString('base64')}});browser=await launchBrowser();shot=await evidence('connections')})
after(async()=>{await writeFile(shot('connections-browser.json'),JSON.stringify({records},null,2)).catch(()=>{});await browser?.close();await runtime?.close(success)})
async function audit(page,name){await page.addScriptTag({path:resolve('node_modules/axe-core/axe.min.js')});const violations=await page.evaluate(async()=>{const result=await axe.run();return result.violations.filter(x=>['serious','critical'].includes(x.impact)).map(x=>({id:x.id,impact:x.impact,targets:x.nodes.map(n=>n.target)}))});assert.deepEqual(violations,[],name);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' overflow');await page.screenshot({path:shot(name+'.png'),fullPage:true});records.push({name,violations})}

test(`at 1440 and 390px an owner creates and revokes a token, connects a webhook and Slack with secrets shown once, reads the delivery log, resends an uncertain delivery only after a duplicate warning, and connects HubSpot with explicit customer mapping, shared ticket context and revoked-authority refusal`,async()=>{await runSteps([1440,390].map(width=>[`${width}px`,async()=>{try{

  const owner=await runtime.seedTenant({name:'Connections workspace '+width,email:'connections-'+width+'@example.test'});
  const context=await browser.newContext({viewport:{width,height:1000}});await context.addCookies([{name:'h2h_session',value:owner.token,url:runtime.origin}]);const page=await context.newPage();page.setDefaultTimeout(20000);
  const open=section=>page.goto(runtime.origin+`/projects/${owner.projectId}/${section}`);
  await open('api-settings');await page.getByLabel('Token name',{exact:true}).fill('Browser token '+width);await page.getByLabel('contacts:read',{exact:true}).check();await page.getByRole('button',{name:'Create token',exact:true}).click();await page.getByRole('button',{name:'Dismiss token',exact:true}).click();assert.equal(await page.getByLabel('New token',{exact:true}).count(),0);await audit(page,'api-'+width);await page.getByRole('button',{name:'Revoke Browser token '+width,exact:true}).click();await page.getByText('Revoked',{exact:true}).first().waitFor();
  let fullToken;
  for(const [mode,scopes] of [['create',['conversations:create']],['append',['messages:append']],['read',['conversations:read']],['full',['conversations:create','messages:append','conversations:read']]]){
   await open('api-settings');await page.getByLabel('Token name',{exact:true}).fill('Synthetic '+mode+' '+width);
   await page.getByLabel('Source product',{exact:true}).fill('synthetic-hh-browser');
   for(const scope of scopes)await page.getByLabel(scope,{exact:true}).check();
   await page.getByText('Credential bindings',{exact:true}).click();await page.getByLabel('Brands (comma-separated IDs)',{exact:true}).fill(owner.projectId);
   await page.getByRole('button',{name:'Create token',exact:true}).click();
   const token=await page.getByLabel('New token',{exact:true}).inputValue();assert.ok(token.startsWith('int_'));if(mode==='full')fullToken=token;
   await page.getByRole('button',{name:'Dismiss token',exact:true}).click();assert.equal(await page.getByLabel('New token',{exact:true}).count(),0);
   const card=page.getByRole('article').filter({has:page.getByRole('heading',{name:'Synthetic '+mode+' '+width,exact:true})});await card.waitFor();assert.ok((await card.textContent()).includes('synthetic-hh-browser'));assert.ok((await card.textContent()).includes(owner.projectId));
  }
  const upload=await context.request.post(runtime.origin+'/api/v1/uploads',{headers:{Authorization:'Bearer '+fullToken,'Content-Type':'text/plain','X-Filename':'synthetic.txt'},data:'Synthetic browser attachment'});assert.equal(upload.status(),201);
  const created=await context.request.post(runtime.origin+'/api/v1/conversations',{headers:{Authorization:'Bearer '+fullToken,'Idempotency-Key':'synthetic-hh-browser-'+width},data:{requester:{external_id:'synthetic-hh-browser-'+width,name:'Synthetic requester'},subject:'Synthetic API browser request',body:'Synthetic API browser body',priority:'high',attachments:[{upload_id:(await upload.json()).data.id}],source_ref:{product:'synthetic-hh-browser',ref:'synthetic-hh-browser-'+width,url:'https://receiver.example.com/source'}}});assert.equal(created.status(),201);const apiTicket=(await created.json()).data;
  await open('api-settings');await page.getByText('via synthetic-hh-browser',{exact:false}).first().waitFor();
  const credentialCard=page.getByRole('article').filter({has:page.getByRole('heading',{name:'Synthetic full '+width,exact:true})});
  await page.getByLabel('Rotation overlap (seconds, up to 7 days)',{exact:true}).fill('60');await credentialCard.getByRole('button',{name:'Rotate Synthetic full '+width,exact:true}).click();await page.getByLabel('New token',{exact:true}).waitFor();await page.getByRole('button',{name:'Dismiss token',exact:true}).click();
  assert.equal(await credentialCard.count(),1);assert.equal(await credentialCard.locator('dt').filter({hasText:/^Secret /}).count(),2);await audit(page,'machine-credentials-'+width);
  await page.goto(runtime.origin+`/projects/${owner.projectId}/conversations/${apiTicket.id}`);await page.getByText('Synthetic API browser body',{exact:true}).first().waitFor();
  if(await page.locator('#conversation-assistant').getAttribute('aria-hidden')==='true')await page.getByRole('button',{name:'Show conversation panel',exact:true}).click();
  await page.getByRole('tab',{name:'Ticket',exact:true}).click();const backlink=page.getByRole('link',{name:'Open in synthetic-hh-browser',exact:true});await backlink.waitFor();assert.equal(await backlink.getAttribute('href'),'https://receiver.example.com/source');await audit(page,'machine-source-'+width);
  await context.route('https://receiver.example.com/source',route=>route.fulfill({status:200,contentType:'text/html',body:'<h1>Synthetic source request</h1>'}));
  const popupPromise=context.waitForEvent('page');await backlink.click();const popup=await popupPromise;await popup.getByRole('heading',{name:'Synthetic source request'}).waitFor();await popup.close();
  await open('webhook-settings');await page.getByLabel('Connection name',{exact:true}).fill('Browser webhook '+width);await page.getByLabel('HTTPS receiver URL',{exact:true}).fill('https://receiver.example.com/browser');await page.getByRole('button',{name:'Save connection',exact:true}).click();await page.getByRole('button',{name:'Dismiss secret',exact:true}).click();assert.equal(await page.getByLabel('Signing secret (hex)',{exact:true}).count(),0);await page.getByRole('button',{name:'Send test to Browser webhook '+width,exact:true}).click();await page.getByText('Test recorded. Check the delivery log for its outcome.',{exact:true}).waitFor();await audit(page,'webhooks-'+width);
  await open('slack-settings');await page.getByLabel('Connection name',{exact:true}).fill('Browser Slack '+width);await page.getByLabel('Slack connection type',{exact:true}).selectOption('incoming-webhook');await page.getByLabel('Slack incoming webhook URL',{exact:true}).fill('https://hooks.slack.com/services/synthetic-happytohelp-6/synthetic-happytohelp-7/synthetic-happytohelp-8');await page.getByRole('button',{name:'Save connection',exact:true}).click();await page.getByRole('button',{name:'Send test to Browser Slack '+width,exact:true}).waitFor();assert.equal(await page.getByLabel('Slack incoming webhook URL',{exact:true}).inputValue(),'');await audit(page,'slack-'+width);await page.getByRole('button',{name:'Send test to Browser Slack '+width,exact:true}).click();await page.getByText('Test recorded. Check the delivery log for its outcome.',{exact:true}).waitFor();
  await open('delivery-log');await page.getByText('Error class: webhook_rejected',{exact:true}).first().waitFor();await audit(page,'delivery-log-'+width);
  const settings=runtime.origin+`/api/management/projects/${owner.projectId}/connections`;
  await open('webhook-settings');await page.getByLabel('Connection name',{exact:true}).fill('Resend webhook '+width);await page.getByLabel('HTTPS receiver URL',{exact:true}).fill('https://receiver.example.com/browser-resend');await page.getByRole('button',{name:'Save connection',exact:true}).click();await page.getByRole('button',{name:'Dismiss secret',exact:true}).click();await page.getByRole('button',{name:'Send test to Resend webhook '+width,exact:true}).click();await page.getByText('Test recorded. Check the delivery log for its outcome.',{exact:true}).waitFor();
  const list=await (await context.request.get(settings+'/deliveries')).json(),original=list.data.find(row=>row.name==='Resend webhook '+width);assert.equal(original.state,'uncertain');
  await open('delivery-log');const card=page.getByRole('article').filter({has:page.getByRole('heading',{name:'Resend webhook '+width+' · integration.test',exact:true})});await card.first().waitFor();assert.equal(await card.count(),1);await card.getByRole('button',{name:'Resend uncertain webhook',exact:true}).click();await audit(page,'resend-warning-'+width);await card.getByRole('button',{name:'Cancel resend',exact:true}).click();assert.equal((await (await context.request.get(settings+'/deliveries')).json()).data.find(row=>row.id===original.id).attempts,1);
  await card.getByRole('button',{name:'Resend uncertain webhook',exact:true}).click();await card.getByRole('button',{name:'Resend despite duplicate risk',exact:true}).click();await page.getByText('Resend queued. Refresh the log to see its outcome.',{exact:true}).waitFor();assert.equal(await card.getByRole('button',{name:'Resend uncertain webhook',exact:true}).count(),0);await audit(page,'resend-queued-'+width);
  // Ordinary explicit tests run the real dispatcher. Use the rejecting receiver
  // to trigger dispatch without creating another uncertain delivery.
  const triggerDestination=list.data.find(row=>row.name==='Browser webhook '+width).destination_id;
  const dispatch=async()=>{const response=await context.request.post(settings+'/webhooks/'+triggerDestination+'/test',{data:{}});assert.equal(response.status(),202);await page.getByRole('button',{name:'Refresh delivery log',exact:true}).click();};
  await dispatch();await page.getByText('Attempt: 2 (HTTP 500)',{exact:false}).waitFor();assert.equal(await page.getByRole('button',{name:'Resend uncertain webhook',exact:true}).count(),1);assert.equal(await card.count(),1);await audit(page,'resend-uncertain-history-'+width);
  await page.getByRole('button',{name:'Resend uncertain webhook',exact:true}).click();await page.getByRole('button',{name:'Resend despite duplicate risk',exact:true}).click();await page.getByText('Resend queued. Refresh the log to see its outcome.',{exact:true}).waitFor();await dispatch();await page.getByText('Status: accepted',{exact:true}).first().waitFor();
  const after=(await (await context.request.get(settings+'/deliveries')).json()).data.filter(row=>row.id===original.id);assert.equal(after.length,3);assert.ok(after.every(row=>row.state==='accepted'));assert.equal(await page.getByRole('button',{name:'Resend uncertain webhook',exact:true}).count(),0);await audit(page,'resend-history-'+width);
  const freshResponse=await context.request.post(settings+'/webhooks/'+original.destination_id+'/test',{data:{}});assert.equal(freshResponse.status(),202);const fresh=await freshResponse.json();await page.getByRole('button',{name:'Refresh delivery log',exact:true}).click();await page.getByRole('button',{name:'Resend uncertain webhook',exact:true}).click();assert.equal((await context.request.delete(settings+'/webhooks/'+original.destination_id)).status(),200);await page.getByRole('button',{name:'Resend despite duplicate risk',exact:true}).click();await page.getByRole('alert').filter({hasText:'The original destination is unavailable or changed'}).waitFor();await audit(page,'resend-error-'+width);assert.equal((await (await context.request.get(settings+'/deliveries')).json()).data.find(row=>row.id===fresh.id).state,'uncertain');

  await (await import('../helpers/support-channels/browser.mjs')).channelsBrowser({page,context,runtime,owner,width,audit});
  await context.close()
}catch(error){success=false;throw error}}])); await hubspotBrowser({browser,directory:shot('hubspot')});})

import {startProviders} from '../helpers/escalations/providers.mjs'
import {exerciseEscalations} from '../helpers/escalations/browser.mjs'
test(`at 1440 and 390px selected engineering context reaches connected trackers, Slack and Teams, refused and uncertain handoffs stay visible, signed closure updates return as drafts, and an operator edits and sends the approved customer update`,async()=>{await runSteps([1440,390].map(width=>[`${width}px`,async()=>{
 const providers=await startProviders();let runtime,passed=false;
 try{runtime=await createRuntime({outboundFixture:new URL('../helpers/feedback/outbound.mjs',import.meta.url).href,vars:{INTEGRATION_ENCRYPTION_KEY:randomBytes(32).toString('base64')}});const owner=await runtime.seedTenant({name:'Engineering escalations '+width,email:`engineering-${width}@example.test`});const result=await exerciseEscalations({browser,origin:runtime.origin,owner,providers,width,directory:shot('escalations')});await result.context.close();if(width===1440)await feedbackBrowserJourney({browser,origin:runtime.origin,owner,width,directory:shot('feedback')});passed=true}finally{await runtime?.close(passed);await providers.close()}
}]))
})
