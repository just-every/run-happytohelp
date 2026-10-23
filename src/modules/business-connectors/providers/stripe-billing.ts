import type {Connection,Action} from '../model'
import {id} from '../model'
import {request,ProviderFailure} from './http'
export const extendedStripeKinds=['credit','pause_subscription','change_plan']
const integer=(value:any)=>Number.isSafeInteger(value)&&Math.abs(value)<=100000000
async function subscription(row:Connection,token:string,source:string,target:string){const s=await request(row,token,'/v1/subscriptions/'+target);if(s.id!==target||s.customer!==source||!['active','trialing','past_due'].includes(s.status))throw new ProviderFailure('identity_mismatch');return s}
export async function stripeBillingPreview(row:Connection,token:string,source:string,kind:string,target:string,amount:number,reason:string,options:any={}){
 if(kind==='credit'){
  const c=await request(row,token,'/v1/customers/'+source)
  if(c.id!==source||target!==source||c.deleted||!integer(c.balance)||amount<=0||c.currency&&c.currency!=='usd'||!c.currency&&c.balance!==0)throw new ProviderFailure('usd_customer_required')
  return {provider:'stripe',kind,target,source_id:source,currency:'USD',amount_cents:amount,balance_before_cents:c.balance,reason,tax:'Credit does not amend invoice tax.',effective:'Applied to future invoices. This is a customer invoice-balance credit, not a cash refund.'}
 }
 const s=await subscription(row,token,source,target)
 if(kind==='pause_subscription'){
  if(s.pause_collection)throw new ProviderFailure('subscription_already_paused')
  return {provider:'stripe',kind,target,source_id:source,currency:'USD',amount_cents:0,reason,proration:'No proration or credit. Future invoices remain draft and are not automatically collected.',effective:'Collection pauses immediately. Service entitlement is unchanged; resume collection in Stripe.'}
 }
 const priceId=id(options.next_price??options.price_id),date=options.proration_date
 if(!Number.isSafeInteger(date)||date>Math.floor(Date.now()/1000)||Math.floor(Date.now()/1000)-date>300)throw new ProviderFailure('proration_quote_expired')
 if(s.pending_update||s.pause_collection||s.cancel_at_period_end||s.items?.has_more||s.items?.data?.length!==1)throw new ProviderFailure('unsupported_subscription')
 const item=s.items.data[0];if(!Number.isSafeInteger(item.quantity)||item.quantity<=0||item.quantity>10000)throw new ProviderFailure('unsupported_quantity');const price=await request(row,token,'/v1/prices/'+priceId)
 if(price.id!==priceId||!price.active||price.currency!=='usd'||!integer(price.unit_amount)||!price.recurring||price.recurring.interval!==item.price?.recurring?.interval||price.recurring.interval_count!==item.price?.recurring?.interval_count||item.price?.currency!=='usd'||priceId===item.price.id)throw new ProviderFailure('unsupported_usd_plan')
 const query=new URLSearchParams({customer:source,subscription:target,'subscription_items[0][id]':item.id,'subscription_items[0][price]':priceId,'subscription_items[0][quantity]':String(item.quantity),subscription_proration_behavior:'always_invoice',subscription_proration_date:String(date)})
 const invoice=await request(row,token,'/v1/invoices/upcoming?'+query)
 if(invoice.customer!==source||invoice.currency!=='usd'||!integer(invoice.amount_due)||invoice.amount_due<0||!integer(invoice.total)||!integer(invoice.starting_balance??0)||invoice.lines?.has_more||!Array.isArray(invoice.lines?.data)||invoice.tax!=null&&!integer(invoice.tax))throw new ProviderFailure('proration_quote_unavailable')
 const lines=invoice.lines.data.map((line:any)=>({amount_cents:line.amount,proration:!!line.proration}));if(lines.some((line:any)=>!integer(line.amount_cents)))throw new ProviderFailure('proration_quote_unavailable')
 return {provider:'stripe',kind,target,source_id:source,currency:'USD',amount_cents:invoice.amount_due,total_cents:invoice.total,starting_balance_cents:invoice.starting_balance??0,tax_cents:invoice.tax??0,proration_lines:lines,previous_price:item.price.id,next_price:priceId,item_id:item.id,quantity:item.quantity,proration_date:date,reason,proration:'Invoice immediately at the fixed proration date shown. The update is refused if payment is incomplete.',effective_at:date}
}
export async function stripeBillingExecute(row:Connection,token:string,a:Action){
 if(a.kind==='credit')return request(row,token,`/v1/customers/${a.source_id}/balance_transactions`,{method:'POST',key:a.id,body:{amount:String(-a.amount_cents),currency:'usd',description:a.reason,'metadata[h2h_action]':a.id}})
 if(a.kind==='pause_subscription')return request(row,token,'/v1/subscriptions/'+a.target_id,{method:'POST',key:a.id,body:{'pause_collection[behavior]':'keep_as_draft','metadata[h2h_action]':a.id}})
 const p=JSON.parse(a.preview_json)
 return request(row,token,'/v1/subscriptions/'+a.target_id,{method:'POST',key:a.id,body:{'items[0][id]':p.item_id,'items[0][price]':p.next_price,'items[0][quantity]':String(p.quantity),proration_behavior:'always_invoice',proration_date:String(p.proration_date),payment_behavior:'error_if_incomplete','metadata[h2h_action]':a.id}})
}
export async function stripeBillingReadback(row:Connection,token:string,a:Action,remoteId:string|null){
 if(a.kind==='credit'){
  let result
  if(remoteId)result=await request(row,token,`/v1/customers/${a.source_id}/balance_transactions/${encodeURIComponent(remoteId)}`)
  else{const list=await request(row,token,`/v1/customers/${a.source_id}/balance_transactions?limit=100`);if(list.has_more)throw new ProviderFailure('reconciliation_incomplete');result=list.data.find((r:any)=>r.metadata?.h2h_action===a.id)}
  if(!result||result.customer!==a.source_id||result.amount!==-a.amount_cents||result.currency!=='usd'||result.metadata?.h2h_action!==a.id)throw new ProviderFailure('result_unconfirmed')
  return {id:result.id,state:'succeeded',kind:a.kind,amount_cents:a.amount_cents,currency:'USD',balance_after_cents:result.ending_balance}
 }
 const s=await request(row,token,'/v1/subscriptions/'+a.target_id)
 if(s.id!==a.target_id||s.customer!==a.source_id||s.metadata?.h2h_action!==a.id)throw new ProviderFailure('result_unconfirmed')
 if(a.kind==='pause_subscription'){
  if(s.pause_collection?.behavior!=='keep_as_draft')throw new ProviderFailure('result_unconfirmed')
  return {id:s.id,state:'succeeded',kind:a.kind,collection:'keep_as_draft'}
 }
 const p=JSON.parse(a.preview_json)
 if(s.pending_update||!s.items?.data?.some((i:any)=>i.id===p.item_id&&i.price?.id===p.next_price)||typeof s.latest_invoice!=='string')throw new ProviderFailure('result_unconfirmed')
 const invoice=await request(row,token,'/v1/invoices/'+s.latest_invoice)
 if(invoice.customer!==a.source_id||invoice.currency!=='usd'||!invoice.paid||invoice.amount_paid!==a.amount_cents)throw new ProviderFailure('result_unconfirmed')
 return {id:s.id,state:'succeeded',kind:a.kind,invoice_id:invoice.id,amount_cents:invoice.amount_paid,currency:'USD',next_price:p.next_price}
}
