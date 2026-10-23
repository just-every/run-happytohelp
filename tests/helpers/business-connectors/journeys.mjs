import {crmFields} from './crm-journeys.mjs';
import {shopifyActions,shopifyLostReturn} from './shopify-journeys.mjs';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {startApp} from '../../journeys/kit/app.mjs';
import {createNetwork,accounts} from './network.mjs';
import {businessArchiveRow} from '../../../scripts/installer/business-archive.mjs';
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
export async function credentials(){const h=await harness();try{
 for(const p of Object.keys(accounts))await h.connect(p);
 const requests=h.network.calls.length;assert.equal((await h.app.call(h.base+'/connections',{token:h.token,body:{provider:'orbit',account:'synthetic-happytohelp-1',token:'synthetic-happytohelp-1',scopes:['read']}})).status,409);assert.equal(h.network.calls.length,requests,'unavailable Orbit never probes an invented provider endpoint');
 const list=await h.call('/connections');assert.equal(list.data.length,4);assert.ok(!JSON.stringify(list).includes('synthetic-happytohelp-1"'),'credential never returned');
 const stored=await h.app.first('SELECT * FROM business_connections WHERE id=?',h.rows.stripe.id);assert.ok(stored.token_cipher&&!stored.token_cipher.includes('synthetic-happytohelp-1'));assert.equal(businessArchiveRow('business_connections',stored).token_cipher,null);
 const payload={provider:'stripe',...accounts.stripe,token:'synthetic-happytohelp-1',scopes:['read'],limit_cents:0};
 assert.equal((await h.app.call(h.base+'/connections',{token:h.ws.tokens.operator,body:payload})).status,403);
 assert.equal((await h.app.call(h.base+'/connections',{token:h.token,body:{...payload,account:'foreign'}})).status,409);
 assert.equal((await h.app.call(h.base+'/connections',{token:h.token,body:{...payload,host:'https://evil.example'}})).status,400);
 await h.app.db.prepare('UPDATE session_factors SET verified_at=0 WHERE user_id=?').bind(h.ws.users.owner).run();assert.equal((await h.app.call(h.base+'/connections',{token:h.token,body:payload})).data.code,'step_up_required');
}finally{await h.close();}}
export async function reads(){const h=await harness();try{
 for(const p of Object.keys(accounts)){await h.connect(p);await h.map(p);}
 let result=(await h.call(h.ticket)).data;assert.equal(result.connections.length,4);assert.ok(result.connections.every(x=>x.link&&!x.link.stale&&x.link.context.source_id===h.network.customer));
 assert.equal(result.connections.find(x=>x.provider==='shopify').link.context.orders[0].total.amount,'100.00');assert.equal(result.connections.find(x=>x.provider==='stripe').link.context.invoices[0].total_cents,10000);
 h.network.changeSource();const hub=await h.map('hubspot');result=(await h.call(h.ticket)).data;assert.equal(result.connections.find(x=>x.provider==='hubspot').link.context.entitlement,'subscriber');
 const wrong=await h.app.call(h.base+hub+'/map',{token:h.token,body:{source_id:'foreign',confirmed:true}});assert.equal(wrong.status,409);
 assert.equal((await h.app.call(h.base+h.ticket,{token:h.foreign.tokens.owner})).status,403);
 await h.call('/connections/'+encodeURIComponent(h.rows.hubspot.id),undefined,{method:'DELETE'});result=(await h.call(h.ticket)).data;const disconnected=result.connections.find(x=>x.provider==='hubspot');assert.equal(disconnected.link.stale,true);assert.equal(disconnected.link.context,null);assert.equal((await h.app.call(h.base+hub+'/refresh',{token:h.token,body:{}})).status,403);
 for(const p of ['salesforce']){const path=h.ticket+'/connections/'+encodeURIComponent(h.rows[p].id);const prepare=await h.call(path+'/prepare',{kind:'support_outcome',target_id:h.network.customer,reason:'Confirmed support recovery',request_key:randomUUID()});await h.call(path+'/actions/'+prepare.data.id+'/approve',{confirmed:true});const done=await h.call(path+'/actions/'+prepare.data.id+'/execute',{});assert.equal(done.data.state,'succeeded');}
}finally{await h.close();}}
export async function money(){const h=await harness();try{
 await h.connect('stripe');const path=await h.map('stripe');
 const input={kind:'refund',target_id:h.network.payment,amount_cents:2500,reason:'Approved partial refund',request_key:randomUUID()};
 assert.equal((await h.app.call(h.base+path+'/prepare',{token:h.token,body:{...input,amount_cents:5001}})).status,403);
 const prepared=(await h.call(path+'/prepare',input)).data;assert.equal((await h.call(path+'/prepare',input)).data.id,prepared.id);
 const action=path+'/actions/'+prepared.id;
 assert.equal((await h.app.call(h.base+action+'/execute',{token:h.token,body:{}})).status,409);assert.equal(h.network.refunds.length,0);
 assert.equal((await h.app.call(h.base+action+'/approve',{token:h.ws.tokens.operator,body:{confirmed:true}})).status,403);
 await h.call(action+'/approve',{confirmed:true});const results=await Promise.all([h.app.call(h.base+action+'/execute',{token:h.token,body:{}}),h.app.call(h.base+action+'/execute',{token:h.token,body:{}})]);assert.ok(results.some(x=>x.status===200));assert.equal(h.network.refunds.length,1);assert.equal(h.network.refunds[0].amount,2500);
 const frontier=await h.app.ok('/api/conversations/'+h.conversation.id,{token:h.token}),confirmation={content:'Your USD 25.00 refund is confirmed by the payment provider.',expectedRevision:frontier.revision,expectedLastMessageId:frontier.last_message_id};const sent=await h.call(h.ticket+'/actions/'+prepared.id+'/send',confirmation);assert.equal((await h.call(h.ticket+'/actions/'+prepared.id+'/send',confirmation)).message.id,sent.message.id);const transcript=await h.app.ok('/api/conversations/'+h.conversation.id+'/messages',{token:h.visitor.token});assert.equal(transcript.messages.filter(x=>x.id===sent.message.id&&x.content===confirmation.content).length,1);
 assert.equal((await h.call(action+'/execute',{})).data.state,'succeeded');assert.equal(h.network.refunds.length,1);
 const planInput={kind:'change_plan',target_id:h.network.subscription,price_id:'synthetic-happytohelp-304',reason:'Customer approved prorated upgrade',request_key:randomUUID()};h.network.taxUnavailable(true);assert.equal((await h.app.call(h.base+path+'/prepare',{token:h.token,body:planInput})).status,409);h.network.taxUnavailable(false);const plan=(await h.call(path+'/prepare',planInput)).data;assert.equal(plan.amount_cents,2500);assert.equal(plan.preview.proration_lines[0].amount_cents,2500);assert.equal((await h.call(path+'/prepare',planInput)).data.id,plan.id);await h.call(path+'/actions/'+plan.id+'/approve',{confirmed:true});assert.equal((await h.call(path+'/actions/'+plan.id+'/execute',{})).data.state,'succeeded');
 const credit=(await h.call(path+'/prepare',{kind:'credit',target_id:h.network.customer,amount_cents:500,reason:'Approved invoice credit',request_key:randomUUID()})).data;await h.call(path+'/actions/'+credit.id+'/approve',{confirmed:true});assert.equal((await h.call(path+'/actions/'+credit.id+'/execute',{})).data.state,'succeeded');assert.equal(h.network.credits[0].amount,-500);assert.equal((await h.call(path+'/actions/'+credit.id+'/execute',{})).data.state,'succeeded');assert.equal(h.network.credits.length,1);
 const pause=(await h.call(path+'/prepare',{kind:'pause_subscription',target_id:h.network.subscription,reason:'Pause future invoice collection',request_key:randomUUID()})).data;await h.call(path+'/actions/'+pause.id+'/approve',{confirmed:true});assert.equal((await h.call(path+'/actions/'+pause.id+'/execute',{})).data.state,'succeeded');
 const subscription=(await h.call(path+'/prepare',{kind:'cancel_subscription',target_id:h.network.subscription,reason:'Customer requested end of period cancellation',request_key:randomUUID()})).data;
 assert.match(subscription.preview.proration,/No credit or proration/);await h.call(path+'/actions/'+subscription.id+'/approve',{confirmed:true});assert.equal((await h.call(path+'/actions/'+subscription.id+'/execute',{})).data.state,'succeeded');
 await h.connect('hubspot');const crm=await h.map('hubspot');const outcome=(await h.call(crm+'/prepare',{kind:'support_outcome',target_id:h.network.customer,reason:'Customer confirmed recovery',request_key:randomUUID()})).data;await h.call(crm+'/actions/'+outcome.id+'/approve',{confirmed:true});h.network.changeSource();assert.equal((await h.app.call(h.base+crm+'/actions/'+outcome.id+'/execute',{token:h.token,body:{}})).status,409);assert.equal(h.network.notes.size,0);await h.call(crm+'/actions/'+outcome.id+'/cancel',{});
 const approvedOutcome=(await h.call(crm+'/prepare',{kind:'support_outcome',target_id:h.network.customer,reason:'Confirmed source-current recovery',request_key:randomUUID()})).data;await h.call(crm+'/actions/'+approvedOutcome.id+'/approve',{confirmed:true});assert.equal((await h.call(crm+'/actions/'+approvedOutcome.id+'/execute',{})).data.state,'succeeded');assert.equal(h.network.notes.size,1);
 await h.connect('hubspot',['read']);assert.equal((await h.app.call(h.base+crm+'/prepare',{token:h.token,body:{kind:'support_outcome',target_id:h.network.customer,reason:'Denied',request_key:randomUUID()}})).status,403);
 await h.connect('shopify');const shop=await h.map('shopify'),shopInput={kind:'refund',target_id:'901',amount_cents:1250,reason:'Approved Shopify partial refund',request_key:randomUUID()};
 assert.equal((await h.app.call(h.base+shop+'/prepare',{token:h.token,body:{...shopInput,target_id:'foreign-order'}})).status,409);
 const shopAction=(await h.call(shop+'/prepare',shopInput)).data;await h.call(shop+'/actions/'+shopAction.id+'/approve',{confirmed:true});assert.equal((await h.call(shop+'/actions/'+shopAction.id+'/execute',{})).data.state,'succeeded');assert.equal(h.network.shopifyRefunds.length,1);assert.equal((await h.call(shop+'/actions/'+shopAction.id+'/execute',{})).data.state,'succeeded');assert.equal(h.network.shopifyRefunds.length,1);
 await shopifyActions(h,shop);
 // A grant changed between provider preview and the D1 write cannot create an executable action.
 const raceInput={kind:'refund',target_id:h.network.payment,amount_cents:1000,reason:'Authority changed at commit',request_key:randomUUID()};
 const race=await h.app.call(h.base+path+'/prepare',{token:h.token,body:raceInput,headers:{'x-test-statement':'INSERT INTO business_actions','x-test-before-statement':`UPDATE business_connections SET version=version+1 WHERE id='${h.rows.stripe.id}'`}});assert.equal(race.status,409);assert.equal(await h.app.first('SELECT id FROM business_actions WHERE request_key=?',raceInput.request_key),null);
 const expiry=await h.app.call(h.base+path+'/refresh',{token:h.token,body:{},headers:{'x-test-statement':'UPDATE business_links SET context_json','x-test-before-statement':`UPDATE business_connections SET expires_at=1 WHERE id='${h.rows.stripe.id}'`}});assert.equal(expiry.status,409);
 await crmFields(h);
 assert.ok((await h.app.sql("SELECT action FROM audit_events WHERE action LIKE 'business.%'")).some(x=>x.action==='business.succeeded'));
}finally{await h.close();}}
export async function uncertainty(){const h=await harness();try{
 await h.connect('stripe');const path=await h.map('stripe'),action=(await h.call(path+'/prepare',{kind:'refund',target_id:h.network.payment,amount_cents:1500,reason:'Reconcile a lost response',request_key:randomUUID()})).data,root=path+'/actions/'+action.id;
 await h.call(root+'/approve',{confirmed:true});h.network.timeoutAfterWrite();assert.equal((await h.call(root+'/execute',{})).state,'uncertain');assert.equal(h.network.refunds.length,1);
 const count=h.network.calls.length;assert.equal((await h.app.call(h.base+root+'/execute',{token:h.token,body:{}})).status,409);assert.equal(h.network.calls.length,count);
 assert.equal((await h.app.call(h.base+path+'/prepare',{token:h.token,body:{kind:'refund',target_id:h.network.payment,amount_cents:1500,reason:'Second key cannot bypass pending refund',request_key:randomUUID()}})).status,409);
 await h.connect('stripe',['read']);assert.equal((await h.call(root+'/reconcile',{})).data.state,'succeeded');assert.ok(await h.app.first("SELECT id FROM audit_events WHERE action='business.uncertain'"));assert.equal(h.network.refunds.length,1);
 await h.connect('shopify');const shop=await h.map('shopify'),shopAction=(await h.call(shop+'/prepare',{kind:'refund',target_id:'901',amount_cents:1250,reason:'Shopify lost response',request_key:randomUUID()})).data,shopRoot=shop+'/actions/'+shopAction.id;await h.call(shopRoot+'/approve',{confirmed:true});h.network.timeoutAfterWrite();assert.equal((await h.call(shopRoot+'/execute',{})).state,'uncertain');assert.equal(h.network.shopifyRefunds.length,1);assert.equal((await h.call(shopRoot+'/reconcile',{})).data.state,'succeeded');assert.equal(h.network.shopifyRefunds.length,1);
 await shopifyLostReturn(h,shop);
 const readback=h.network.calls.filter(x=>x.path==='/v1/refunds'&&x.method==='POST');assert.equal(readback.length,1);assert.equal(readback[0].headers['idempotency-key'],action.id);
}finally{await h.close();}}
export async function erasure(){const h=await harness();try{
 await h.connect('stripe');const path=await h.map('stripe'),action=(await h.call(path+'/prepare',{kind:'refund',target_id:h.network.payment,amount_cents:1000,reason:'Never execute after erasure',request_key:randomUUID()})).data;await h.call(path+'/actions/'+action.id+'/approve',{confirmed:true});
 await h.app.ok(`/api/management/projects/${h.ws.projectId}/contacts/${h.visitor.contactId}/erase`,{token:h.token,body:{}});
 assert.equal((await h.app.first('SELECT count(*) n FROM business_links')).n,0);assert.equal((await h.app.first('SELECT count(*) n FROM business_actions')).n,0);
 assert.equal((await h.app.call(h.base+path+'/actions/'+action.id+'/execute',{token:h.token,body:{}})).status,404);assert.equal(h.network.refunds.length,0);
 const receipt=await h.app.ok(`/api/management/projects/${h.ws.projectId}/contacts/${h.visitor.contactId}/erasure`,{token:h.token});assert.ok(receipt.data.providers.requests.some(x=>x.store==='business:stripe'));
}finally{await h.close();}}
