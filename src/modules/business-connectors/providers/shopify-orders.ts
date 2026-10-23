import type {Connection,Action} from '../model'
import {ProviderFailure} from './http'
import {graph,gid,ownedOrder,shopifyScopes} from './shopify-common'
const note=(action:Action)=>action.reason+'\nHappyToHelp action '+action.id
const orderFields='id name customer{id} currencyCode presentmentCurrencyCode cancelledAt cancelReason cancellation{staffNote} totalRefundedSet{presentmentMoney{amount currencyCode}}'
export async function shopifyOrderPreview(row:Connection,token:string,source:string,kind:string,target:string,reason:string,options:any){
 const input=options.input??options
 if(reason.length>180)throw new ProviderFailure('order_action_reason_too_long')
 await shopifyScopes(row,token,kind==='create_return'?['read_orders','read_returns','write_returns']:['read_orders','write_orders'])
 const data=await graph(row,token,`query BusinessOrderPreview($id:ID!){order(id:$id){${orderFields}}}`,{id:gid('Order',target)})
 const order=ownedOrder(data.order,source,target)
 if(order.cancelledAt)throw new ProviderFailure('order_already_cancelled')
 const common={provider:'shopify',kind,target,order:order.name,source_id:source,currency:'USD',amount_cents:0,reason,input,refund_before:order.totalRefundedSet,tax:'No tax adjustment or refund is included.',effective:'Only after Shopify confirms the exact action. No automatic customer notification.'}
 if(kind==='cancel_order')return {...common,shipping:input.restock?'Shopify restocks eligible inventory; captured payments are not refunded. Authorized payments are voided.':'No restocking or captured-payment refund. Shopify voids authorized payments.',notice:'Cancellation does not refund captured payments. Prepare a separate bounded refund if needed.'}
 if(kind!=='create_return')throw new ProviderFailure('action_not_supported')
 const available=await graph(row,token,'query BusinessReturnable($id:ID!,$reason:[ID!]){returnableFulfillments(orderId:$id,first:100){pageInfo{hasNextPage} nodes{returnableFulfillmentLineItems(first:100){pageInfo{hasNextPage} nodes{quantity fulfillmentLineItem{id}}}}} returnReasonDefinitions(first:10,ids:$reason){nodes{id name deleted}}}',{id:gid('Order',target),reason:[gid('ReturnReasonDefinition',input.reason_definition_id)]})
 if(available.returnableFulfillments?.pageInfo.hasNextPage||available.returnableFulfillments?.nodes.some((x:any)=>x.returnableFulfillmentLineItems.pageInfo.hasNextPage))throw new ProviderFailure('returnable_items_incomplete')
 const items=available.returnableFulfillments.nodes.flatMap((x:any)=>x.returnableFulfillmentLineItems.nodes),item=items.find((x:any)=>x.fulfillmentLineItem.id===gid('FulfillmentLineItem',input.fulfillment_line_id)),definition=available.returnReasonDefinitions.nodes.find((x:any)=>x.id===gid('ReturnReasonDefinition',input.reason_definition_id)&&!x.deleted)
 if(!item||item.quantity<input.quantity||!definition)throw new ProviderFailure('return_not_permitted')
 return {...common,available_quantity:item.quantity,return_reason:definition.name,shipping:'Creates an approved return and reverse fulfillment work. No label purchase, refund, receipt or restocking is implied.'}
}
export async function shopifyOrderExecute(row:Connection,token:string,action:Action){
 const p=JSON.parse(action.preview_json),input=p.input
 if(action.kind==='create_return'){
  const data=await graph(row,token,'mutation BusinessReturn($input:ReturnInput!){returnCreate(returnInput:$input){return{id} userErrors{field message}}}',{input:{orderId:gid('Order',action.target_id),returnLineItems:[{fulfillmentLineItemId:gid('FulfillmentLineItem',input.fulfillment_line_id),quantity:input.quantity,returnReasonDefinitionId:gid('ReturnReasonDefinition',input.reason_definition_id),returnReasonNote:note(action)}]}})
  if(data.returnCreate?.userErrors?.length||!data.returnCreate?.return?.id)throw new ProviderFailure('provider_uncertain')
  return {id:data.returnCreate.return.id}
 }
 const data=await graph(row,token,'mutation BusinessCancelOrder($order:ID!,$reason:OrderCancelReason!,$restock:Boolean!,$note:String!){orderCancel(orderId:$order,reason:$reason,restock:$restock,notifyCustomer:false,refundMethod:{originalPaymentMethodsRefund:false},staffNote:$note){jobResult{id done status errors{field message code}} orderCancelUserErrors{field message code}}}',{order:gid('Order',action.target_id),reason:input.cancellation_reason,restock:input.restock,note:note(action)})
 if(data.orderCancel?.orderCancelUserErrors?.length||!data.orderCancel?.jobResult?.id)throw new ProviderFailure('provider_uncertain')
 return {id:data.orderCancel.jobResult.id}
}
export async function shopifyOrderReadback(row:Connection,token:string,action:Action,remoteId:string|null){
 const p=JSON.parse(action.preview_json)
 if(action.kind==='cancel_order'){
  const data=await graph(row,token,`query BusinessCancelReadback($id:ID!){order(id:$id){${orderFields}}}`,{id:gid('Order',action.target_id)})
  const order=ownedOrder(data.order,action.source_id,action.target_id)
  if(remoteId){const job=await graph(row,token,'query BusinessCancelJob($id:ID!){node(id:$id){... on OrderCancelJobResult{id done status errors{field message code}}}}',{id:remoteId});if(job.node?.status==='FAILED')return {id:remoteId,state:'failed',kind:action.kind,provider_status:'FAILED'};if(!job.node?.done||job.node.status!=='SUCCEEDED'||job.node.errors?.length)throw new ProviderFailure('result_unconfirmed')}
  if(!remoteId&&p.input.restock)throw new ProviderFailure('result_unconfirmed')
  if(!order.cancelledAt||order.cancelReason!==p.input.cancellation_reason||order.cancellation?.staffNote!==note(action)||JSON.stringify(order.totalRefundedSet)!==JSON.stringify(p.refund_before))throw new ProviderFailure('result_unconfirmed')
  return {id:gid('Order',action.target_id),kind:action.kind,state:'succeeded',provider_status:'CANCELLED',cancelled_at:order.cancelledAt,notice:'Captured payments were not refunded.'}
 }
 const data=await graph(row,token,'query BusinessReturnReadback($id:ID!){order(id:$id){id customer{id} returns(first:100){pageInfo{hasNextPage} nodes{id status returnLineItems(first:100){pageInfo{hasNextPage} nodes{quantity ... on ReturnLineItem{fulfillmentLineItem{id} returnReasonDefinition{id} returnReasonNote}}}}}}}',{id:gid('Order',action.target_id)})
 const order=data.order
 if(order?.id!==gid('Order',action.target_id)||order.customer?.id!==gid('Customer',action.source_id)||order.returns.pageInfo.hasNextPage)throw new ProviderFailure('identity_mismatch')
 const matches=order.returns.nodes.filter((r:any)=>(!remoteId||r.id===remoteId)&&!r.returnLineItems.pageInfo.hasNextPage&&r.returnLineItems.nodes.length===1&&r.returnLineItems.nodes[0].returnReasonNote===note(action))
 if(matches.length!==1)throw new ProviderFailure('result_unconfirmed')
 const result=matches[0],item=result.returnLineItems.nodes[0]
 if(item.fulfillmentLineItem?.id!==gid('FulfillmentLineItem',p.input.fulfillment_line_id)||item.quantity!==p.input.quantity||item.returnReasonDefinition?.id!==gid('ReturnReasonDefinition',p.input.reason_definition_id)||!['OPEN','CLOSED'].includes(result.status))throw new ProviderFailure('result_unconfirmed')
 return {id:result.id,kind:action.kind,state:'succeeded',provider_status:result.status,notice:'Return created; receipt, restocking and refund are separate.'}
}
