import type { Diagnostic, SourceRecord } from '../../import-kit/src/types'
import { sha256 } from '../../import-kit/src/provenance/identity'
import { LIMITS, type Vendor } from '../types'
import { issue, sourceRecord, wrappedVendor } from './common'
import {lowerPosition,recordSourceId,RecordStructureError} from './classification'
import type { ExportFile } from './archive'
import {isAttachmentMember} from './attachment-references'
export interface ParsedItem { record?:SourceRecord; diagnostic?:Diagnostic; ordinal:number;serialized?:string }
import {helpScoutPositions} from './helpscout-input'
import {IndexLimitError} from './admission-error'
import {jsonPositions,type JsonPosition} from './json-index'
interface Item extends JsonPosition {raw:string}
export interface RecordPosition extends JsonPosition {}
function* items(file:ExportFile,vendor:Vendor,maxRecords:number):Generator<Item> {
 if(isAttachmentMember(file.name))return
 if(/(?:^|\/)attachments\//i.test(file.name))throw new Error('attachment_original_retained_not_imported')
 const raw=new TextDecoder('utf-8',{fatal:true}).decode(file.bytes).replace(/^\uFEFF/,''),extension=file.name.split('.').pop()?.toLowerCase()
 if(wrappedVendor(vendor)||extension==='jsonl'){
  if(vendor==='intercom'&&extension!=='jsonl')throw new Error('unsupported_file_extension')
 let row=1,start=0;while(start<raw.length){const newline=raw.indexOf('\n',start),end=newline<0?raw.length:newline,line=raw.slice(start,end);if(line.trim()){
  try{for(const position of vendor==='helpscout'?helpScoutPositions(line,maxRecords):jsonPositions(line,maxRecords,wrappedVendor(vendor)))yield {...position,raw:line.slice(position.start,position.end),start:start+position.start,end:start+position.end,row}}
  catch(error){if(error instanceof IndexLimitError)throw new IndexLimitError(row,error.pointer);throw error}
 };start=end+1;row++}return
 }
 if(extension!=='json')throw new Error('unsupported_file_extension')
 // An empty member contributes no positions; whole-upload admission decides
 // whether other files supply records after all physical archive chunks.
 if(!raw.trim())return
 for(const position of (vendor==='helpscout'?helpScoutPositions(raw,maxRecords):jsonPositions(raw,maxRecords)))yield {...position,raw:raw.slice(position.start,position.end)}
}
function classify(value:unknown,vendor:Vendor,item:JsonPosition):{kind:string;id:string;payload:any;omittedField?:true} {
 const lowered=lowerPosition(value,vendor,item.unsupported,item.sourceKind)
 if('field' in lowered)return {kind:`unsupported-field:${lowered.field}`,id:item.pointer,payload:lowered.payload,omittedField:true}
 const {kind,payload}=lowered
 if(kind==='conversation'&&typeof payload.conversation_parts?.total_count==='number'&&!Number.isFinite(payload.conversation_parts.total_count))throw new Error('conversation_parts_count_invalid_or_incomplete')
 return {kind,id:recordSourceId(kind,payload,vendor),payload}
}
/** Source offsets are indexed once, then saved with the private file descriptor.
 * Later queue chunks parse only their bounded slice, with original physical lines. */
export function indexFile(file:ExportFile,vendor:Vendor,maxRecords:number=LIMITS.records):RecordPosition[] {
 const positions:RecordPosition[]=[]
 try{for(const item of items(file,vendor,maxRecords)){if(positions.length>=maxRecords)throw new IndexLimitError(item.row,item.pointer);positions.push({start:item.start,end:item.end,row:item.row,pointer:item.pointer,...(item.sourceKind?{sourceKind:item.sourceKind}:{}),...(item.error?{error:item.error}:{}),...(item.unsupported!==undefined?{unsupported:item.unsupported}:{})})}}
 catch(error){if(error instanceof Error&&error.message==='export_record_limit')throw error;positions.push({start:0,end:0,row:1,pointer:'',error:error instanceof TypeError?'invalid_utf8':error instanceof Error?error.message:'invalid_export'})}
 return positions
}
export function* parseFile(file:ExportFile,vendor:Vendor,start=0,limit=LIMITS.parseBatch,index=indexFile(file,vendor)):Generator<ParsedItem> {
 if(isAttachmentMember(file.name))return
 const hash=sha256(file.bytes);let raw:string;try{raw=new TextDecoder('utf-8',{fatal:true}).decode(file.bytes).replace(/^\uFEFF/,'')}catch{yield {ordinal:start,diagnostic:issue('invalid_utf8',file.name,1)};return}
 for(let ordinal=start;ordinal<Math.min(index.length,start+limit);ordinal++){
  const item=index[ordinal]
  if(item.error){yield {ordinal,diagnostic:issue(item.error,file.name,item.row,item.pointer)};continue}
  const body=raw.slice(item.start,item.end)
  if(new TextEncoder().encode(body).length>LIMITS.recordBytes){yield {ordinal,diagnostic:issue('record_size_limit',file.name,item.row,item.pointer)};continue}
  try{const value=JSON.parse(body),parsed=classify(value,vendor,item),record=sourceRecord(vendor,parsed.kind,parsed.id,parsed.payload,file.name,hash,item.row,item.pointer)
   const diagnostic=item.unsupported!==undefined&&!parsed.omittedField?{...issue('unsupported_source_field',file.name,item.row,item.pointer),severity:'warning' as const,kind:parsed.kind,sourceId:parsed.id,message:`unsupported_envelope_field:${item.unsupported}`} : undefined
   yield {ordinal,record:{...record,payload:parsed.payload},serialized:JSON.stringify(parsed.payload),...(diagnostic?{diagnostic}:{})}
  }catch(error){yield {ordinal,diagnostic:issue(error instanceof Error?error.message:'invalid_record',file.name,item.row,item.pointer+(error instanceof RecordStructureError?error.pointer:''))}}
 }
}
