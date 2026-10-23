import type {Connection,Action} from '../model'
import {request,ProviderFailure} from './http'
import {crmContext} from './crm-context'
function fieldValue(meta:any,value:any,hub:boolean){
 const type=meta.type,choices=hub?meta.options:meta.picklistValues
 if(hub?meta.modificationMetadata?.readOnlyValue:!meta.updateable)throw new ProviderFailure('field_read_only')
 if(value===null){if(!hub&&!meta.nillable)throw new ProviderFailure('field_required');return hub?'':null}
 if(['bool','boolean'].includes(type)){if(![true,false,'true','false'].includes(value))throw new ProviderFailure('invalid_field_value');return hub?String(value):String(value)==='true'}
 if(['number','double','int','currency','percent'].includes(type)){if(value===''||!Number.isFinite(Number(value))||(type==='int'&&!Number.isSafeInteger(Number(value))))throw new ProviderFailure('invalid_field_value');return hub?String(Number(value)):Number(value)}
 if(['enumeration','picklist','multipicklist'].includes(type)){
  const values=String(value).split(';');if(type==='picklist'&&values.length!==1||values.some(v=>!choices?.some((x:any)=>x.value===v&&(hub?!x.hidden:x.active))))throw new ProviderFailure('invalid_field_value');return String(value)
 }
 if(!['string','textarea','text','phone','url','email','date','datetime'].includes(type)||typeof value!=='string'||(!hub&&meta.length&&value.length>meta.length))throw new ProviderFailure('invalid_field_value')
 if(type==='date'&&!/^\d{4}-\d{2}-\d{2}$/.test(value)||type==='datetime'&&!Number.isFinite(Date.parse(value)))throw new ProviderFailure('invalid_field_value')
 return value
}
export async function crmFieldPreview(row:Connection,token:string,source:string,target:string,reason:string,options:any){
 const input=options.input??options,object=input.object,recordId=target.slice(target.indexOf(':')+1),snapshot=await crmContext(row,token,source),hub=row.provider==='hubspot',config=JSON.parse(row.fields_json),allowed=config[object==='account'?'editable_account':'editable_contact']??[]
 if(target!==object+':'+recordId||object==='contact'&&recordId!==source)throw new ProviderFailure('identity_mismatch')
 const record=object==='contact'?snapshot:snapshot.accounts.find((x:any)=>x.id===recordId)
 if(!record||object==='account'&&!snapshot.relationships_complete||!record.source_revision||!snapshot.source_revision)throw new ProviderFailure('account_relationship_unavailable')
 const keys=Object.keys(input.changes)
 if(keys.some(key=>!allowed.includes(key)))throw new ProviderFailure('field_scope_refused')
 const type=object==='contact'?(hub?'contacts':'Contact'):(hub?'companies':'Account'),after:Record<string,unknown>={}
 let metadata:any
 if(!hub){metadata=await request(row,token,`/services/data/v66.0/sobjects/${type}/describe`);if(!metadata.updateable)throw new ProviderFailure('field_read_only')}
 for(const key of keys){const field=hub?await request(row,token,`/crm/v3/properties/${type}/${key}`):metadata.fields.find((x:any)=>x.name===key);if(!field||field.name!==key)throw new ProviderFailure('field_scope_refused');after[key]=fieldValue(field,input.changes[key],hub)}
 return {provider:row.provider,kind:'edit_fields',target,record_id:recordId,object,type,source_id:source,amount_cents:0,reason,input,before:Object.fromEntries(keys.map(key=>[key,record.fields[key]??null])),after,source_revision:record.source_revision,customer_revision:snapshot.source_revision,notice:hub?'Only the approved fields are changed. HubSpot has no conditional update; conflicts observed before execution or during readback are surfaced.':'Only the approved fields are changed with a conditional source-revision guard.'}
}
export async function crmFieldExecute(row:Connection,token:string,action:Action){
 const p=JSON.parse(action.preview_json),hub=row.provider==='hubspot'
 await request(row,token,hub?`/crm/v3/objects/${p.type}/${p.record_id}`:`/services/data/v66.0/sobjects/${p.type}/${p.record_id}`,{method:'PATCH',body:hub?{properties:p.after}:p.after,...(!hub?{unmodifiedSince:new Date(p.source_revision).toUTCString()}:{})})
 return {id:p.record_id}
}
export async function crmFieldReadback(row:Connection,token:string,action:Action){
 const p=JSON.parse(action.preview_json),snapshot=await crmContext(row,token,action.source_id),record=p.object==='contact'?snapshot:snapshot.accounts.find((x:any)=>x.id===p.record_id)
 if(!record||p.object==='account'&&!snapshot.relationships_complete)throw new ProviderFailure('identity_mismatch')
 for(const [key,value] of Object.entries(p.after)){const actual=record.fields[key];if(value===null?actual!==null:String(actual??'')!==String(value))throw new ProviderFailure('source_conflict')}
 return {id:p.record_id,state:'succeeded',kind:action.kind,object:p.object,fields:p.after,source_revision:record.source_revision}
}
