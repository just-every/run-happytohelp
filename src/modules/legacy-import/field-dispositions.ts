import {mediaAssociations} from './media-links'
import type {LegacyBundle,MappedRow,Row} from './types'
import type {MappingProfile} from './adoption/profile'
import {historical} from './adoption/profile'
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
   else if(!source.mapped.length)rule={kind:'archive',reason:source.hold?(source.table==='media'?'Media association held; original source media/link identities and reasons are recorded in private row holds':source.hold):(historical(profile)&&['users','project_users','ai_defaults'].includes(source.table)?'Historical policy preserves source attribution without accounts, access, settings or defaults':rule.reason+'; this row has no eligible native target')}
   else if(historical(profile)&&source.table==='contacts'&&field==='is_verified')rule={kind:'normalized',target:'contacts.is_verified',reason:'Cleared to zero; old verification fact retained only in private source journal'}
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
 return {omittedColumns:source.omittedColumns??{},excludedTables:source.excludedTables??[],omittedJsonPaths:source.omittedJsonPaths??{},omittedJsonValueCounts:source.omittedJsonValueCounts??{},omittedTextValueCounts:source.omittedTextValueCounts??{},repeatedCredentialValueCounts:source.repeatedCredentialValueCounts??{},reason:'Removed before export; never retained in source journals'}
}
