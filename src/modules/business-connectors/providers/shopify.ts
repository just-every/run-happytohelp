import type {Connection,Action} from '../model'
import {ProviderFailure} from './http'
import {graph,gid,amount,usd,ownedOrder,shopifyScopes} from './shopify-common'
const marker=(action:Action)=>action.reason+'\nHappyToHelp action '+action.id
const bag='presentmentMoney{amount currencyCode}'
export async function shopifyPreview(row:Connection,token:string,source:string,target:string,cents:number,reason:string,options:any={}){
 await shopifyScopes(row,token,['read_orders','write_orders'])
 const input=options.input??options,mode=input.mode??'amount',allocated=mode!=='amount'
 const lines=mode==='items'?input.items.map((x:any)=>({lineItemId:gid('LineItem',x.id),quantity:x.quantity,restockType:'NO_RESTOCK'})):[]
 const data=await graph(row,token,`query BusinessRefundPreview($id:ID!,$lines:[RefundLineItemInput!],$shipping:Money,$full:Boolean!,$refundShipping:Boolean!){order(id:$id){id name customer{id} currencyCode presentmentCurrencyCode refundable totalTaxSet{shopMoney{amount currencyCode}} totalShippingPriceSet{shopMoney{amount currencyCode}} suggestedRefund(suggestFullRefund:$full,refundLineItems:$lines,shippingAmount:$shipping,refundShipping:$refundShipping,refundMethodAllocation:ORIGINAL_PAYMENT_METHODS){amountSet{${bag}} maximumRefundableSet{${bag}} totalTaxSet{${bag}} totalDutiesSet{${bag}} refundLineItems{lineItem{id} quantity subtotalSet{${bag}} totalTaxSet{${bag}}} shipping{amountSet{${bag}} taxSet{${bag}}} suggestedTransactions{gateway kind amountSet{${bag}} maximumRefundableSet{${bag}} parentTransaction{id}}}}}`,{id:gid('Order',target),lines,shipping:mode==='items'?amount(input.shipping_cents):null,full:mode!=='items',refundShipping:mode==='full'})
 const order=ownedOrder(data.order,source,target)
 if(!order.refundable)throw new ProviderFailure('usd_refundable_order_required')
 const suggested=order.suggestedRefund,remaining=usd(suggested?.maximumRefundableSet?.presentmentMoney)
 if(allocated&&usd(suggested.totalDutiesSet.presentmentMoney)>0)throw new ProviderFailure('duty_refund_not_supported')
 if(allocated)cents=usd(suggested.amountSet.presentmentMoney)
 const transactions=suggested.suggestedTransactions.filter((x:any)=>x.kind==='SUGGESTED_REFUND'&&x.gateway&&x.parentTransaction?.id).sort((a:any,b:any)=>a.parentTransaction.id.localeCompare(b.parentTransaction.id))
 if(!transactions.length||new Set(transactions.map((x:any)=>x.parentTransaction.id)).size!==transactions.length||cents<=0||cents>remaining)throw new ProviderFailure('unsupported_refund_allocation')
 let unallocated=cents
 const tenders=transactions.map((x:any)=>{const maximum=usd(x.maximumRefundableSet.presentmentMoney),part=allocated?usd(x.amountSet.presentmentMoney):Math.min(unallocated,maximum);if(part>maximum||part>unallocated)throw new ProviderFailure('unsupported_refund_allocation');unallocated-=part;return {parent_transaction:x.parentTransaction.id,gateway:x.gateway,amount_cents:part}}).filter((x:any)=>x.amount_cents>0)
 if(unallocated!==0)throw new ProviderFailure('unsupported_refund_allocation')
 const refundItems=allocated?suggested.refundLineItems.map((x:any)=>({id:x.lineItem.id,quantity:x.quantity,subtotal_cents:usd(x.subtotalSet.presentmentMoney),tax_cents:usd(x.totalTaxSet.presentmentMoney)})).sort((a:any,b:any)=>a.id.localeCompare(b.id)):[]
 if(mode==='items'&&JSON.stringify(refundItems.map((x:any)=>({id:x.id,quantity:x.quantity})))!==JSON.stringify(lines.map((x:any)=>({id:x.lineItemId,quantity:x.quantity}))))throw new ProviderFailure('refund_items_mismatch')
 return {provider:'shopify',kind:'refund',target,order:order.name,source_id:source,currency:'USD',input,amount_cents:cents,remaining_cents:remaining,tenders,refund_items:refundItems,reason,original_tax_cents:usd(order.totalTaxSet.shopMoney),original_shipping_cents:usd(order.totalShippingPriceSet.shopMoney),...(allocated?{tax_cents:usd(suggested.totalTaxSet.presentmentMoney),shipping_cents:usd(suggested.shipping.amountSet.presentmentMoney),shipping_tax_cents:usd(suggested.shipping.taxSet.presentmentMoney)}:{}),tax:allocated?'Shopify-calculated item and shipping tax, shown separately.':'Amount-only refund: no line-item tax allocation or invoice tax amendment.',shipping:allocated?'Only the previewed shipping amount is refunded. No inventory restocking.':'No shipping refund or restocking. This action does not create a return.',effective:'After every Shopify refund transaction succeeds. No customer notification is sent automatically.'}
}
export async function shopifyExecute(row:Connection,token:string,action:Action){
 const p=JSON.parse(action.preview_json),input:any={orderId:gid('Order',action.target_id),currency:'USD',allowOverRefunding:false,notify:false,note:marker(action),refundLineItems:p.refund_items.map((x:any)=>({lineItemId:x.id,quantity:x.quantity,restockType:'NO_RESTOCK'})),transactions:p.tenders.map((x:any)=>({orderId:gid('Order',action.target_id),parentId:x.parent_transaction,gateway:x.gateway,kind:'REFUND',amount:amount(x.amount_cents)}))}
 if(p.input.mode==='full')input.shipping={fullRefund:true}
 if(p.input.mode==='items')input.shipping={amount:amount(p.input.shipping_cents)}
 const data=await graph(row,token,'mutation BusinessRefund($input:RefundInput!,$key:String!){refundCreate(input:$input) @idempotent(key:$key){refund{id} userErrors{field message}}}',{key:action.id,input})
 if(data.refundCreate?.userErrors?.length||!data.refundCreate?.refund?.id)throw new ProviderFailure('provider_uncertain')
 return {id:data.refundCreate.refund.id}
}
export async function shopifyReadback(row:Connection,token:string,action:Action,remoteId:string|null){
 const data=await graph(row,token,`query BusinessRefundReadback($id:ID!){order(id:$id){id customer{id} refunds(first:100){id note totalRefundedSet{${bag}} refundLineItems(first:100){pageInfo{hasNextPage} nodes{lineItem{id} quantity restockType subtotalSet{${bag}} totalTaxSet{${bag}}}} refundShippingLines(first:100){pageInfo{hasNextPage} nodes{subtotalAmountSet{${bag}} taxAmountSet{${bag}}}} transactions(first:100){pageInfo{hasNextPage} nodes{id kind status gateway parentTransaction{id} amountSet{${bag}}}}}}}`,{id:gid('Order',action.target_id)})
 const order=data.order;if(order?.id!==gid('Order',action.target_id)||order.customer?.id!==gid('Customer',action.source_id))throw new ProviderFailure('identity_mismatch')
 const matches=order.refunds.filter((x:any)=>(!remoteId||x.id===remoteId)&&x.note===marker(action)),p=JSON.parse(action.preview_json)
 if(matches.length!==1)throw new ProviderFailure('result_unconfirmed')
 const refund=matches[0]
 if(usd(refund.totalRefundedSet.presentmentMoney)!==action.amount_cents||[refund.transactions,refund.refundLineItems,refund.refundShippingLines].some(x=>!x||x.pageInfo?.hasNextPage))throw new ProviderFailure('result_unconfirmed')
 const transactions=refund.transactions.nodes
 if(transactions.length!==p.tenders.length)throw new ProviderFailure('result_unconfirmed')
 for(const t of p.tenders){const match=transactions.filter((x:any)=>x.kind==='REFUND'&&x.parentTransaction?.id===t.parent_transaction&&x.gateway===t.gateway&&usd(x.amountSet.presentmentMoney)===t.amount_cents);if(match.length!==1)throw new ProviderFailure('result_unconfirmed')}
 const items=refund.refundLineItems.nodes.map((x:any)=>({id:x.lineItem.id,quantity:x.quantity,subtotal_cents:usd(x.subtotalSet.presentmentMoney),tax_cents:usd(x.totalTaxSet.presentmentMoney)})).sort((a:any,b:any)=>a.id.localeCompare(b.id))
 if(JSON.stringify(items)!==JSON.stringify(p.refund_items)||refund.refundLineItems.nodes.some((x:any)=>x.restockType!=='NO_RESTOCK'))throw new ProviderFailure('result_unconfirmed')
 if(p.tax_cents!=null){const shipping=refund.refundShippingLines.nodes;if(shipping.reduce((n:number,x:any)=>n+usd(x.subtotalAmountSet.presentmentMoney),0)!==p.shipping_cents||shipping.reduce((n:number,x:any)=>n+usd(x.taxAmountSet.presentmentMoney),0)!==p.shipping_tax_cents||items.reduce((n:number,x:any)=>n+x.tax_cents,0)+p.shipping_tax_cents!==p.tax_cents)throw new ProviderFailure('result_unconfirmed')}
 const success=transactions.every((x:any)=>x.status==='SUCCESS'),failed=transactions.every((x:any)=>x.status==='FAILURE')
 return {id:refund.id,kind:'refund',currency:'USD',amount_cents:action.amount_cents,provider_status:success?'SUCCESS':failed?'FAILURE':'UNCONFIRMED',state:success?'succeeded':failed?'failed':'uncertain',transactions:transactions.map((x:any)=>({id:x.id,status:x.status}))}
}
