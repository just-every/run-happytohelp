import assert from 'node:assert/strict';
import {accounts} from './network.mjs';
export async function exerciseBusiness({page,context,origin,owner,width,audit}){
 const names={shopify:'Shopify',stripe:'Stripe',orbit:'Orbit',hubspot:'HubSpot',salesforce:'Salesforce'},root=`/api/business/projects/${owner.projectId}`;
 const req=async(path,body)=>{const r=await context.request.fetch(origin+path,{method:body===undefined?'GET':'POST',...(body===undefined?{}:{data:body})});const value=await r.json();assert.ok(r.ok(),`${path}: ${r.status()} ${JSON.stringify(value)}`);return value;};
 await page.goto(origin+`/projects/${owner.projectId}/business-settings`);await page.getByRole('heading',{name:'Business connections',exact:true}).waitFor();
 for(const provider of Object.keys(accounts)){
  await page.getByLabel('Provider',{exact:true}).selectOption(provider);
  await page.getByLabel('Provider account ID',{exact:true}).fill(accounts[provider].account);
  await page.getByLabel('Provider HTTPS origin (required for Shopify and Salesforce)',{exact:true}).fill(accounts[provider].host||'');
  if(['hubspot','salesforce'].includes(provider)){await page.getByLabel('CRM plan property (optional)',{exact:true}).fill(provider==='salesforce'?'Plan__c':'plan');await page.getByLabel('CRM support entitlement property (optional)',{exact:true}).fill(provider==='salesforce'?'Support_Entitlement__c':'support_entitlement');}
  await page.getByLabel('Provider credential',{exact:true}).fill('synthetic-happytohelp-1');
  for(const scope of ['prepare','approve','execute'])await page.getByLabel(scope,{exact:true}).check();
  await page.getByLabel('Maximum per action (USD)',{exact:true}).fill('50');
  await page.getByRole('button',{name:'Verify and connect',exact:true}).click();await page.getByText('Account verified and connected.',{exact:true}).waitFor();
  await page.getByRole('heading',{name:names[provider]+' · '+accounts[provider].account,exact:true}).waitFor();
  assert.equal(await page.getByLabel('Provider credential',{exact:true}).inputValue(),'');
 }
 await page.getByText('Orbit is the fleet Sales CRM.',{exact:false}).waitFor();assert.equal(await page.getByLabel('Provider',{exact:true}).locator('option[value=orbit]').isDisabled(),true);await audit(page,'business-settings-'+width);
 const person=(await req(`/api/management/projects/${owner.projectId}/contacts`,{name:'Synthetic business customer',email:`synthetic-happytohelp-${width}@example.test`})).data;
 const ticket=await req('/api/conversations',{projectId:owner.projectId,contactId:person.id});await req(`/api/conversations/${ticket.id}/messages`,{localId:'opening',content:'Please help with my invoice and account.',expectedRevision:0});
 await page.goto(origin+`/projects/${owner.projectId}/conversations/${ticket.id}`);await page.getByLabel('Reply to conversation',{exact:true}).waitFor();
 if(await page.locator('#conversation-assistant').getAttribute('aria-hidden')==='true')await page.getByRole('button',{name:'Show conversation panel',exact:true}).click();
 await page.getByRole('tab',{name:'Ticket',exact:true}).click();await page.locator('#ticket-section-business-heading').click();
 const panel=page.locator('#ticket-section-business');
 for(const provider of Object.keys(accounts)){
  const details=panel.locator('details').filter({has:page.locator('summary').filter({hasText:names[provider]+' · '+accounts[provider].account})});
  await details.locator('summary').click();await details.getByLabel('Provider customer ID',{exact:true}).fill('synthetic-happytohelp-201');await details.getByLabel('I verified this provider customer is the requester. Email alone is insufficient.',{exact:true}).check();
  const mapped=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.endsWith('/map'));await details.getByRole('button',{name:'Map customer',exact:true}).click();assert.equal((await mapped).status(),200);
  await details.getByRole('button',{name:'Refresh '+names[provider]+' context',exact:true}).click();await details.getByText('Current · Last synced:',{exact:false}).waitFor();await audit(page,'business-'+provider+'-context-'+width);
  if(['stripe','shopify'].includes(provider)){
   await details.getByLabel('Order, payment intent or subscription ID',{exact:true}).fill(provider==='shopify'?'901':'synthetic-happytohelp-202');await details.getByLabel('Refund amount (USD)',{exact:true}).fill('12.50');await details.getByLabel('Reason',{exact:true}).fill('Customer approved partial refund');
   await details.getByRole('button',{name:'Preview business action',exact:true}).click();await panel.getByRole('button',{name:'Approve exact preview',exact:true}).waitFor();await audit(page,'business-'+provider+'-refund-preview-'+width);
   await panel.getByRole('button',{name:'Approve exact preview',exact:true}).click();await panel.getByRole('button',{name:'Execute approved action',exact:true}).click();await panel.getByText('Provider result: '+(provider==='shopify'?'SUCCESS':'succeeded')+'.',{exact:false}).waitFor();await audit(page,'business-'+provider+'-refund-result-'+width);
   const confirmation=panel.locator('article.card').filter({hasText:'Provider record: '+(provider==='shopify'?'901':'synthetic-happytohelp-202')});await confirmation.getByLabel('Customer confirmation',{exact:true}).fill('Your USD 12.50 refund is confirmed at the provider.');await confirmation.getByRole('button',{name:'Send reviewed customer confirmation',exact:true}).click();await confirmation.getByRole('button',{name:'Confirmation added to conversation',exact:true}).waitFor();await audit(page,'business-'+provider+'-customer-confirmation-'+width);
  }
  await details.locator('summary').click();
 }
 await page.goto(origin+`/projects/${owner.projectId}/business-settings`);await page.getByRole('button',{name:'Disconnect HubSpot 301',exact:true}).click();await page.getByText('Disconnected. Cached context is stale and actions are refused.',{exact:true}).waitFor();await audit(page,'business-disconnected-'+width);
}
