import {mediaAssociations} from './media-links'
import type {LegacyBundle,MappedRow,Row} from './types'
import type {MappingProfile} from './adoption/profile'
import {historical} from './adoption/profile'
import {sourceColumns} from './source-columns'
import {fieldRule,type FieldRule} from './field-rules'
import {archiveOnly} from './archive-only'

export interface FieldDisposition extends FieldRule {table:string;field:string;rows:number;nulls:number}
export interface SourceRow {table:string;sourceId:string;row:Row;mapped:MappedRow[];hold?:string}
/** Content-free, bounded by field names, never by source text or native values. */
export function fieldDispositions(rows:SourceRow[],context:LegacyBundle,profile?:MappingProfile){
 const fields:FieldDisposition[]=[]
 for(const source of rows)for(const [field,value] of Object.entries(source.row)){
  let rule=fieldRule(source.table,field)
  if(rule.kind==='omitted')rule={kind:'unclassified',reason:'Normally omitted by exporter, but this input supplied the field; cannot claim export omission or safe archive'}
  if(rule.kind!=='omitted'&&rule.kind!=='unclassified'){
   if(archiveOnly(source.table,source.row,context))rule={kind:'archive',reason:'Deleted row or deleted parent; private source custody without native restoration'}
   else if(!source.mapped.length&&source.table==='media'&&!source.hold&&['native','normalized','control'].includes(rule.kind))rule={...rule,kind:'control',reason:rule.reason+'; media source row is journaled as archive-only, while referenced file-door targets are emitted with the project/article that uses the URL; see object/file-door outcomes'}
   else if(!source.mapped.length)rule={kind:'archive',reason:source.hold?(source.table==='media'?'Media association held; original source media/link identities and reasons are recorded in private row holds':source.hold):(historical(profile)&&['users','project_users','ai_defaults'].includes(source.table)?'Historical policy preserves source attribution without accounts, access, settings or defaults':rule.reason+'; this row has no eligible native target')}
   else if(historical(profile)&&source.table==='contacts'&&field==='is_verified')rule={kind:'normalized',target:'contacts.is_verified',reason:'Cleared to zero; old verification fact retained only in private source journal'}
  }
  if(source.table==='projects'&&field==='availability_schedule'&&value!=null&&source.mapped.length){
   const schedule=typeof value==='string'?JSON.parse(value):value
   if(schedule&&typeof schedule==='object'&&!Array.isArray(schedule)&&Object.keys(schedule).length&&!Array.isArray((schedule as Row).days))rule={kind:'archive',reason:'Source schedule has no recognized native days/time representation; private source and settings JSON retain it, but opening hours are not restored'}
  }
  fields.push({table:source.table,field,...rule,rows:1,nulls:value==null?1:0})
 }
 return mergeFieldDispositions([],fields)
}
export function mergeFieldDispositions(left:FieldDisposition[],right:FieldDisposition[]){
 const counts=new Map<string,FieldDisposition>()
 for(const row of [...left,...right]){const key=JSON.stringify([row.table,row.field,row.kind,row.target,row.reason]),prior=counts.get(key);counts.set(key,prior?{...prior,rows:prior.rows+row.rows,nulls:prior.nulls+row.nulls}:{...row})}
 return [...counts.values()].sort((a,b)=>a.table.localeCompare(b.table)||a.field.localeCompare(b.field)||a.reason.localeCompare(b.reason))
}
/** Schema filtering is reported separately from source field mapping. */
export function mergeTargetColumnOmissions(rows:{table:string;field:string;rows:number;reason:string}[]){const counts=new Map<string,typeof rows[number]>();for(const row of rows){const key=row.table+'.'+row.field,prior=counts.get(key);counts.set(key,{...row,rows:row.rows+(prior?.rows??0)})}return [...counts.values()]}
export function targetColumnOmissions(rows:SourceRow[],schemas:Map<string,Set<string>>){
 const counts=new Map<string,{table:string;field:string;rows:number;reason:string}>()
 for(const source of rows)for(const mapped of source.mapped)for(const [field,value] of Object.entries(mapped.row))if(value!==undefined&&!schemas.get(mapped.table)?.has(field)){
  const key=mapped.table+'.'+field,prior=counts.get(key)
  counts.set(key,{table:mapped.table,field,rows:(prior?.rows??0)+1,reason:'Mapped property absent from installed target schema; not written, never evidence of native support'})
 }
 return [...counts.values()]
}
export function sourceHold(table:string,row:Row,profile?:MappingProfile,context?:LegacyBundle){
 if(table==='media'&&context){const association=mediaAssociations(row,context);return association.holds.length?association.holds.join('; '):undefined}
 if(table==='macros'&&!historical(profile)&&!(row.created_by_id??row.created_by))return 'macros.created_by_id is unknown; no approved custodian in administrative CLI, saved reply held in private source archive'
}
/** Export omissions are not archive custody. Counts belong to exporter scope,
 * not context descriptors; do not add them again for each package chunk. */
export function exportDispositions(source:LegacyBundle['source']){
 const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{}
 const omittedColumns=Object.fromEntries(Object.entries(record(source.omittedColumns)).filter(([table])=>sourceColumns[table]).map(([table,fields])=>[table,Array.isArray(fields)?fields.filter((field):field is string=>typeof field==='string'&&fieldRule(table,field).kind==='omitted'):[]]))
 const excludedTables=Array.isArray(source.excludedTables)?source.excludedTables.filter((table):table is string=>typeof table==='string'&&!!sourceColumns[table]&&sourceColumns[table].split(' ').every(field=>fieldRule(table,field).kind==='omitted')):[]
 // Exact reviewed nested paths, never arbitrary manifest metadata or values.
 const omittedJsonPaths={events:{payload:[['contact_message','contact','hash'],['contact_message','contact','metadata','hash'],['contact_message','contact','metadata','admin']]},messages:{content:[['data','clientConfiguration','braintreeApi','accessToken'],['data','tokenizeUsBankAccount','paymentMethod','id'],['data','tokenizeUsBankAccount','paymentMethod','legacyId']]},contacts:{metadata:[['admin']]},conversations:{metadata:[['customer_reply'],['suggestions']]}}
 const counts=(value:unknown)=>Object.fromEntries(Object.entries(record(value)).filter(([key,n])=>{const [table,field]=key.split('.');return !!sourceColumns[table]?.split(' ').includes(field)&&typeof n==='number'&&Number.isSafeInteger(n)&&n>=0}))
 return {omittedColumns,excludedTables,omittedJsonPaths,omittedJsonValueCounts:counts(source.omittedJsonValueCounts),omittedTextValueCounts:counts(source.omittedTextValueCounts),repeatedCredentialValueCounts:counts(source.repeatedCredentialValueCounts),reason:'Removed before export; never retained in source journals'}
}
