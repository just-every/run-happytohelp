import { canonicalJson, sha256 } from '../../import-kit/src/provenance/identity'
import type { SourceRecord, Diagnostic, Json } from '../../import-kit/src/types'
import type { Vendor } from '../types'
export const object = (value:unknown):value is Record<string,any> => value !== null && typeof value === 'object' && !Array.isArray(value)
/** Zendesk and Freshdesk files hold one singular wrapper per line, such as `{"ticket":{...}}`. */
export const wrappedVendor=(vendor:Vendor)=>vendor==='zendesk'||vendor==='freshdesk'
export function sourceId(value:unknown,vendor:Vendor):string {
 if(wrappedVendor(vendor) && (typeof value==='number'&&Number.isSafeInteger(value)&&value>0 || typeof value==='string'&&/^[1-9][0-9]*$/.test(value)))return String(value)
 if((vendor==='intercom'||vendor==='helpscout'||vendor==='mailbox') && (typeof value==='string'&&!!value.trim()&&value.length<=512 || typeof value==='number'&&Number.isSafeInteger(value)&&value>=0))return String(value)
 throw new Error('invalid_source_id')
}
export function time(value:unknown,format:'iso'|'unix'):number {
 const milliseconds=format==='unix'?typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value*1000:NaN:typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)?Date.parse(value):NaN
 if(!Number.isSafeInteger(milliseconds)||milliseconds<0||milliseconds>8640000000000000)throw new Error('original_timestamp_missing_or_invalid')
 if(format==='iso'){const match=String(value).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|([+-])(\d{2}):(\d{2}))$/)!,offset=match[7]==='Z'?0:(match[8]==='-'?-1:1)*(Number(match[9])*60+Number(match[10]))*60000,local=new Date(milliseconds+offset),actual=[local.getUTCFullYear(),local.getUTCMonth()+1,local.getUTCDate(),local.getUTCHours(),local.getUTCMinutes(),local.getUTCSeconds()];if(actual.some((part,i)=>part!==Number(match[i+1])))throw new Error('original_timestamp_missing_or_invalid')}
 return milliseconds
}
export function text(value:unknown,label:string,max=100000):string {if(typeof value!=='string'||!value.trim()||value.length>max)throw new Error(label);return value}
export const nativeId = (project:string,vendor:Vendor,kind:string,id:string) => `mi_${sha256(canonicalJson([project,vendor,kind,id])).slice(0,40)}`
export const tagKey = (name:string) => name.trim().normalize('NFC').toLocaleLowerCase('en-US')
export const issue = (code:string,artifact:string,row?:number,pointer?:string):Diagnostic => ({severity:'error',code,message:code,location:{artifact,...(row?{row}:{}),...(pointer?{pointer}:{})}})
export function sourceRecord(vendor:Vendor,kind:string,id:string,payload:Json,name:string,hash:string,row:number,pointer?:string):SourceRecord {return {namespace:vendor,kind,sourceId:id,payload,payloadHash:sha256(canonicalJson(payload)),artifactHash:hash,location:{artifact:name,row,...(pointer?{pointer}:{})}}}
