import assert from 'node:assert/strict'
import {createRuntime} from '../emitted-runtime.mjs'
import {launchBrowser,evidence} from '../../journeys/kit/browser.mjs'
import {seedTicketBrowser} from './ticket-browser-fixture.mjs'

export async function ticketsBrowser({count=12,installation}={}){
 const runtime=installation?{origin:installation.origin,close:async()=>{}}:await createRuntime({vars:{H2H_LOCAL:'true',EMAIL_PROVIDER:'development',EMAIL_FROM:'support@localhost.test'}}),browser=await launchBrowser(),shot=await evidence('tickets')
 let success=false
 try{
  const fixture=await seedTicketBrowser(runtime.origin,count,installation),{projectId,base,owner}=fixture,context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[]
  page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(15000)
  await page.goto(runtime.origin+'/login?'+new URLSearchParams({returnTo:`/projects/${projectId}/ticket-settings`}))
  await page.getByLabel('Email',{exact:true}).fill(owner.email);await page.getByLabel('Password',{exact:true}).fill(owner.password);await page.getByRole('button',{name:'Login',exact:true}).click()
  const capture=async name=>{if(!await page.evaluate(()=>Boolean(window.axe)))await page.addScriptTag({path:'node_modules/axe-core/axe.min.js'});for(const width of [1440,390]){
   await page.setViewportSize({width,height:width===390?844:1000});
   await page.waitForTimeout(500);
   if(/^0[1-6]/.test(name))await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0)});
   if(/^0[78]/.test(name)){
    await page.waitForTimeout(100);
    if(await page.locator('#conversation-assistant').getAttribute('aria-hidden')==='true')await page.getByRole('button',{name:'Show conversation panel',exact:true}).click();
    await page.getByRole('tab',{name:'Ticket',exact:true}).click();
    if(name.includes('custom'))await page.getByLabel('Reason',{exact:true}).scrollIntoViewIfNeeded();
    else if(name.startsWith('08'))await page.locator('.ticket-history li').first().scrollIntoViewIfNeeded();
    else await page.locator('#ticket-section-fields').scrollIntoViewIfNeeded();
   }
   if(name==='10b-view-save')await page.getByLabel('View name',{exact:true}).scrollIntoViewIfNeeded();
   if(/^1[23]/.test(name))await page.getByRole('region',{name:'Bulk ticket changes',exact:true}).locator('.ticket-result-list').scrollIntoViewIfNeeded();
   await page.waitForTimeout(200);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${name} ${width} overflow`);
   const violations=await page.evaluate(async()=>{const selector='.workspace-settings, .ticket-editor, .ticket-queue-tools';if(!document.querySelector(selector))return [];const result=await window.axe.run({include:[selector]},{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}});return result.violations.map(({id,nodes})=>({id,nodes:nodes.map(node=>node.target)}))});
   assert.deepEqual(violations,[],`${name} ${width} accessibility`);console.log(`${name} ${width}: no horizontal overflow or WCAG axe violations`);
   await page.screenshot({path:shot(`${name}-${width}.png`),fullPage:true});
  }await page.setViewportSize({width:1440,height:1000})}

  await page.getByRole('heading',{name:'Ticket statuses',exact:true}).waitFor();await capture('01-statuses')
  await page.getByRole('button',{name:'New status',exact:true}).click();await page.getByLabel('Name',{exact:true}).fill('Waiting for warehouse');await page.getByLabel('Lifecycle category').selectOption('on_hold');await capture('02-status-form');await page.getByRole('button',{name:'Create',exact:true}).click();await page.getByRole('status').filter({hasText:'Saved.'}).waitFor()
  await page.getByRole('button',{name:'Fields',exact:true}).click();await page.getByRole('heading',{name:'Ticket fields',exact:true}).waitFor();await capture('03-fields')
  await page.getByRole('button',{name:'New field',exact:true}).click();await page.getByLabel('Name',{exact:true}).fill('Warehouse reference');await page.getByLabel('Type',{exact:true}).selectOption('regex');await page.getByLabel('Validation pattern').fill('^WH-[0-9]{4}$');await capture('04-field-form');await page.getByRole('button',{name:'Create',exact:true}).click();await page.getByRole('status').filter({hasText:'Saved.'}).waitFor()
  await page.getByRole('button',{name:'Groups',exact:true}).click();await capture('05-groups');await page.getByRole('button',{name:'New group',exact:true}).click();await page.getByLabel('Name',{exact:true}).fill('Warranty');await page.getByLabel(owner.ownerName,{exact:true}).check();await capture('06-group-form');await page.getByRole('button',{name:'Create',exact:true}).click();await page.getByRole('status').filter({hasText:'Saved.'}).waitFor()
  await page.goto(`${runtime.origin}/projects/${projectId}/conversations/${fixture.tickets[0].id}`)
  // Status and Priority save on change in the Summary; the other fields sit under Ticket fields with Save ticket.
  await page.getByRole('tab',{name:'Ticket',exact:true}).click();await page.locator('#ticket-section-fields-heading').click();await page.getByLabel('Subject',{exact:true}).waitFor();await capture('07-ticket-fields')
  await capture('07b-custom-fields');
  await page.getByLabel('Priority',{exact:true}).selectOption('high');await page.getByText('Priority saved.',{exact:true}).waitFor({state:'attached'})
  assert.equal((await fixture.api(`${base}/conversations/${fixture.tickets[0].id}/ticket`)).data.priority,'high')
  await page.getByLabel('Subject',{exact:true}).fill('Replacement for a cracked lid');await page.getByRole('button',{name:'Save ticket',exact:true}).click();await page.getByText('Ticket saved.',{exact:true}).waitFor()
  const savedTicket=(await fixture.api(`${base}/conversations/${fixture.tickets[0].id}/ticket`)).data;assert.equal(savedTicket.subject,'Replacement for a cracked lid');assert.equal(savedTicket.priority,'high')
  await page.locator('#ticket-section-history-heading').click();await page.locator('.ticket-history li').first().waitFor();await capture('08-ticket-history')
  await page.goto(`${runtime.origin}/projects/${projectId}/conversations`)
  await page.getByRole('button',{name:'Filters',exact:true}).click();await capture('09-views')
  await page.getByRole('button',{name:'Save as view…',exact:true}).click();await page.getByRole('button',{name:'Add filter',exact:true}).click();
  await page.getByLabel('Filter 1 field').selectOption('priority');await page.getByLabel('Value',{exact:true}).selectOption({label:'Urgent'});
  await page.getByRole('button',{name:'Add filter',exact:true}).click();await page.getByLabel('Filter 2 field').selectOption('group_id');await page.locator('#view-filter-1').selectOption({label:'Returns & replacements'});
  await page.getByRole('button',{name:'Add sort',exact:true}).click();await page.getByLabel('Sort 1 field').selectOption('subject');await page.getByLabel('Sort 1 direction').selectOption('asc');
  await page.getByLabel('View name',{exact:true}).fill('Urgent returns');await page.getByLabel('Visibility',{exact:true}).selectOption('shared');await capture('10-view-form');await capture('10b-view-save');
  await page.getByRole('button',{name:'Save new view',exact:true}).click();await page.getByText('View saved.',{exact:true}).waitFor();await capture('11-saved-view');
  const savedViews=(await fixture.api(base+'/ticket-views')).data;assert.ok(savedViews.some(view=>view.name==='Urgent returns'&&view.visibility==='shared'));
  // Saved views are chosen from the rail and edited through Filters › Edit view….
  const views=page.locator('nav[data-testid="inbox-views"]'),saved=savedViews.find(view=>view.name==='Urgent returns')
  await views.locator('a[href*="view=open"]').click();await views.getByRole('link',{name:'Urgent returns',exact:true}).click();await page.waitForURL(url=>url.searchParams.get('saved_view')===saved.id)
  await page.getByRole('button',{name:'Filters',exact:true}).click();await page.getByRole('button',{name:'Edit view…',exact:true}).click()
  await page.getByLabel('View name',{exact:true}).fill('Urgent returns queue');await page.getByRole('button',{name:'Save view',exact:true}).click();await page.getByText('View saved.',{exact:true}).waitFor()
  assert.equal((await fixture.api(base+'/ticket-views')).data.find(view=>view.id===saved.id).name,'Urgent returns queue')
  // Select once the Open list is on screen: a selection belongs to the list it was made in.
  await views.locator('a[href*="view=open"]').click();await page.getByRole('heading',{level:2,name:/^Open\b/}).waitFor()
  await page.getByRole('button',{name:'Select tickets',exact:true}).click();await page.getByRole('checkbox',{name:/Select ticket/}).first().check();await page.getByRole('checkbox',{name:/Select ticket/}).nth(1).check();
  const bulk=page.getByRole('region',{name:'Bulk ticket changes',exact:true});await bulk.getByLabel('Priority',{exact:true}).selectOption('urgent');
  await bulk.getByLabel('Assign to',{exact:true}).selectOption({label:owner.ownerName});await bulk.getByLabel('Status',{exact:true}).selectOption({label:'Pending'});await bulk.getByLabel('Add tags',{exact:true}).selectOption({label:'Needs return label'});
  await bulk.getByRole('button',{name:'Preview changes',exact:true}).click();await bulk.getByText('Preview — no changes applied',{exact:true}).waitFor();await capture('12-bulk-preview');
  await bulk.getByRole('button',{name:'Apply to eligible tickets',exact:true}).click();await bulk.getByText('Bulk update results',{exact:true}).waitFor();await capture('13-bulk-results');
  // A Closed ticket is final: no Reopen or Close, and the composer says why it takes no reply.
  const closed=fixture.tickets.find(ticket=>ticket.status_category==='closed')
  await page.goto(`${runtime.origin}/projects/${projectId}/conversations/${closed.id}`);await page.locator('.conversation-header-status').filter({hasText:'Closed · final'}).waitFor()
  assert.equal(await page.locator('.conversation-header-reopen, .conversation-header-close').count(),0)
  const composer=page.getByLabel('Reply to conversation',{exact:true});assert.ok(await composer.isDisabled());assert.match(await composer.getAttribute('placeholder'),/closed and final/)
  await capture('16-closed-final')
  // A refused change rolls the header back and shows the server's reason.
  const required=(await fixture.api(base+'/ticket-fields',{name:'Return reason code',type:'text',required:true})).data,open=fixture.tickets.find(ticket=>ticket.status_category==='open')
  const unchanged=(await fixture.api(`${base}/conversations/${open.id}/ticket`)).data.status_category
  await page.goto(`${runtime.origin}/projects/${projectId}/conversations/${open.id}`);await page.locator('.conversation-header-close').click()
  await page.getByRole('alert').filter({hasText:'Could not close this conversation: Return reason code: Required to solve.'}).waitFor();assert.equal(await page.getByRole('alert').count(),1)
  await page.locator('.conversation-header-status').filter({hasText:/^Open$/}).waitFor();await page.locator('.conversation-header-close').waitFor()
  assert.equal((await fixture.api(`${base}/conversations/${open.id}/ticket`)).data.status_category,unchanged)
  await capture('17-refused-close')
  await fixture.api(`${base}/ticket-fields/${required.id}`,undefined,'DELETE')
  await page.goto(runtime.origin+'/docs/tickets');await page.getByRole('heading',{name:'Tickets',level:1,exact:true}).waitFor();await capture('14-ticket-docs');
  // Policies configured through the public API remain readable and editable in
  // settings, including object-shaped typed conditions and form restrictions.
  const tier=(await fixture.api(base+'/ticket-fields',{name:'Plan tier',type:'dropdown',options:['business','personal']})).data
  const requestForm=(await fixture.api(`/api/forms/projects/${projectId}/forms`,{title:'Account help',enabled:true,fields:[{fieldId:tier.id,required:true}]})).data
  const calendar=(await fixture.api(base+'/workflow-calendars',{name:'Account support hours',timezone:'America/New_York',weekly:[{day:1,start:'09:00',end:'17:00'}]})).data
  const policy=(await fixture.api(base+'/sla-policies',{name:'Business account help',calendar_id:calendar.id,conditions:{form_ids:[requestForm.id],fields:{[tier.id]:'business'}},first_response_minutes:60})).data
  await page.goto(`${runtime.origin}/projects/${projectId}/workflow-settings`)
  await page.getByRole('button',{name:'SLA policies',exact:true}).click()
  await page.getByRole('heading',{name:'SLA policies',exact:true}).waitFor()
  await page.getByText('Plan tier = "business"',{exact:false}).waitFor()
  await page.getByText('Request forms: Account help',{exact:false}).waitFor()
  await capture('18-sla-policy')
  await page.setViewportSize({width:390,height:844})
  await page.mouse.move(380,800)
  const menu=page.getByRole('button',{name:'Toggle navigation',exact:true})
  await menu.focus()
  assert.equal(await page.getByRole('tooltip',{name:'Navigation menu',exact:true}).isVisible(),true,'keyboard focus names the icon immediately')
  await page.screenshot({path:shot('20-navigation-hint-focus-390.png'),fullPage:true})
  await menu.press('Escape');assert.equal(await page.getByRole('tooltip').count(),0)
  await menu.evaluate(node=>node.blur());await menu.hover();await page.waitForTimeout(350)
  await page.getByRole('tooltip',{name:'Navigation menu',exact:true}).waitFor()
  await page.mouse.move(380,800)
  const account=page.getByRole('button',{name:'Account menu',exact:true}).filter({visible:true})
  await account.focus();assert.equal(await page.getByRole('tooltip',{name:'Account menu',exact:true}).isVisible(),true)
  await account.evaluate(node=>node.blur());await page.setViewportSize({width:1440,height:1000})
  await page.getByRole('button',{name:'Edit policy',exact:true}).click()
  await page.getByLabel('Name',{exact:true}).fill('Business account response')
  await capture('19-sla-policy-edit')
  await page.getByRole('button',{name:'Save policy',exact:true}).click()
  await page.getByRole('heading',{name:/Business account response/}).waitFor()
  const savedPolicy=(await fixture.api(base+'/sla-policies')).data.find(row=>row.id===policy.id)
  assert.deepEqual(savedPolicy.conditions.fields,{[tier.id]:'business'})
  assert.deepEqual(savedPolicy.conditions.form_ids,[requestForm.id])
  await fixture.api(`/api/management/projects/${projectId}/contacts/${fixture.tickets[0].visitor.contactId}/erase`,{},'POST');
  await page.goto(`${runtime.origin}/projects/${projectId}/contacts/${fixture.tickets[0].visitor.contactId}`);await page.getByText('Personal data erased.',{exact:true}).waitFor();await capture('15-erasure');
  assert.deepEqual(errors,[]);success=true
  return {fixture,origin:runtime.origin}
 }finally{await browser.close();await runtime.close(success)}
}
