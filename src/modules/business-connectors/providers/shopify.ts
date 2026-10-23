import type {Connection,Action} from '../model'
import {request,ProviderFailure} from './http'
const endpoint='/admin/api/2026-10/graphql.json'
function usd(value:any){if(value?.currencyCode!=='USD'||typeof value.amount!=='string'||!/^\d+\.\d{2}$/.test(value.amount))throw new ProviderFailure('usd_required');const amount=Number(value.amount.replace('.',''));if(!Number.isSafeInteger(amount))throw new ProviderFailure('invalid_amount');return amount}
const amount=(cents:number)=>(cents/100).toFixed(2)
const marker=(action:Action)=>'HappyToHelp action '+action.id
export async function shopifyPreview(row:Connection,token:string,source:string,target:string,cents:number,reason:string){
 const response=await request(row,token,endpoint,{method:'POST',body:{query:'query BusinessRefundPreview($id:ID!){order(id:$id){id name customer{id} currencyCode presentmentCurrencyCode refundable totalTaxSet{shopMoney{amount currencyCode}} totalShippingPriceSet{shopMoney{amount currencyCode}} suggestedRefund(suggestFullRefund:true){maximumRefundableSet{presentmentMoney{amount currencyCode}} suggestedTransactions{gateway kind maximumRefundableSet{presentmentMoney{amount currencyCode}} parentTransaction{id}}}}}',variables:{id:'gid://shopify/Order/'+target}}})
 const order=response.data?.order
 if(response.errors||!order||order.id!=='gid://shopify/Order/'+target||order.customer?.id!=='gid://shopify/Customer/'+source)throw new ProviderFailure('identity_mismatch')
 if(order.currencyCode!=='USD'||order.presentmentCurrencyCode!=='USD'||!order.refundable)throw new ProviderFailure('usd_refundable_order_required')
 const suggested=order.suggestedRefund,remaining=usd(suggested?.maximumRefundableSet?.presentmentMoney)
 const transactions=suggested.suggestedTransactions.filter((x:any)=>x.kind==='REFUND'&&x.gateway&&x.parentTransaction?.id)
 // Multi-tender allocation needs its own preview; never guess which customer payment to refund.
 if(transactions.length!==1||cents<=0||cents>remaining||cents>usd(transactions[0].maximumRefundableSet?.presentmentMoney))throw new ProviderFailure('unsupported_refund_allocation')
 return {provider:'shopify',kind:'refund',target,order:order.name,source_id:source,currency:'USD',amount_cents:cents,remaining_cents:remaining,parent_transaction:transactions[0].parentTransaction.id,gateway:transactions[0].gateway,reason,original_tax_cents:usd(order.totalTaxSet.shopMoney),original_shipping_cents:usd(order.totalShippingPriceSet.shopMoney),tax:'Amount-only refund: no line-item tax allocation or invoice tax amendment.',shipping:'No shipping refund or restocking. This action does not create a return.',effective:'After Shopify confirms the refund transaction. No customer notification is sent automatically.'}
}
export async function shopifyExecute(row:Connection,token:string,action:Action){
 const p=JSON.parse(action.preview_json),response=await request(row,token,endpoint,{method:'POST',body:{query:'mutation BusinessRefund($input:RefundInput!,$key:String!){refundCreate(input:$input) @idempotent(key:$key){refund{id} userErrors{field message}}}',variables:{key:action.id,input:{orderId:'gid://shopify/Order/'+action.target_id,currency:'USD',allowOverRefunding:false,notify:false,note:action.reason+'\n'+marker(action),refundLineItems:[],transactions:[{orderId:'gid://shopify/Order/'+action.target_id,parentId:p.parent_transaction,gateway:p.gateway,kind:'REFUND',amount:amount(action.amount_cents)}]}}}})
 if(response.errors||response.data?.refundCreate?.userErrors?.length||!response.data?.refundCreate?.refund?.id)throw new ProviderFailure('provider_uncertain')
 return {id:response.data.refundCreate.refund.id}
}
export async function shopifyReadback(row:Connection,token:string,action:Action,remoteId:string|null){
 const response=await request(row,token,endpoint,{method:'POST',body:{query:'query BusinessRefundReadback($id:ID!){order(id:$id){id customer{id} refunds(first:100){id note totalRefundedSet{presentmentMoney{amount currencyCode}} transactions(first:100){nodes{id kind status amountSet{presentmentMoney{amount currencyCode}}}}}}}',variables:{id:'gid://shopify/Order/'+action.target_id}}})
 const order=response.data?.order;if(response.errors||order?.id!=='gid://shopify/Order/'+action.target_id||order.customer?.id!=='gid://shopify/Customer/'+action.source_id)throw new ProviderFailure('identity_mismatch')
 const refund=order.refunds.find((x:any)=>(!remoteId||x.id===remoteId)&&x.note===action.reason+'\n'+marker(action))
 if(!refund||usd(refund.totalRefundedSet?.presentmentMoney)!==action.amount_cents)throw new ProviderFailure('result_unconfirmed')
 const transactions=refund.transactions.nodes;if(transactions.length!==1||transactions[0].kind!=='REFUND'||usd(transactions[0].amountSet?.presentmentMoney)!==action.amount_cents)throw new ProviderFailure('result_unconfirmed')
 return {id:refund.id,kind:'refund',currency:'USD',amount_cents:action.amount_cents,provider_status:transactions[0].status,state:transactions[0].status==='SUCCESS'?'succeeded':transactions[0].status==='FAILURE'?'failed':'uncertain'}
}
