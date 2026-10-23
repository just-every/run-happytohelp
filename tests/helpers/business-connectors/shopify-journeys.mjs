import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
export async function shopifyActions(h,path){
 h.network.shopify.multiTender();
 const input={kind:'refund',target_id:'901',reason:'Refund one damaged item and shipping',request_key:randomUUID(),options:{mode:'items',items:[{id:'905',quantity:1}],shipping_cents:200}};
 const prepared=(await h.call(path+'/prepare',input)).data;
 assert.equal(prepared.amount_cents,1250);assert.equal(prepared.preview.tax_cents,50);assert.equal(prepared.preview.shipping_cents,200);assert.equal(prepared.preview.tenders.length,2);
 assert.equal((await h.app.call(h.base+path+'/prepare',{token:h.token,body:{...input,options:{...input.options,items:[{id:'905',quantity:2}]}}})).status,409,'a request identity cannot approve different item quantities');
 await h.call(path+'/actions/'+prepared.id+'/approve',{confirmed:true});assert.equal((await h.call(path+'/actions/'+prepared.id+'/execute',{})).data.state,'succeeded');
 const refund=h.network.shopifyRefunds.at(-1);assert.equal(refund.transactions.nodes.length,2);assert.equal(refund.refundLineItems.nodes[0].quantity,1);
 assert.equal((await h.call(path+'/actions/'+prepared.id+'/execute',{})).data.state,'succeeded');assert.equal(h.network.shopifyRefunds.length,2);
 const full=(await h.call(path+'/prepare',{kind:'refund',target_id:'901',reason:'Refund remaining order items',request_key:randomUUID(),options:{mode:'full'}})).data;
 assert.equal(full.preview.refund_items.length,1);assert.equal(full.preview.shipping_cents,1000);await h.call(path+'/actions/'+full.id+'/approve',{confirmed:true});assert.equal((await h.call(path+'/actions/'+full.id+'/execute',{})).data.state,'succeeded');
 const create={kind:'create_return',target_id:'901',reason:'Customer requested a damaged-item return',request_key:randomUUID(),options:{fulfillment_line_id:'907',quantity:1,reason_definition_id:'908'}};
 assert.equal((await h.app.call(h.base+path+'/prepare',{token:h.token,body:{...create,options:{...create.options,quantity:3}}})).status,409);
 const returned=(await h.call(path+'/prepare',create)).data;assert.equal(returned.amount_cents,0);await h.call(path+'/actions/'+returned.id+'/approve',{confirmed:true});assert.equal((await h.call(path+'/actions/'+returned.id+'/execute',{})).data.state,'succeeded');assert.equal(h.network.shopify.returns.length,1);
 const cancel=(await h.call(path+'/prepare',{kind:'cancel_order',target_id:'912',reason:'Customer requested cancellation before fulfillment',request_key:randomUUID(),options:{cancellation_reason:'CUSTOMER',restock:false}})).data;
 await h.call(path+'/actions/'+cancel.id+'/approve',{confirmed:true});assert.equal((await h.call(path+'/actions/'+cancel.id+'/execute',{})).data.state,'uncertain','asynchronous cancellation is not success');assert.equal(h.network.shopify.cancellations.length,1);
 h.network.shopify.finishJob();assert.equal((await h.call(path+'/actions/'+cancel.id+'/reconcile',{})).data.state,'succeeded');assert.equal(h.network.shopify.cancellations.length,1);
 h.network.shopify.setScopes(['read_orders']);assert.equal((await h.app.call(h.base+path+'/prepare',{token:h.token,body:{kind:'refund',target_id:'901',amount_cents:100,reason:'Revoked remote scope',request_key:randomUUID()}})).status,409);
}
export async function shopifyLostReturn(h,path){
 const action=(await h.call(path+'/prepare',{kind:'create_return',target_id:'901',reason:'Reconcile a return after a lost response',request_key:randomUUID(),options:{fulfillment_line_id:'907',quantity:1,reason_definition_id:'908'}})).data,root=path+'/actions/'+action.id;
 await h.call(root+'/approve',{confirmed:true});h.network.timeoutAfterWrite();assert.equal((await h.call(root+'/execute',{})).state,'uncertain');assert.equal(h.network.shopify.returns.length,1);assert.equal((await h.app.call(h.base+root+'/execute',{token:h.token,body:{}})).status,409);assert.equal((await h.call(root+'/reconcile',{})).data.state,'succeeded');assert.equal(h.network.shopify.returns.length,1);
}
