import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {browserRequest} from './browser-request.mjs';

export async function exerciseEscalations({browser,origin,owner,entryUrl,providers,width,directory,password,seedCount=40}){
 await mkdir(directory,{recursive:true});const context=await browser.newContext({viewport:{width,height:1000}});
 if(owner?.token)await context.addCookies([{name:'h2h_session',value:owner.token,url:origin}]);
 const page=await context.newPage();page.setDefaultTimeout(25000);let failure;
 try{
 if(entryUrl){const signed=page.waitForResponse(r=>new URL(r.url()).pathname==='/auth/dev/enter'&&r.status()>=300&&r.status()<400,{timeout:120000});await page.goto(entryUrl,{waitUntil:'domcontentloaded',timeout:120000});await (await signed).finished();await page.goto(origin+'/health',{waitUntil:'domcontentloaded'});console.log(`Escalation browser ${width}: owner entry complete`);}else await page.goto(origin+'/projects');
 const req=async(path,body,method=body===undefined?'GET':'POST')=>{const r=await browserRequest(page,origin+path,{method,json:body});assert.ok(r.ok,`${path}: ${r.status} ${JSON.stringify(r.data).slice(0,200)}`);return r.data};
 const session=await req('/api/identity/session');let projectId=owner?.projectId||session.projectId;
 if(entryUrl){const fresh=await req('/api/management/projects',{name:`Engineering escalation proof ${width}`,allowedOrigin:origin});projectId=fresh.id;await req('/api/identity/switch-project',{projectId});}
 const base=`/api/escalations/projects/${projectId}`,records=[];
 for(let offset=0;offset<seedCount;offset+=4)await Promise.all(Array.from({length:Math.min(4,seedCount-offset)},async(_,slot)=>{const n=offset+slot;
  const person=(await req(`/api/management/projects/${projectId}/contacts`,{name:`${['Maya Patel','Jordan Lee','Alex Rivera','Riley Brooks'][n%4]} ${n+1}`,email:`escalation-${width}-${n}@example.test`})).data;
  const ticket=await req('/api/conversations',{projectId,contactId:person.id});
  const first=await req(`/api/conversations/${ticket.id}/messages`,{localId:'opening',content:`Export ${n+1} stops at 82% when I include last month's orders. Can you help?`,expectedRevision:0});
  let file;
  if(n===0){
  await req(`/api/conversations/${ticket.id}/messages`,{localId:'excluded',content:'Unchosen account detail. Please keep this here.',expectedRevision:1});
  await req(`/api/dashboard/projects/${projectId}/conversations/${ticket.id}/notes`,{content:'Private note: internal investigation and customer account details.'});
  const upload=await browserRequest(page,origin+`/api/conversations/${ticket.id}/media`,{method:'POST',bytes:[...Buffer.from('Export progress: stopped at 82%; no customer records in this diagnostic.')],headers:{'Content-Type':'text/plain','X-Filename':'export-diagnostic.txt'}});assert.equal(upload.status,201);file=upload.data;
  await req(`/api/conversations/${ticket.id}/messages`,{localId:'file',content:'Diagnostic file for the export problem.',mediaIds:[file.id],expectedRevision:2});
  }
  records[n]={ticket,message:first.message,file,person};
 if(n%10===9)console.log(`Escalation browser ${width}: seeded ${n+1} tickets`);
 }));
 // Ticket › Escalations keeps links, handoffs, customer updates and connections; "+" › Escalate to engineering… creates.
 const compact=width<1280,assistant=page.locator('#conversation-assistant');
 const section=async()=>{if(await assistant.getAttribute('aria-hidden')==='true')await page.getByRole('button',{name:'Show conversation panel',exact:true}).click();await page.getByRole('tab',{name:'Ticket',exact:true}).click();const heading=page.locator('#ticket-section-escalations-heading');if(await heading.getAttribute('aria-expanded')!=='true')await heading.click();};
 const open=async r=>{await page.goto(origin+`/projects/${projectId}/conversations/${r.ticket.id}`);await page.getByLabel('Reply to conversation',{exact:true}).waitFor();await section();await page.getByRole('button',{name:'Refresh status',exact:true}).waitFor();};
 const panel=()=>page.locator('.escalations-panel');
 const dialog=()=>page.getByRole('dialog',{name:'Escalate to engineering'});
 // Below 1280px the panel is an overlay over the reply card: it steps aside for the "+".
 const escalate=async()=>{if(compact&&await assistant.getAttribute('aria-hidden')==='false'){await page.locator('.conversation-assistant__hide').click();await page.locator('#conversation-assistant[aria-hidden=true]').waitFor({state:'attached'});}await page.locator('#conversation-composer-tools').click();await page.getByRole('menuitem',{name:'Escalate to engineering…',exact:true}).click();await dialog().getByLabel('Destination',{exact:true}).waitFor();};
 const targets=[];
 const measureTargets=async(scope,stage)=>{
  const rows=await scope.locator('button:visible,input:not([type="checkbox"]):visible,select:visible,textarea:visible,summary:visible,a:visible,.escalation-choice:visible').evaluateAll((nodes,stage)=>nodes.map(node=>{
   const box=node.getBoundingClientRect(),style=getComputedStyle(node);
   return {stage,name:node.getAttribute('aria-label')||node.labels?.[0]?.textContent?.trim()||node.textContent.trim().replace(/\s+/g,' ').slice(0,80),width:box.width,height:box.height,outline:style.outline,shadow:style.boxShadow};
  }),stage);
  targets.push(...rows);console.log('Teams targets '+width+' '+JSON.stringify(rows));
  await writeFile(join(directory,`${width}-teams-targets.json`),JSON.stringify(targets,null,2));
  if(width===390)for(const row of rows)assert.ok(row.width>=44&&row.height>=44,`${stage}: ${row.name} target is ${row.width} by ${row.height}; phone controls need at least 44 pixels`);
 };
 const shot=async name=>{
  const target=name.startsWith('connection-')?panel().locator('.escalation-provider[open]').last():name.startsWith('preview-')?dialog().locator('.escalation-preview'):name==='closure-drafts'?panel().locator('.escalation-drafts'):panel().locator('.escalation-linked');
  const controls=target.locator('input:visible,button:visible,textarea:visible');
  if(name.startsWith('connection-')){await controls.first().scrollIntoViewIfNeeded();await page.screenshot({path:join(directory,`${width}-${name}-top.png`)});}
  if(await controls.count())await controls.last().scrollIntoViewIfNeeded();else await target.scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'document fits width');
  await page.screenshot({path:join(directory,`${width}-${name}.png`)});
 };
 await open(records[0]);await panel().locator('.escalation-connections > summary').click();
 for(const name of ['github','linear','jira','slack','teams']){
  const form=panel().locator('.escalation-provider').filter({has:page.locator(`button`).filter({hasText:`Save ${name==='github'?'GitHub':name==='jira'?'Jira':name==='slack'?'Slack':name==='teams'?'Teams':'Linear'} connection`})});
  await form.locator('summary').click();const p=providers[name];await form.locator('[name=target]').fill(p.target);await form.locator('[name=base_url]').fill(p.baseUrl);
  await form.locator('[name=token]').fill(name==='jira'?'synthetic-jira-token':p.token);
  if(name==='jira')await form.locator('[name=email]').fill('engineer@example.test');
  if(!['slack','teams'].includes(name))await form.locator('[name=webhook_secret]').fill(p.secret);
  // The local Jira fake accepts OAuth as well as the form's standard Basic token.
  if(name==='jira')p.authorizations.add('Basic '+Buffer.from('engineer@example.test:synthetic-jira-token').toString('base64'));
  await form.getByRole('button',{name:/Save .* connection/}).click();if(password&&name==='github'){const dialog=page.getByRole('dialog');await dialog.getByLabel('Your password',{exact:true}).waitFor();await page.screenshot({path:join(directory,`${width}-credential-step-up.png`)});await dialog.getByLabel('Your password',{exact:true}).fill(password);await dialog.getByRole('button',{name:'Confirm',exact:true}).click();}await form.getByText('Connected to',{exact:false}).waitFor();assert.equal(await form.locator('[name=token]').inputValue(),'');await shot('connection-'+name);if(name==='teams')await measureTargets(panel(),'connection');await form.locator('summary').click();
 }
 await panel().locator('.escalation-connections > summary').click();
 const links=[];
 for(const name of ['github','linear','jira']){
  await escalate();await dialog().getByLabel('Destination',{exact:true}).selectOption(name);await dialog().getByLabel('Issue title',{exact:true}).fill('Export progress stops at 82%');
  const checks=dialog().locator('.escalation-context input[type=checkbox]');assert.equal(await checks.evaluateAll(list=>list.filter(x=>x.checked).length),0);await checks.nth(0).check();await checks.last().check();
  await dialog().locator('.escalation-context').scrollIntoViewIfNeeded();await page.screenshot({path:join(directory,`${width}-selection-${name}.png`)});await dialog().getByRole('button',{name:'Preview selected context',exact:true}).click();await dialog().getByRole('region',{name:'Outgoing context preview'}).waitFor();assert.ok(!(await dialog().locator('.escalation-preview').innerText()).includes('Private note'));assert.ok(!(await dialog().locator('.escalation-preview').innerText()).includes('Unchosen account'));await shot('preview-'+name);
  // Sharing closes the dialog and opens Ticket › Escalations, where the new link appears.
  const createdResponse=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname===base+`/conversations/${records[0].ticket.id}/links`);await dialog().getByRole('button',{name:'Create issue with selected context',exact:true}).click();const response=await createdResponse;assert.equal(response.status(),201);const linked=(await response.json()).data.links.find(l=>l.provider===name);await dialog().waitFor({state:'detached'});await page.locator('#conversation-tab-details[aria-selected=true]').waitFor();await panel().locator('a').filter({hasText:linked.key}).first().waitFor();links.push(linked);
 }
 for(const [i,name] of ['github','linear','jira'].entries())for(let n=1;n<4;n++)await req(base+`/conversations/${records[i*3+n].ticket.id}/links`,{provider:name,mode:'create',title:'Export progress investigation '+n,message_ids:[records[i*3+n].message.id],attachment_ids:[],request_id:crypto.randomUUID()});
 for(let n=1;n<5;n++)await req(base+`/conversations/${records[n].ticket.id}/links`,{provider:'github',mode:'link',key:links[0].key,message_ids:[records[n].message.id],attachment_ids:[],request_id:crypto.randomUUID()});
 await panel().getByRole('button',{name:'Refresh status',exact:true}).click();await page.waitForTimeout(200);
 await escalate();await dialog().getByLabel('Destination',{exact:true}).selectOption('slack');await dialog().getByLabel('Slack channel ID',{exact:true}).fill('C12345678');await dialog().locator('.escalation-context input[type=checkbox]').first().check();await dialog().getByRole('button',{name:'Preview selected context',exact:true}).click();await shot('preview-slack');const postedResponse=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname===base+`/conversations/${records[0].ticket.id}/slack`);await dialog().getByRole('button',{name:'Share selected context to Slack',exact:true}).click();assert.equal((await postedResponse).status(),201);await dialog().waitFor({state:'detached'});await panel().getByRole('link',{name:'Handoff to C12345678',exact:true}).waitFor();
 for(let n=1;n<3;n++)await req(base+`/conversations/${records[n].ticket.id}/slack`,{channel:'C12345678',message_ids:[records[n].message.id],attachment_ids:[],request_id:crypto.randomUUID()});
 await panel().getByRole('button',{name:'Refresh status',exact:true}).click();await page.waitForTimeout(250);await shot('linked-issues-and-handoff');
 await escalate();await dialog().getByLabel('Destination',{exact:true}).selectOption('teams');
 await dialog().locator('.escalation-context input[type=checkbox]').first().check();await dialog().getByRole('button',{name:'Preview selected context',exact:true}).click();await shot('preview-teams');
 const close=dialog().getByRole('button',{name:'Close dialog',exact:true});await close.scrollIntoViewIfNeeded();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await close.hover();await page.locator('[role=tooltip]').filter({hasText:/^Close dialog$/}).waitFor();await page.keyboard.press('Tab');await close.focus();await page.locator('[role=tooltip]').filter({hasText:/^Close dialog$/}).waitFor();await page.screenshot({path:join(directory,`${width}-teams-close-tooltip.png`)});
 await measureTargets(dialog(),'confirmation');

 const teamsResponse=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname===base+`/conversations/${records[0].ticket.id}/teams`);
 await dialog().getByRole('button',{name:'Share selected context to Teams',exact:true}).click();assert.equal((await teamsResponse).status(),201);await dialog().waitFor({state:'detached'});
 await panel().getByRole('link',{name:`Handoff to ${providers.teams.target}`,exact:true}).waitFor();await shot('teams-shared');assert.equal(await panel().locator('.escalation-link-heading a').count(),3,'all three tracker links are included in the phone audit');await measureTargets(panel(),'linked-trackers-and-handoffs');
 const teamsFailure=async(kind,response)=>{
  providers.teams.responses.push(response);await escalate();await dialog().getByLabel('Destination',{exact:true}).selectOption('teams');await dialog().locator('.escalation-context input[type=checkbox]').first().check();await dialog().getByRole('button',{name:'Preview selected context',exact:true}).click();
  await dialog().getByRole('button',{name:'Share selected context to Teams',exact:true}).click();await dialog().getByRole('alert').waitFor();await page.screenshot({path:join(directory,`${width}-teams-${kind}.png`)});
  await dialog().getByRole('button',{name:'Close dialog',exact:true}).click();await section();await panel().getByRole('button',{name:'Refresh status',exact:true}).click();await panel().getByText(kind==='refused'?/Teams outcome was refused/:/Teams outcome is unknown/).first().waitFor();await shot('teams-'+kind+'-outcome');
 };
 await teamsFailure('refused',{status:403,body:{error:{code:'Forbidden'}}});await teamsFailure('uncertain',{disconnect:true});
 const t=Date.now()+20000;
 for(const [i,name] of ['github','linear','jira'].entries()){
  const p=providers[name],key=name==='linear'?[...p.issues.values()].find(x=>x.identifier===links[i].key).id:links[i].key,event=p.webhook(key,{closed:true,assignee:'Avery Engineer',updatedAt:t}),payload=JSON.parse(event.body);p.issues.set(String(name==='github'?payload.issue.number:name==='linear'?payload.data.id:payload.issue.key),payload.data??payload.issue);
  const webhookPath=origin+`/api/escalations/webhooks/${projectId}:${name}`,send=e=>browserRequest(page,webhookPath,{method:'POST',text:e.body,headers:e.headers});assert.equal((await send(event)).status,200);assert.equal((await send(event)).status,200);assert.equal((await send(p.webhook(key,{closed:false,updatedAt:t-1000}))).status,200);assert.equal((await browserRequest(page,webhookPath,{method:'POST',text:event.body})).status,401);assert.equal((await send({...event,body:event.body+' '})).status,401);
 }
 await panel().getByRole('button',{name:'Refresh status',exact:true}).click();await panel().getByRole('button',{name:'Review customer update',exact:true}).first().waitFor();await shot('closure-drafts');
 await panel().getByRole('button',{name:'Review customer update',exact:true}).first().click();const composer=page.getByLabel('Reply to conversation',{exact:true});await composer.fill('The export fix is ready. Please try again and tell us whether your export completes.');await page.screenshot({path:join(directory,`${width}-edited-customer-update.png`),fullPage:true});const sending=page.waitForResponse(r=>r.request().method()==='POST'&&/\/drafts\/[^/]+\/send$/.test(new URL(r.url()).pathname));await page.getByRole('button',{name:'Send',exact:true}).click();const sent=await sending;assert.equal(sent.status(),200);assert.equal((await sent.json()).accepted,true);await page.waitForFunction(()=>document.querySelector('textarea[aria-label="Reply to conversation"]')?.value==='');
 // Each linked ticket retains its own requester, frontier and ordinary delivery path.
 for(const r of records.slice(0,5)){
  let state=(await req(base+`/conversations/${r.ticket.id}`)).data;
  for(const draft of state.drafts.filter(d=>d.state==='draft')){const frontier=await req(`/api/conversations/${r.ticket.id}`);await req(base+`/conversations/${r.ticket.id}/drafts/${draft.id}/send`,{content:`The export fix is available for ${r.person.name}. Please try again and let us know the result.`,expectedRevision:frontier.revision,expectedLastMessageId:frontier.last_message_id});}
  state=(await req(base+`/conversations/${r.ticket.id}`)).data;assert.ok(state.drafts.every(d=>d.state==='sent'));assert.ok(state.links.every(l=>l.recovery==='unconfirmed'));
 }
 await section();await panel().getByRole('button',{name:'Refresh status',exact:true}).click();await page.waitForTimeout(250);await shot('approved-update-sent');
 await writeFile(join(directory,`${width}-journey.json`),JSON.stringify({width,tickets:records.length,trackerIssues:12,slackHandoffs:3,sharedIssueTicketCount:5,signatureRefusals:6,approvedDrafts:7,recovery:'unconfirmed'},null,2));
 await panel().locator('.escalation-recovery > summary').first().click();await panel().getByLabel('What did you observe for this customer?',{exact:true}).first().fill('The customer confirmed their next export completed.');await page.screenshot({path:join(directory,`${width}-recovery-observation.png`)});await panel().getByRole('button',{name:'Record recovery observation',exact:true}).first().click();await panel().getByText('Observed',{exact:true}).first().waitFor();await shot('recovery-observed');
 await page.addScriptTag({path:resolve('node_modules/axe-core/axe.min.js')});const violations=await page.evaluate(async()=>{const r=await axe.run(document.querySelector('.escalations-panel'));return r.violations.filter(v=>['serious','critical'].includes(v.impact)).map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)}))});assert.deepEqual(violations,[]);
 return {projectId,records,links,context,req,page};
 }catch(e){failure=e;await page.screenshot({path:join(directory,`${width}-failure.png`),fullPage:true}).catch(()=>{});throw e}finally{if(failure)await context.close()}
}
