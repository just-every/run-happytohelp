import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {startApp} from '../../journeys/kit/app.mjs';
import {createNetwork,accounts} from './network.mjs';
export async function harness(){
 const network=createNetwork(),app=await startApp({bindings:{INTEGRATION_ENCRYPTION_KEY:randomBytes(32).toString('base64')},outbound:r=>network.handle(r)}),ws=await app.seedWorkspace('business'),foreign=await app.seedWorkspace('business-foreign'),token=ws.tokens.owner,base=`/api/business/projects/${ws.projectId}`;
 await app.presenceAwayOff(ws.projectId);
 const headers={Origin:ws.allowedOrigin,'CF-Connecting-IP':'198.51.100.81'},visitor=await app.ok('/api/identity/widget/session',{body:{widgetKey:ws.widgetKey,name:'Synthetic customer',email:'synthetic-happytohelp-1@example.test'},headers});
 const conversation=await app.ok('/api/conversations',{token:visitor.token,headers,body:{projectId:ws.projectId}}),ticket=`/conversations/${conversation.id}`;
 const call=(path,body,options={})=>app.ok(base+path,{token,body,...options}),rows={};
 const connect=async(provider,scopes=['read','prepare','approve','execute'])=>{const r=await call('/connections',{provider,...accounts[provider],token:'synthetic-happytohelp-1',scopes,fields:provider==='salesforce'?{plan:'Plan__c',entitlement:'Support_Entitlement__c',account_plan:'Plan__c',account_entitlement:'Support_Entitlement__c',editable_contact:['Support_Note__c'],editable_account:['Support_Note__c']}:provider==='hubspot'?{plan:'plan',entitlement:'support_entitlement',account_plan:'plan',account_entitlement:'support_entitlement',editable_contact:['support_note'],editable_account:['support_note']}:{},limit_cents:5000});rows[provider]=r.data;return r.data;};
 const map=async provider=>{const path=ticket+'/connections/'+encodeURIComponent(rows[provider].id);await call(path+'/map',{source_id:network.customer,confirmed:true});await call(path+'/refresh',{});return path;};
 return {app,network,ws,foreign,token,base,call,rows,connect,map,conversation,visitor,ticket,async close(){await app.close();}};
}
export async function businessJourney(){
 const h=await harness();
 try{
  await h.connect('stripe');await h.connect('shopify');
  const stripe=await h.map('stripe'),shopify=await h.map('shopify');
  const context=(await h.call(h.ticket)).data;
  assert.ok(context.connections.every(row=>row.link&&!row.link.stale&&row.link.context.source_id===h.network.customer));
  assert.equal((await h.app.call(h.base+h.ticket,{token:h.foreign.tokens.owner})).status,403);
  for(const [provider,path,target] of [['stripe',stripe,h.network.payment],['shopify',shopify,'901']]){
   const input={kind:'refund',target_id:target,amount_cents:1250,reason:'Customer approved partial refund',request_key:randomUUID()};
   const prepared=(await h.call(path+'/prepare',input)).data,action=path+'/actions/'+prepared.id;
   assert.equal((await h.app.call(h.base+action+'/execute',{token:h.token,body:{}})).status,409);
   assert.equal((await h.app.call(h.base+action+'/approve',{token:h.ws.tokens.operator,body:{confirmed:true}})).status,403);
   await h.call(action+'/approve',{confirmed:true});
   assert.equal((await h.call(action+'/execute',{})).data.state,'succeeded');
   await h.call(action+'/execute',{});
   assert.equal((provider==='stripe'?h.network.refunds:h.network.shopifyRefunds).length,1);
   const frontier=await h.app.ok('/api/conversations/'+h.conversation.id,{token:h.token});
   const confirmation={content:'Your refund is confirmed by the payment provider.',expectedRevision:frontier.revision,expectedLastMessageId:frontier.last_message_id};
   const sent=await h.call(h.ticket+'/actions/'+prepared.id+'/send',confirmation);
   assert.equal((await h.call(h.ticket+'/actions/'+prepared.id+'/send',confirmation)).message.id,sent.message.id);
   const transcript=await h.app.ok('/api/conversations/'+h.conversation.id+'/messages',{token:h.visitor.token});
   assert.ok(transcript.messages.some(row=>row.id===sent.message.id&&row.content===confirmation.content));
  }
  const pending=(await h.call(stripe+'/prepare',{kind:'refund',target_id:h.network.payment,amount_cents:1500,reason:'Recover a lost provider response',request_key:randomUUID()})).data;
  const action=stripe+'/actions/'+pending.id;
  await h.call(action+'/approve',{confirmed:true});h.network.timeoutAfterWrite();
  assert.equal((await h.call(action+'/execute',{})).state,'uncertain');
  assert.equal((await h.app.call(h.base+action+'/execute',{token:h.token,body:{}})).status,409);
  await h.connect('stripe',['read']);
  assert.equal((await h.call(action+'/reconcile',{})).data.state,'succeeded');
  assert.equal(h.network.refunds.length,2,'reconciliation never sends a second refund');
  await h.call('/connections/'+encodeURIComponent(h.rows.stripe.id),undefined,{method:'DELETE'});
  assert.equal((await h.app.call(h.base+stripe+'/refresh',{token:h.token,body:{}})).status,403);
  await h.app.ok(`/api/management/projects/${h.ws.projectId}/contacts/${h.visitor.contactId}/erase`,{token:h.token,body:{}});
  assert.equal((await h.app.call(h.base+action+'/execute',{token:h.token,body:{}})).status,404);
 }finally{await h.close();}
}
