import type {Connection} from '../model'
import {id} from '../model'
import {request,ProviderFailure} from './http'
const scalar=(value:unknown,max=500)=>typeof value==='string'?value.slice(0,max):null
const money=(value:any)=>value&&({amount:scalar(value.amount),currency:scalar(value.currencyCode)})
export async function identity(row:Connection,token:string){
 if(row.provider==='shopify'){
  const result=await request(row,token,'/admin/api/2026-10/graphql.json',{method:'POST',body:{query:'{ shop { id myshopifyDomain } currentAppInstallation { accessScopes { handle } } }'}})
  if(result.errors||result.data?.shop?.myshopifyDomain!==new URL(row.host).hostname)throw new ProviderFailure('identity_mismatch')
  return String(result.data.shop.id).split('/').pop()
 }
 if(row.provider==='stripe')return (await request(row,token,'/v1/account')).id
 if(row.provider==='hubspot')return String((await request(row,token,'/account-info/v3/details')).portalId)
 if(row.provider==='salesforce')return (await request(row,token,'/services/oauth2/userinfo')).organization_id
 const result=await request(row,token,`/api/v1/${encodeURIComponent(row.account)}`);return result.data?.attributes?.slug??result.data?.id
}
export async function context(row:Connection,token:string,source:string){
 source=id(source);const fields=JSON.parse(row.fields_json||'{}'),selected=Object.values(fields) as string[]
 if(row.provider==='stripe'){
  const customer=await request(row,token,'/v1/customers/'+source)
  if(customer.id!==source||customer.deleted)throw new ProviderFailure('identity_mismatch')
  const invoices=await request(row,token,`/v1/invoices?customer=${source}&limit=20`),subscriptions=await request(row,token,`/v1/subscriptions?customer=${source}&limit=20`)
  if([...invoices.data,...subscriptions.data].some((x:any)=>x.customer!==source))throw new ProviderFailure('identity_mismatch')
  return {source_id:source,customer:scalar(customer.name),invoices:invoices.data.map((x:any)=>({id:x.id,status:x.status,currency:x.currency,total_cents:x.total,tax_cents:x.tax??null,payment_intent:typeof x.payment_intent==='string'?x.payment_intent:null,url:scalar(x.hosted_invoice_url)})),subscriptions:subscriptions.data.map((x:any)=>({id:x.id,status:x.status,cancel_at_period_end:x.cancel_at_period_end,current_period_end:x.current_period_end})),truncated:!!invoices.has_more||!!subscriptions.has_more}
 }
 if(row.provider==='shopify'){
  const result=await request(row,token,'/admin/api/2026-10/graphql.json',{method:'POST',body:{query:'query($id:ID!){customer(id:$id){id displayName orders(first:20,sortKey:PROCESSED_AT,reverse:true){pageInfo{hasNextPage} nodes{id name displayFinancialStatus displayFulfillmentStatus totalPriceSet{shopMoney{amount currencyCode}} totalTaxSet{shopMoney{amount currencyCode}} totalShippingPriceSet{shopMoney{amount currencyCode}} totalRefundedSet{shopMoney{amount currencyCode}} fulfillments(first:10){status trackingInfo{company number url}} returns(first:10){nodes{id status}} refunds(first:10){id createdAt totalRefundedSet{shopMoney{amount currencyCode}}}}}}}',variables:{id:'gid://shopify/Customer/'+source}}})
  const customer=result.data?.customer;if(result.errors||!customer||customer.id!=='gid://shopify/Customer/'+source)throw new ProviderFailure('identity_mismatch')
  return {source_id:source,customer:scalar(customer.displayName),truncated:customer.orders.pageInfo.hasNextPage,orders:customer.orders.nodes.map((x:any)=>({id:String(x.id).split('/').pop(),name:x.name,financial:x.displayFinancialStatus,fulfillment:x.displayFulfillmentStatus,total:money(x.totalPriceSet?.shopMoney),tax:money(x.totalTaxSet?.shopMoney),shipping:money(x.totalShippingPriceSet?.shopMoney),refunded:money(x.totalRefundedSet?.shopMoney),delivery:x.fulfillments.map((f:any)=>({status:f.status,tracking:f.trackingInfo.map((t:any)=>({company:scalar(t.company),number:scalar(t.number)}))})),returns:x.returns.nodes.map((r:any)=>({id:r.id,status:r.status})),refunds:x.refunds.map((r:any)=>({id:r.id,created_at:r.createdAt,total:money(r.totalRefundedSet?.shopMoney)}))}))}
 }
 if(row.provider==='hubspot'){
  const r=await request(row,token,`/crm/v3/objects/contacts/${source}?properties=firstname,lastname,company,hubspot_owner_id,lifecyclestage,hs_lastmodifieddate${selected.length?','+selected.join(','):''}`)
  if(String(r.id)!==source||r.archived)throw new ProviderFailure('identity_mismatch')
  const p=r.properties??{};return {source_id:source,customer:[scalar(p.firstname),scalar(p.lastname)].filter(Boolean).join(' '),company:scalar(p.company),owner:scalar(p.hubspot_owner_id),plan:scalar(p[fields.plan]),entitlement:scalar(p[fields.entitlement]),lifecycle:scalar(p.lifecyclestage),source_revision:scalar(r.updatedAt)}
 }
 if(row.provider==='salesforce'){
  const r=await request(row,token,`/services/data/v66.0/sobjects/Contact/${source}?fields=Id,Name,AccountId,OwnerId,LastModifiedDate${selected.length?','+selected.join(','):''}`)
  if(r.Id!==source)throw new ProviderFailure('identity_mismatch')
  return {source_id:source,customer:scalar(r.Name),company:scalar(r.AccountId),owner:scalar(r.OwnerId),plan:scalar(r[fields.plan]),entitlement:scalar(r[fields.entitlement]),source_revision:scalar(r.LastModifiedDate)}
 }
 const r=await request(row,token,`/api/v1/${encodeURIComponent(row.account)}/members/${source}`)
 if(String(r.data?.id)!==source)throw new ProviderFailure('identity_mismatch')
 const p=r.data.attributes??{};return {source_id:source,customer:scalar(p.name),company:scalar(p.company),owner:null,plan:scalar(p[fields.plan]),entitlement:scalar(p[fields.entitlement]),community_level:scalar(p.orbit_level),source_revision:scalar(p.updated_at)}
}
