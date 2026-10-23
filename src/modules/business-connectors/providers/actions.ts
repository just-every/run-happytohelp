import {extendedStripeKinds,stripeBillingPreview,stripeBillingExecute,stripeBillingReadback} from './stripe-billing'
import {shopifyPreview,shopifyExecute,shopifyReadback} from './shopify'
import type {Connection,Action} from '../model'
import {request,ProviderFailure} from './http'
import {context} from './context'
export async function preview(row:Connection,token:string,source:string,kind:string,target:string,amount:number,reason:string,options:any={}){
 if(row.provider==='stripe'&&extendedStripeKinds.includes(kind))return stripeBillingPreview(row,token,source,kind,target,amount,reason,options)
 if(row.provider==='shopify'&&kind==='refund')return shopifyPreview(row,token,source,target,amount,reason)
 if(row.provider==='stripe'&&kind==='refund'){
  const payment=await request(row,token,'/v1/payment_intents/'+target),refunds=await request(row,token,`/v1/refunds?payment_intent=${target}&limit=100`)
  if(payment.customer!==source||payment.id!==target)throw new ProviderFailure('identity_mismatch')
  if(payment.currency!=='usd'||payment.status!=='succeeded'||refunds.has_more||!Number.isSafeInteger(payment.amount_received))throw new ProviderFailure('unsupported_payment')
  if(refunds.data.some((r:any)=>r.payment_intent!==target||r.currency!=='usd'||!Number.isSafeInteger(r.amount)))throw new ProviderFailure('identity_mismatch')
  const remaining=payment.amount_received-refunds.data.filter((r:any)=>!['failed','canceled'].includes(r.status)).reduce((sum:number,r:any)=>sum+r.amount,0)
  if(amount<=0||amount>remaining)throw new ProviderFailure('refund_exceeds_remaining')
  return {provider:'stripe',kind,target,source_id:source,currency:'USD',amount_cents:amount,remaining_cents:remaining,reason,tax:'Refund does not amend invoice tax; review the original invoice.',shipping:'No shipping adjustment.',effective:'When Stripe confirms the refund; bank settlement may take longer.'}
 }
 if(row.provider==='stripe'&&kind==='cancel_subscription'){
  const subscription=await request(row,token,'/v1/subscriptions/'+target)
  if(subscription.customer!==source||subscription.id!==target)throw new ProviderFailure('identity_mismatch')
  if(!['active','trialing','past_due'].includes(subscription.status)||subscription.cancel_at_period_end||!Number.isSafeInteger(subscription.current_period_end))throw new ProviderFailure('unsupported_subscription')
  return {provider:'stripe',kind,target,source_id:source,currency:'USD',amount_cents:0,reason,proration:'No credit or proration; cancel at the end of the current period.',effective_at:subscription.current_period_end,tax:'No invoice or tax change.'}
 }
 if(['hubspot','salesforce'].includes(row.provider)&&kind==='support_outcome'){
  const snapshot=await context(row,token,source)
  return {provider:row.provider,kind,target:source,source_id:source,amount_cents:0,reason,source_revision:(snapshot as any).source_revision,notice:'Only this approved outcome is shared. No private notes, transcript or other CRM fields are sent.'}
 }
 throw new ProviderFailure('action_not_supported')
}
export async function execute(row:Connection,token:string,action:Action){
 if(row.provider==='shopify')return shopifyExecute(row,token,action)
 if(row.provider==='stripe'){
  if(extendedStripeKinds.includes(action.kind))return stripeBillingExecute(row,token,action)
  if(action.kind==='refund')return request(row,token,'/v1/refunds',{method:'POST',key:action.id,body:{payment_intent:action.target_id,amount:String(action.amount_cents),'metadata[h2h_action]':action.id}})
  return request(row,token,'/v1/subscriptions/'+action.target_id,{method:'POST',key:action.id,body:{cancel_at_period_end:'true','metadata[h2h_action]':action.id}})
 }
 if(row.provider==='hubspot')return request(row,token,'/crm/v3/objects/notes',{method:'POST',body:{properties:{hs_timestamp:new Date().toISOString(),hs_note_body:action.reason.replace(/[<>&"']/g,char=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[char]!))},associations:[{to:{id:action.source_id},types:[{associationCategory:'HUBSPOT_DEFINED',associationTypeId:202}]}]}})
 if(row.provider==='salesforce')return request(row,token,'/services/data/v66.0/sobjects/Task',{method:'POST',body:{WhoId:action.source_id,Subject:'Support outcome',Description:action.reason,Status:'Completed'}})
 throw new ProviderFailure('orbit_scoped_api_unavailable')
}
export async function readback(row:Connection,token:string,action:Action,remoteId:string|null){
 if(row.provider==='shopify')return shopifyReadback(row,token,action,remoteId)
 if(row.provider==='stripe'&&extendedStripeKinds.includes(action.kind))return stripeBillingReadback(row,token,action,remoteId)
 if(row.provider==='stripe'&&action.kind==='refund'){
  let result
  if(remoteId)result=await request(row,token,'/v1/refunds/'+encodeURIComponent(remoteId))
  else {const list=await request(row,token,`/v1/refunds?payment_intent=${action.target_id}&limit=100`);if(list.has_more)throw new ProviderFailure('reconciliation_incomplete');result=list.data.find((r:any)=>r.metadata?.h2h_action===action.id)}
  if(!result||result.payment_intent!==action.target_id||result.amount!==action.amount_cents||result.currency!=='usd'||result.metadata?.h2h_action!==action.id)throw new ProviderFailure('result_unconfirmed')
  return {id:result.id,state:result.status==='succeeded'?'succeeded':['failed','canceled'].includes(result.status)?'failed':'uncertain',kind:action.kind,amount_cents:result.amount,currency:'USD',provider_status:result.status}
 }
 if(row.provider==='stripe'){
  const result=await request(row,token,'/v1/subscriptions/'+action.target_id)
  if(result.customer!==action.source_id||!result.cancel_at_period_end||result.metadata?.h2h_action!==action.id)throw new ProviderFailure('result_unconfirmed')
  return {id:result.id,state:'succeeded',kind:action.kind,effective_at:result.current_period_end,cancel_at_period_end:true}
 }
 if(!remoteId)throw new ProviderFailure('result_unconfirmed')
 if(row.provider==='hubspot'){
  const r=await request(row,token,'/crm/v3/objects/notes/'+encodeURIComponent(remoteId)+'?properties=hs_note_body&associations=contacts')
  if(r.id!==remoteId||!r.associations?.contacts?.results?.some((x:any)=>String(x.id)===action.source_id))throw new ProviderFailure('result_unconfirmed')
 }else if(row.provider==='salesforce'){
  const r=await request(row,token,'/services/data/v66.0/sobjects/Task/'+encodeURIComponent(remoteId));if(r.Id!==remoteId||r.WhoId!==action.source_id||r.Description!==action.reason||r.Status!=='Completed')throw new ProviderFailure('result_unconfirmed')
 }else {
  throw new ProviderFailure('orbit_scoped_api_unavailable')
 }
 return {id:remoteId,state:'succeeded',kind:action.kind}
}
