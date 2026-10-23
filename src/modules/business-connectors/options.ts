import {HTTPException} from 'hono/http-exception'
import {id,cents} from './model'

/** Canonical input is part of request identity and the human-approved preview. */
export function actionOptions(kind:string,input:any={}){
 const value=input??{}
 if(typeof value!=='object'||Array.isArray(value))throw new HTTPException(400,{message:'Use structured action options'})
 if(kind==='refund'){
  if(!Object.keys(value).length)return {}
  const mode=value.mode
  if(!['amount','items','full'].includes(mode))throw new HTTPException(400,{message:'Choose amount, selected items or full refund'})
  if(mode==='amount')return {mode}
  if(mode==='full')return {mode}
  if(!Array.isArray(value.items)||!value.items.length||value.items.length>20)throw new HTTPException(400,{message:'Select up to twenty refund items'})
  const items=value.items.map((x:any)=>({id:id(x.id),quantity:quantity(x.quantity)})).sort((a:any,b:any)=>a.id.localeCompare(b.id))
  if(new Set(items.map((x:any)=>x.id)).size!==items.length)throw new HTTPException(400,{message:'Select each line item once'})
  return {mode,items,shipping_cents:cents(value.shipping_cents??0)}
 }
 if(kind==='create_return')return {fulfillment_line_id:id(value.fulfillment_line_id),quantity:quantity(value.quantity),reason_definition_id:id(value.reason_definition_id)}
 if(kind==='cancel_order'){
  if(!['CUSTOMER','DECLINED','FRAUD','INVENTORY','OTHER','STAFF'].includes(value.cancellation_reason))throw new HTTPException(400,{message:'Choose a Shopify cancellation reason'})
  if(typeof value.restock!=='boolean')throw new HTTPException(400,{message:'Choose whether to restock the cancelled order'})
  return {cancellation_reason:value.cancellation_reason,restock:value.restock}
 }
 if(kind==='edit_fields'){
  if(!['contact','account'].includes(value.object))throw new HTTPException(400,{message:'Choose contact or account'})
  const changes=value.changes
  if(!changes||typeof changes!=='object'||Array.isArray(changes)||!Object.keys(changes).length||Object.keys(changes).length>10)throw new HTTPException(400,{message:'Choose up to ten approved fields'})
  return {object:value.object,changes:Object.fromEntries(Object.keys(changes).sort().map(key=>{
   if(!/^[A-Za-z_][A-Za-z0-9_]{0,79}$/.test(key)||!(changes[key]===null||['string','number','boolean'].includes(typeof changes[key]))||String(changes[key]).length>2000)throw new HTTPException(400,{message:'Use scalar CRM field values'})
   return [key,changes[key]]
  }))}
 }
 return {}
}
function quantity(value:unknown){if(!Number.isSafeInteger(value)||Number(value)<1||Number(value)>1000)throw new HTTPException(400,{message:'Use a positive whole item quantity'});return Number(value)}
