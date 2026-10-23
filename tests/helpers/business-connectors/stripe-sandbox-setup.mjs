import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

/** Every provider object is created for this invocation and carries a synthetic
 * marker. Cleanup deletes only these returned IDs; no existing account data. */
export async function provisionStripeSandbox(stripe){
 const tag='synthetic-happytohelp-'+randomUUID(),prices=[];
 let customer,product,subscription;
 const cleanup=async()=>{
  if(subscription)await stripe('/v1/subscriptions/'+subscription.id,{method:'DELETE'});
  if(customer)await stripe('/v1/customers/'+customer.id,{method:'DELETE'});
  for(const price of prices)await stripe('/v1/prices/'+price.id,{method:'POST',body:{active:'false'}});
  if(product)await stripe('/v1/products/'+product.id,{method:'POST',body:{active:'false'}});
 };
 try{
  const account=await stripe('/v1/account');
  customer=await stripe('/v1/customers',{method:'POST',body:{name:tag,'metadata[h2h_sandbox]':tag}});
  const method=await stripe('/v1/payment_methods/pm_card_visa/attach',{method:'POST',body:{customer:customer.id}});
  await stripe('/v1/customers/'+customer.id,{method:'POST',body:{'invoice_settings[default_payment_method]':method.id}});
  product=await stripe('/v1/products',{method:'POST',body:{name:tag,'metadata[h2h_sandbox]':tag}});
  for(const amount of [500,750])prices.push(await stripe('/v1/prices',{method:'POST',body:{product:product.id,currency:'usd',unit_amount:String(amount),'recurring[interval]':'month'}}));
  subscription=await stripe('/v1/subscriptions',{method:'POST',body:{customer:customer.id,'items[0][price]':prices[0].id,payment_behavior:'error_if_incomplete','metadata[h2h_sandbox]':tag}});
  const invoice=await stripe('/v1/invoices/'+subscription.latest_invoice);
  assert.equal(invoice.paid,true);assert.equal(invoice.currency,'usd');assert.equal(typeof invoice.payment_intent,'string');
  return {account,customer,subscription,payment:invoice.payment_intent,nextPrice:prices[1],cleanup};
 }catch(error){await cleanup();throw error;}
}
