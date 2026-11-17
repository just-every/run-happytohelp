/** A syntax scanner, not a second parsed object graph. Offsets remain relative to
 * the original bytes decoded as UTF-8, including leading whitespace/newlines. */
import {LIMITS} from '../types'
import {IndexLimitError} from './admission-error'
import {auditShape} from './shapes'
import {collectionNames,intercomDocument,RecordStructureError,zendeskCollections} from './classification'
export interface JsonPosition {start:number;end:number;row:number;pointer:string;unsupported?:string;error?:string;sourceKind?:string}
class LocatedError extends Error {offset:number;pointer:string;constructor(offset:number,pointer:string,code='invalid_json'){super(code);this.offset=offset;this.pointer=pointer}}
const escapePointer=(key:string)=>key.replace(/~/g,'~0').replace(/\//g,'~1')
export function jsonPositions(raw:string,maxRecords:number=LIMITS.records,recordOnly=false,observe?:(position:JsonPosition)=>void,zendesk=false):JsonPosition[] {
 let p=0,indexed=0,rootStart=0;const output:JsonPosition[]=[],properties:{key:string;position:JsonPosition;children?:JsonPosition[]}[]=[]
 // Potential collection entries and object fields are structural scan work.
 // A typed record can contain either without consuming extra source positions.
 // Keep that scan bounded independently of the remaining upload record budget.
 const keep=(target:JsonPosition[],position:JsonPosition)=>{if(++indexed>LIMITS.records)throw new IndexLimitError(position.row,position.pointer);target.push(position)}
 const property=(value:typeof properties[number])=>{if(properties.length>=LIMITS.records+3)throw new IndexLimitError(value.position.row,value.position.pointer);properties.push(value)}
 const newlines:number[]=[];for(let i=0;i<raw.length;i++)if(raw[i]==='\n')newlines.push(i)
 const row=(offset:number)=>{let lo=0,hi=newlines.length;while(lo<hi){const mid=(lo+hi)>>>1;if(newlines[mid]<offset)lo=mid+1;else hi=mid}return lo+1}
 const fail=(pointer:string,code='invalid_json'):never=>{throw new LocatedError(p,pointer,code)}
 const space=()=>{while(p<raw.length&&/[\x20\t\n\r]/.test(raw[p]))p++}
 const quoted=(pointer:string)=>{const start=p++;while(p<raw.length){const ch=raw[p++];if(ch==='"'){try{return JSON.parse(raw.slice(start,p)) as string}catch{p=start;fail(pointer)}}if(ch<' '){p--;fail(pointer)}if(ch==='\\'){const escaped=raw[p++];if(escaped==='\n'||escaped==='\r'){p--;fail(pointer)}if(escaped==='u'){if(!/^[0-9a-fA-F]{4}$/.test(raw.slice(p,p+4)))fail(pointer);p+=4}else if(!escaped||!'"\\/bfnrt'.includes(escaped))fail(pointer)}}fail(pointer)}
 const value=(pointer:string,depth:number,children?:JsonPosition[]):JsonPosition=>{
  space();const start=p;if(depth>128)fail(pointer,'source_structure_depth_limit')
  if(raw[p]==='"')quoted(pointer)
  else if(raw[p]==='{'){
   p++;space();const keys=new Set<string>();if(raw[p]==='}')p++;else for(;;){if(raw[p]!=='"')fail(pointer);const key=quoted(pointer)!,child=`${pointer}/${escapePointer(key)}`;if(keys.has(key))fail(child,'duplicate_json_field');keys.add(key);space();if(raw[p++]!==':'){p--;fail(child)}const position=value(child,depth+1);if(depth===0&&!recordOnly)property({key,position});space();if(raw[p]==='}'){p++;break}if(raw[p++]!==','){p--;fail(pointer)}space()}
  }else if(raw[p]==='['){p++;space();if(raw[p]===']')p++;else for(let i=0;;i++){const item=value(`${pointer}/${i}`,depth+1);if(children)keep(children,item);space();if(raw[p]===']'){p++;break}if(raw[p++]!==','){p--;fail(`${pointer}/${i}`)}space()}}
  else{const match=/^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(raw.slice(p));if(!match)fail(pointer);p+=match![0].length;if(p<raw.length&&!/[\x20\t\n\r,}\]]/.test(raw[p]))fail(pointer)}
  const position={start,end:p,row:row(start),pointer};observe?.(position);return position
 }
 // Top-level object scanning records each collection's children without keeping
 // their values. Valid earlier records remain diagnosable after a later error.
 const isEnvelope=()=>{
  if(zendesk){
   const collections=properties.filter(p=>zendeskCollections.has(p.key))
   if(!collections.length)return false
   for(const field of collections)if(!field.children)throw new LocatedError(field.position.start,field.position.pointer,'collection_must_be_array')
   return true
  }
  try{return 'envelope' in intercomDocument(properties.map(({key,position,children})=>({key,array:!!children,...(['type','kind'].includes(key)?{value:raw[position.start]==='"'?JSON.parse(raw.slice(position.start,position.end)):null}:{})})))}
  catch(error){if(!(error instanceof RecordStructureError))throw error;const field=properties.find(field=>`/${escapePointer(field.key)}`===error.pointer);throw new LocatedError(field?.position.start??rootStart,error.pointer,error.message)}
 }
 let expanded=false
 const root=()=>{
  space();const start=p;rootStart=p;if(recordOnly){output.push(value('',0));return}if(raw[p]==='['){value('',0,output);return}
  if(raw[p]!=='{'){output.push(value('',0));return}
  p++;space();if(raw[p]==='}'){p++;output.push({start,end:p,row:row(start),pointer:''});return}
  const keys=new Set<string>();for(;;){if(raw[p]!=='"')fail('');const key=quoted('')!,pointer=`/${escapePointer(key)}`;if(keys.has(key))fail(pointer,'duplicate_json_field');keys.add(key);space();if(raw[p++]!==':'){p--;fail(pointer)}space();const children:JsonPosition[]|undefined=raw[p]==='['?[]:undefined,begin=p;
   try{const position=value(pointer,1,children);property({key,position,children})}catch(error){if(children?.length)property({key,position:{start:begin,end:p,row:row(begin),pointer},children});throw error}
   space();if(raw[p]==='}'){p++;break}if(raw[p++]!==','){p--;fail('')}space()
  }
  expanded=isEnvelope();if(!expanded)output.push({start,end:p,row:row(start),pointer:''})
 }
 let error:LocatedError|undefined
 try{root();space();if(p!==raw.length)fail('')}catch(cause){if(!(cause instanceof LocatedError))throw cause;error=cause}
 // A syntax error can still expose earlier source positions for the reader's
 // diagnostics. Admission refuses the entire file on that error before custody.
 if(error&&!recordOnly&&properties.length){try{expanded=isEnvelope()}catch{expanded=false}}
 if(expanded){output.length=0;for(const property of properties){const known=zendesk?zendeskCollections.has(property.key):collectionNames.has(property.key);if(known&&property.children)output.push(...property.children.map(position=>zendesk?{...position,sourceKind:zendeskCollections.get(property.key)}:position));else {
  const metadata=(zendesk?['count','next_page','previous_page','meta','links','end_of_stream','after_cursor','after_url','end_time']:['type','kind','total_count','pages']).includes(property.key),body=raw.slice(property.position.start,property.position.end)
  if(!error&&metadata&&body.length<=LIMITS.recordBytes&&auditShape(zendesk?'zendesk':'intercom','$envelope',{[property.key]:JSON.parse(body)}).complete)continue
  if(property.children?.length)output.push(...property.children.map(position=>({...position,unsupported:property.key})));else output.push({...property.position,unsupported:property.key})
 }}}
 if(error)output.push({start:0,end:0,row:row(error.offset),pointer:error.pointer,error:error.message})
 if(output.length>maxRecords){const position=output[maxRecords];throw new IndexLimitError(position.row,position.pointer)}
 return output
}
