import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
export async function crmFields(h){
 for(const provider of ['hubspot','salesforce']){
  await h.connect(provider);const path=await h.map(provider),field=provider==='hubspot'?'support_note':'Support_Note__c',context=(await h.call(h.ticket)).data.connections.find(x=>x.provider===provider).link.context;
  assert.equal(context.accounts[0].name,'Synthetic account');assert.equal(context.accounts[0].plan,'Company plan');assert.equal(context.accounts[0].entitlement,'priority');assert.equal(context.relationships_complete,true);
  const input={kind:'edit_fields',target_id:'801',reason:'Approved account support outcome',request_key:randomUUID(),options:{object:'account',changes:{[field]:'Recovery confirmed by customer'}}};
  assert.equal((await h.app.call(h.base+path+'/prepare',{token:h.token,body:{...input,target_id:'foreign'}})).status,409);
  assert.equal((await h.app.call(h.base+path+'/prepare',{token:h.token,body:{...input,options:{object:'account',changes:{OwnerId:'foreign'}}}})).status,409);
  const prepared=(await h.call(path+'/prepare',input)).data;assert.equal(prepared.preview.before[field],'No open escalations');assert.equal(prepared.preview.after[field],'Recovery confirmed by customer');
  assert.equal((await h.app.call(h.base+path+'/prepare',{token:h.token,body:{...input,options:{object:'account',changes:{[field]:'Unapproved change'}}}})).status,409);
  assert.equal((await h.app.call(h.base+path+'/actions/'+prepared.id+'/execute',{token:h.token,body:{}})).status,409);
  await h.call(path+'/actions/'+prepared.id+'/approve',{confirmed:true});assert.equal((await h.call(path+'/actions/'+prepared.id+'/execute',{})).data.state,'succeeded');assert.equal((await h.call(path+'/actions/'+prepared.id+'/execute',{})).data.state,'succeeded');
  await h.call(path+'/refresh',{});const updated=(await h.call(h.ticket)).data.connections.find(x=>x.provider===provider).link.context;assert.equal(updated.accounts[0].fields[field],'Recovery confirmed by customer');
  const contact=(await h.call(path+'/prepare',{kind:'edit_fields',target_id:h.network.customer,reason:'Approved contact support status',request_key:randomUUID(),options:{object:'contact',changes:{[field]:'Contact recovery confirmed'}}})).data;
  await h.call(path+'/actions/'+contact.id+'/approve',{confirmed:true});
  if(provider==='hubspot'){h.network.timeoutAfterWrite();assert.equal((await h.call(path+'/actions/'+contact.id+'/execute',{})).state,'uncertain');assert.equal((await h.call(path+'/actions/'+contact.id+'/reconcile',{})).data.state,'succeeded')}
  else{h.network.crm.conflictAtPatch();assert.equal((await h.call(path+'/actions/'+contact.id+'/execute',{})).state,'uncertain');assert.equal((await h.call(path+'/actions/'+contact.id+'/reconcile',{})).data.state,'uncertain');assert.equal((await h.app.call(h.base+path+'/actions/'+contact.id+'/execute',{token:h.token,body:{}})).status,409)}
  await h.connect(provider,['read']);assert.equal((await h.app.call(h.base+path+'/prepare',{token:h.token,body:{...input,request_key:randomUUID()}})).status,403);
 }
 assert.equal(h.network.crm.fieldWrites.length,3,'one company write per provider and one reconciled HubSpot contact write');
}
