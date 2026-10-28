import {sha256,canonicalJson} from '../../import-kit/src/provenance/identity'
import {object,sourceId,wrappedVendor} from './common'
import {LIMITS} from '../types'
import type {Vendor} from '../types'

export class RecordStructureError extends Error {
 readonly pointer:string
 constructor(code:string,pointer=''){super(code);this.pointer=pointer}
}
export const collectionNames=new Set(['contacts','conversations','data','articles','macros'])
const identifiedKinds={zendesk:new Set(['user','ticket','macro','article','tag']),freshdesk:new Set(['contact','agent','ticket','canned_response']),intercom:new Set(['contact','user','lead','conversation','macro','article','tag','tag-name'])}
export function recordSourceId(kind:string,payload:Record<string,any>,vendor:Vendor):string {
 // A standalone Zendesk tag inventory can identify tags by their actual names.
 // Prefer an explicit original ID when supplied; never invent a fallback ID.
 if(vendor==='zendesk'&&kind==='tag'&&!Object.hasOwn(payload,'id')&&typeof payload.name==='string'&&payload.name.trim())return payload.name
 if(vendor==='helpscout'&&(kind.startsWith('inbox-list:')||kind.startsWith('docs-list:')))return sha256(canonicalJson(payload))
 if(vendor==='helpscout'&&kind==='article-draft')return sourceId(payload.article?.id,vendor)
 if(vendor==='helpscout'&&kind==='thread-page'){const match=typeof payload._links?.self?.href==='string'?payload._links.self.href.match(/\/v2\/conversations\/([1-9][0-9]*)\/threads(?:[?#]|$)/):null;if(!match)throw new RecordStructureError('thread_page_conversation_link_required');return `${match[1]}:${sourceId(payload.page?.number,vendor)}`}
 if(vendor==='helpscout'&&kind.startsWith('metadata:'))return `${kind}:${sha256(canonicalJson(payload))}`
 return sourceId(payload.id,vendor)
}
export interface DocumentField {key:string;array:boolean;value?:unknown}
const escape=(key:string)=>key.replace(/~/g,'~0').replace(/\//g,'~1')
const fields=(value:Record<string,unknown>):DocumentField[]=>Object.entries(value).map(([key,value])=>({key,array:Array.isArray(value),value}))
/** Explicit source discriminators precede collection inference, for supported and
 * unsupported records alike. Conflicting/malformed discriminators cannot select
 * one interpretation and discard identities from another. The syntax index uses
 * the same decision with scalar discriminator values and structural descriptors;
 * it never needs a second full parsed document graph. */
export function intercomDocument(properties:DocumentField[]):{kind:string}|{envelope:true} {
 const discriminators=['type','kind'].map(key=>properties.find(field=>field.key===key)).filter((field):field is DocumentField=>!!field)
 for(const field of discriminators)if(typeof field.value!=='string'||!field.value.trim())throw new RecordStructureError('invalid_record_discriminator',`/${field.key}`)
 if(discriminators.length===2&&discriminators[0].value!==discriminators[1].value)throw new RecordStructureError('conflicting_record_discriminator','/kind')
 const kind=discriminators[0]?.value as string|undefined,list=kind!==undefined&&/^(?:list|.+\.list)$/.test(kind),hasId=properties.some(field=>field.key==='id')
 if(kind&&!list)return {kind}
 if(list&&hasId)throw new RecordStructureError('ambiguous_record_envelope','/id')
 const envelope=list||!hasId&&properties.some(field=>collectionNames.has(field.key)||field.array)
 if(!envelope)throw new RecordStructureError('explicit_record_type_required')
 for(const field of properties)if(collectionNames.has(field.key)&&!field.array)throw new RecordStructureError('collection_must_be_array',`/${escape(field.key)}`)
 return {envelope:true}
}
/** Freshdesk attachment and avatar URLs carry signed access keys, which import custody must never keep.
 * The pointer of the first such link, or null. The Move in script removes them before upload. */
function signedLink(value:unknown,path=''):string|null{
 if(typeof value==='string'){try{const url=new URL(value);if(['https:','http:'].includes(url.protocol)&&(url.username||url.password||/(?:token|secret|key|auth|signature|credential|password|cookie)[^=&#]*=/i.test(url.hash)))return path}catch{};return /^(?:https?:\/\/|\/)[^?#]*\?(?:[^#]*&)?[^=&#]*(?:token|secret|key|auth|signature|credential|password|cookie)[^=&#]*=/i.test(value)?path:null}
 if(Array.isArray(value)){for(let i=0;i<value.length;i++){const found=signedLink(value[i],`${path}/${i}`);if(found!==null)return found}return null}
 if(object(value))for(const [key,child] of Object.entries(value)){const found=signedLink(child,`${path}/${escape(key)}`);if(found!==null)return found}
 return null
}
/** Both mapping and pre-custody auditing lower a record through this function.
 * Ambiguous wrappers are refused in full, rather than admitting a partial plan. */
export function classifyRecord(value:unknown,vendor:Vendor):{kind:string;payload:Record<string,any>;prefix:string} {
 if(!object(value))throw new RecordStructureError('record_must_be_object')
 if(wrappedVendor(vendor)){
  const keys=Object.keys(value)
  if(keys.length!==1)throw new RecordStructureError('singular_wrapper_required')
  const kind=keys[0],prefix=`/${escape(kind)}`,payload=value[kind]
  if(!/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(kind)||!object(payload))throw new RecordStructureError('singular_wrapper_required',prefix)
  if(vendor==='zendesk'&&kind==='tag'){try{recordSourceId(kind,payload,vendor)}catch{throw new RecordStructureError('invalid_source_id',prefix)}}
  if(!identifiedKinds[vendor as 'zendesk'|'freshdesk'].has(kind)){try{sourceId(payload.id,vendor)}catch{throw new RecordStructureError('unsupported_wrapper_requires_record_id',prefix)}}
  if(vendor==='freshdesk'||vendor==='zendesk'){const link=signedLink(payload);if(link!==null)throw new RecordStructureError('signed_download_link_not_accepted',prefix+link)}
  // Zendesk's singular wrapper is authoritative. Payload type is ordinary
  // vendor metadata (for example a ticket's problem/incident/question/task),
  // never an alternative document discriminator.
  return {kind,payload,prefix}
 }
 const classification=intercomDocument(fields(value))
 if('envelope' in classification)throw new RecordStructureError('record_required_inside_collection')
 if(!identifiedKinds.intercom.has(classification.kind)){try{sourceId(value.id,vendor)}catch{throw new RecordStructureError('unsupported_wrapper_requires_record_id')}}
 return {...classification,payload:value,prefix:''}
}
/** Unknown envelope fields can still hold explicit vendor records. Their parent
 * is unsupported, not their discriminator or identity. Admission and queued
 * parsing share this decision. An opaque position gets a bounded structural
 * check for nested discriminators before becoming a source-only omission. This
 * never examines text or enters an already identified record's payload. Nested
 * wrappers are refused as a whole, rather than inventing a kind for their record.
 * The check also applies to older persisted source offsets on queue resume. */
export function lowerPosition(value:unknown,vendor:Vendor,unsupported?:string,sourceKind?:string){
 if(vendor==='helpscout'){if(!sourceKind||!sourceKind.startsWith('metadata:')&&!object(value))throw new RecordStructureError('helpscout_document_shape_required');return {kind:sourceKind,payload:sourceKind.startsWith('metadata:')?{value}:value as Record<string,any>,prefix:''}}
 if(unsupported!==undefined&&(!object(value)||!Object.hasOwn(value,'type')&&!Object.hasOwn(value,'kind'))){
  let nodes=0
  const inspect=(current:unknown,depth:number):void=>{
   if(++nodes>LIMITS.opaqueNodes)throw new RecordStructureError('opaque_structure_node_limit')
   if(depth>128)throw new RecordStructureError('source_structure_depth_limit')
   if(object(current)){
    if(Object.hasOwn(current,'type')||Object.hasOwn(current,'kind'))throw new RecordStructureError('unsupported_nested_envelope')
    for(const key of Object.keys(current))inspect(current[key],depth+1)
   }else if(Array.isArray(current))for(const item of current)inspect(item,depth+1)
  }
  inspect(value,0)
  return {field:unsupported,payload:value,nodes} as const
 }
 return classifyRecord(value,vendor)
}
