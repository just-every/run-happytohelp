import {createHash} from 'node:crypto'
import {createServer} from 'node:net'
import assert from 'node:assert/strict'
import {createRuntime} from '../emitted-runtime.mjs'
import {launchBrowser,evidence} from '../../journeys/kit/browser.mjs'
import {seedTicketBrowser} from './ticket-browser-fixture.mjs'

async function ticketRuntime(){
 const reservation=createServer();await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve))
 return createRuntime({port,outboundFixture:new URL('../../fixtures/sla-slack-edge.mjs',import.meta.url).href,vars:{APP_ORIGIN:`http://127.0.0.1:${port}`,INTEGRATION_ENCRYPTION_KEY:createHash('sha256').update('synthetic-hh-1').digest('base64'),H2H_LOCAL:'true',EMAIL_PROVIDER:'development',EMAIL_FROM:'support@localhost.test'}})
}
export async function ticketsBrowser({count=8,installation}={}){
 const runtime=installation?{origin:installation.origin,close:async()=>{}}:await ticketRuntime(),browser=await launchBrowser(),shot=await evidence('tickets')
 let success=false
 try{
  const fixture=await seedTicketBrowser(runtime.origin,count,installation),{projectId,base,owner}=fixture,context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[]
  page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(15000)
  await page.goto(runtime.origin+'/login?'+new URLSearchParams({returnTo:`/projects/${projectId}/ticket-settings`}))
  await page.getByLabel('Email',{exact:true}).fill(owner.email);await page.getByLabel('Password',{exact:true}).fill(owner.password);await page.getByRole('button',{name:'Login',exact:true}).click()
  const capture=async name=>{
   await page.addScriptTag({path:'node_modules/axe-core/axe.min.js'})
   const violations=await page.evaluate(async()=>(await window.axe.run()).violations.filter(v=>['serious','critical'].includes(v.impact)).map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})))
   assert.deepEqual(violations,[],name+' accessibility')
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' fits the desktop')
   await page.screenshot({path:shot(name+'.png'),fullPage:true})
  }

  await page.getByRole('heading',{name:'Ticket statuses',exact:true}).waitFor();
  await page.getByRole('button',{name:'New status',exact:true}).click();await page.getByLabel('Name',{exact:true}).fill('Waiting for warehouse');await page.getByLabel('Lifecycle category').selectOption('on_hold');await page.getByRole('button',{name:'Create',exact:true}).click();await page.getByRole('status').filter({hasText:'Saved.'}).waitFor()
  await page.getByRole('button',{name:'Fields',exact:true}).click();await page.getByRole('heading',{name:'Ticket fields',exact:true}).waitFor();
  await page.getByRole('button',{name:'New field',exact:true}).click();await page.getByLabel('Name',{exact:true}).fill('Warehouse reference');await page.getByLabel('Type',{exact:true}).selectOption('regex');await page.getByLabel('Validation pattern').fill('^WH-[0-9]{4}$');await page.getByRole('button',{name:'Create',exact:true}).click();await page.getByRole('status').filter({hasText:'Saved.'}).waitFor()
  await page.getByRole('button',{name:'Groups',exact:true}).click();await page.getByRole('button',{name:'New group',exact:true}).click();await page.getByLabel('Name',{exact:true}).fill('Warranty');await page.getByLabel(owner.ownerName,{exact:true}).check();await page.getByRole('button',{name:'Create',exact:true}).click();await page.getByRole('status').filter({hasText:'Saved.'}).waitFor()
  await page.goto(`${runtime.origin}/projects/${projectId}/conversations/${fixture.tickets[0].id}`)
  // Status and Priority save on change in the Summary; the other fields sit under Ticket fields with Save ticket.
  await page.getByRole('tab',{name:'Ticket',exact:true}).click();await page.locator('#ticket-section-fields-heading').click();await page.getByLabel('Subject',{exact:true}).waitFor();await capture('07-ticket-fields')

  await page.getByLabel('Priority',{exact:true}).selectOption('high');await page.getByText('Priority saved.',{exact:true}).waitFor({state:'attached'})
  assert.equal((await fixture.api(`${base}/conversations/${fixture.tickets[0].id}/ticket`)).data.priority,'high')
  await page.getByLabel('Warehouse reference',{exact:true}).fill('WH-2048');
  await page.getByLabel('Subject',{exact:true}).fill('Replacement for a cracked lid');await page.getByRole('button',{name:'Save ticket',exact:true}).click();await page.getByText('Ticket saved.',{exact:true}).waitFor()
  const savedTicket=(await fixture.api(`${base}/conversations/${fixture.tickets[0].id}/ticket`)).data;assert.equal(savedTicket.subject,'Replacement for a cracked lid');assert.equal(savedTicket.priority,'high')
  const warehouse=(await fixture.api(base+'/ticket-fields')).data.find(field=>field.name==='Warehouse reference')
  assert.equal(savedTicket.fields[warehouse.id],'WH-2048')
  await page.locator('#ticket-section-history-heading').click();await page.locator('.ticket-history li').first().waitFor();
  await page.goto(`${runtime.origin}/projects/${projectId}/conversations`)
  await page.getByRole('button',{name:'Filters',exact:true}).click();
  await page.getByRole('button',{name:'Save as view…',exact:true}).click();await page.getByRole('button',{name:'Add filter',exact:true}).click();
  await page.getByLabel('Filter 1 field').selectOption('priority');await page.getByLabel('Value',{exact:true}).selectOption({label:'Urgent'});
  await page.getByRole('button',{name:'Add filter',exact:true}).click();await page.getByLabel('Filter 2 field').selectOption('group_id');await page.locator('#view-filter-1').selectOption({label:'Warranty'});
  await page.getByRole('button',{name:'Add sort',exact:true}).click();await page.getByLabel('Sort 1 field').selectOption('subject');await page.getByLabel('Sort 1 direction').selectOption('asc');
  await page.getByLabel('View name',{exact:true}).fill('Urgent returns');await page.getByLabel('Visibility',{exact:true}).selectOption('shared');
  await page.getByRole('button',{name:'Save new view',exact:true}).click();await page.getByText('View saved.',{exact:true}).waitFor();
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
  await bulk.getByRole('button',{name:'Preview changes',exact:true}).click();await bulk.getByText('Preview — no changes applied',{exact:true}).waitFor();
  await bulk.getByRole('button',{name:'Apply to eligible tickets',exact:true}).click();await bulk.getByText('Bulk update results',{exact:true}).waitFor();await capture('13-bulk-results');
  // A Closed ticket is final: no Reopen or Close, and the composer says why it takes no reply.
  const closed=fixture.tickets.find(ticket=>ticket.status_category==='closed')
  await page.goto(`${runtime.origin}/projects/${projectId}/conversations/${closed.id}`);await page.locator('.conversation-header-status').filter({hasText:'Closed · final'}).waitFor()
  assert.equal(await page.locator('.conversation-header-reopen, .conversation-header-close').count(),0)
  const composer=page.getByLabel('Reply to conversation',{exact:true});assert.ok(await composer.isDisabled());assert.match(await composer.getAttribute('placeholder'),/closed and final/)

  // A refused change rolls the header back and shows the server's reason.
  const required=(await fixture.api(base+'/ticket-fields',{name:'Return reason code',type:'text',required:true})).data,open=fixture.tickets.find(ticket=>ticket.status_category==='open')
  await fixture.api(`${base}/conversations/${open.id}/ticket`,{status_id:'open'},'PATCH')
  const unchanged=(await fixture.api(`${base}/conversations/${open.id}/ticket`)).data.status_category
  await page.goto(`${runtime.origin}/projects/${projectId}/conversations/${open.id}`);await page.locator('.conversation-header-close').click()
  await page.getByRole('alert').filter({hasText:'Could not close this conversation: Return reason code: Required to solve.'}).waitFor();assert.equal(await page.getByRole('alert').count(),1)
  await page.locator('.conversation-header-status').filter({hasText:/^Open$/}).waitFor();await page.locator('.conversation-header-close').waitFor()
  assert.equal((await fixture.api(`${base}/conversations/${open.id}/ticket`)).data.status_category,unchanged)
  await capture('17-refused-close')
  await fixture.api(`${base}/ticket-fields/${required.id}`,undefined,'DELETE')
  await page.goto(`${runtime.origin}/projects/${projectId}/workflow-settings?tab=rules`)
  // The lead's normal settings screen configures and publishes the same
  // versioned actions that the provider-edge workflow journeys execute.
  await page.getByRole('button',{name:'Rules',exact:true}).click()
  await page.getByRole('heading',{name:'Event and hourly rules',exact:true}).waitFor()
  await page.getByRole('button',{name:'New rule',exact:true}).click()
  const form=page.locator('.workflow-form')
  await form.getByLabel('Name',{exact:true}).fill('Warranty review workflow')
  await form.getByLabel('When',{exact:true}).selectOption('changed')
  await form.getByRole('button',{name:'Add required condition',exact:true}).click()
  await form.getByLabel('Ticket field',{exact:true}).selectOption('priority')
  await form.getByLabel('Value',{exact:true}).selectOption('high')
  for(const [index,type] of ['assign','tags','status','note','notify','notify','route'].entries()){
   await form.getByRole('button',{name:'Add action',exact:true}).click()
   await form.getByLabel(`Action ${index+1}`,{exact:true}).selectOption(type)
   if(type==='assign')await form.getByLabel('Group',{exact:true}).selectOption({label:'Warranty'})
   if(type==='tags')await form.getByRole('group',{name:'Add tags',exact:true}).getByLabel('Needs return label',{exact:true}).check()
   if(type==='status')await form.getByLabel('Status',{exact:true}).selectOption({label:'Waiting for warehouse'})
   if(type==='note')await form.getByLabel('Internal note',{exact:true}).fill('Review the replacement before the next reply.')
   if(type==='notify'){
    const notify=form.getByLabel('Notify',{exact:true}).nth(index===4?0:1)
    await notify.selectOption(index===4?'assignee':'customer_update')
    await form.getByLabel('Notification message',{exact:true}).nth(index===4?0:1).fill(index===4?'Review request {{ticket.id}}.':'We are reviewing request {{ticket.id}}.')
   }
  }

  await form.getByRole('button',{name:'Save draft',exact:true}).click()
  const rule=page.locator('article.workflow-item').filter({has:page.getByRole('heading',{name:'0. Warranty review workflow',exact:true})})
  await rule.getByRole('button',{name:'Preview draft',exact:true}).click()
  await page.getByRole('heading',{name:'Preview: Warranty review workflow',exact:true}).waitFor()
  await page.getByText(/No messages sent and no tickets changed/).waitFor()
  await capture('22-rule-preview')
  page.once('dialog',dialog=>dialog.accept())
  await rule.getByRole('button',{name:'Publish draft',exact:true}).click()
  await rule.getByText('Event · Published · Published version 1',{exact:true}).waitFor()
  await rule.getByText('Published version history',{exact:true}).click()
  await rule.getByRole('heading',{name:'Version 1',exact:true}).waitFor()

  await rule.getByRole('button',{name:'Pause',exact:true}).click()
  await rule.getByText('Event · Paused · Published version 1',{exact:true}).waitFor()
  await capture('24-rule-paused')
  await page.reload()
  await rule.getByText('Event · Paused · Published version 1',{exact:true}).waitFor()
  assert.deepEqual(errors,[]);success=true
  return {fixture,origin:runtime.origin}
 }finally{await browser.close();await runtime.close(success)}
}
