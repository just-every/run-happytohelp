import type {Connection} from '../model'
import {request,ProviderFailure} from './http'
export const endpoint='/admin/api/2026-10/graphql.json'
export const gid=(type:string,value:string)=>`gid://shopify/${type}/${value}`
export const amount=(cents:number)=>(cents/100).toFixed(2)
export function usd(value:any){
 if(value?.currencyCode!=='USD'||typeof value.amount!=='string'||!/^\d+(?:\.\d{1,2})?$/.test(value.amount))throw new ProviderFailure('usd_required')
 const [whole,fraction='']=value.amount.split('.'),result=Number(whole)*100+Number(fraction.padEnd(2,'0'));if(!Number.isSafeInteger(result))throw new ProviderFailure('invalid_amount');return result
}
export async function graph(row:Connection,token:string,query:string,variables:any={}){
 const response=await request(row,token,endpoint,{method:'POST',body:{query,variables}})
 if(response.errors||!response.data)throw new ProviderFailure('provider_refused')
 return response.data
}
export async function shopifyScopes(row:Connection,token:string,required:string[]){
 const data=await graph(row,token,'query BusinessScopes { shop { id myshopifyDomain } currentAppInstallation { accessScopes { handle } } }')
 if(data.shop?.id!==gid('Shop',row.account)||data.shop?.myshopifyDomain!==new URL(row.host).hostname)throw new ProviderFailure('identity_mismatch')
 const scopes=new Set(data.currentAppInstallation?.accessScopes?.map((x:any)=>x.handle))
 if(required.some(scope=>!scopes.has(scope)))throw new ProviderFailure('grant_refused')
}
export function ownedOrder(order:any,source:string,target:string){
 if(order?.id!==gid('Order',target)||order.customer?.id!==gid('Customer',source))throw new ProviderFailure('identity_mismatch')
 if(order.currencyCode!=='USD'||order.presentmentCurrencyCode!=='USD')throw new ProviderFailure('usd_required')
 return order
}
