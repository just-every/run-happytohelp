import type {Row,LegacyBundle} from '../types'
import type {ImportDoorPackageUpload} from '../../import-kit/src/door/types'
import {DoorError} from '../../import-kit/src/door/protocol'
import {canonicalJson,sha256} from '../../import-kit/src/provenance/identity'
import {safeValue} from '../../import-kit/src/readers/records'
import {LEGACY_LIMITS} from './limits'
// @ts-expect-error The exporter and receiver share this pure source policy.
import {classifySnapshot} from '../../../../scripts/legacy-export/secrets.mjs'
// @ts-expect-error Shared credential-only omissions of the actual exporter.
import {skippedTables,credentialColumns} from '../../../../scripts/legacy-export/scope.mjs'

export interface Part {table:string;count:number;file:string;bytes:number;sha256:string}
export interface LegacyObject {key:string;mediaId:string|number;file:string;size:number;sha256:string}
export interface Manifest {format:'happytohelp-legacy-chunks-v1';source:LegacyBundle['source']&{projectId:string|number;rowCounts:Record<string,number>;cloneCounts:Record<string,number>;attachments:Attachment[]};chunks:Part[];context:Part[];objects:LegacyObject[];attachmentsComplete:true;exportedAt?:string;mediaBytes?:number}
interface Attachment {key:string;disk:string;sourceKey:string;mediaId:string|number}
export interface DecodedLegacy {manifest:Manifest;bundle:LegacyBundle;objects:{metadata:LegacyObject;bytes:Uint8Array}[];manifestHash:string}
export const count=(n:unknown):n is number=>Number.isSafeInteger(n)&&(n as number)>=0
export const plain=(value:unknown):value is Row=>!!value&&typeof value==='object'&&!Array.isArray(value)
const fileName=(value:unknown):value is string=>typeof value==='string'&&/^\w[\w.-]*$/.test(value)&&!['index.ndjson','rer-package.json'].includes(value)
export function invalid(reason:string):never{throw new DoorError('source_invalid_or_credential_source_data',422,{reason})}
const fields:Record<string,string[]|null>={projects:null,users:['id','type','email','deleted_at'],ais:null,ai_defaults:null,contacts:['id','project_id','deleted_at','identifier','external_id','created_at'],conversations:['id','project_id','contact_id','deleted_at'],messages:['id','project_id','conversation_id','contact_id','agent_id','ai_id','created_at','deleted_at'],mediables:null,datasets:null,dataset_files:['id','dataset_id','deleted_at','updated_at','created_at','markdown','content'],media:null}
const keySegment=(value:unknown)=>encodeURIComponent(String(value)).replace(/\./g,'%2E')
function policy(table:string,rows:Row[]){try{classifySnapshot({tables:{[table]:rows}});safeValue(rows)}catch{throw new DoorError('source_credential',422,{reason:'Legacy source policy refused a row. Re-pass the complete package before uploading again.'})}}
function decode(bytes:Uint8Array):unknown{try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}catch{return invalid('Legacy package file is not valid UTF-8 JSON.')}}

/** The accessor verifies path-bound bytes. This decoder also verifies the inner
 * manifest, source counts, exact projected context and complete media binding.
 * It deliberately materializes the complete bounded snapshot. */
export async function decodeLegacy(upload:ImportDoorPackageUpload,maxRecords:number):Promise<DecodedLegacy>{
 const outer=upload.manifest,raw=await upload.read('manifest.json',LEGACY_LIMITS.fileBytes),value=decode(raw)
 if(!plain(value)||value.format!=='happytohelp-legacy-chunks-v1'||!plain(value.source)||!Array.isArray(value.chunks)||!Array.isArray(value.context)||!Array.isArray(value.objects)||value.attachmentsComplete!==true)invalid('Incomplete legacy package manifest.')
 const manifest=value as unknown as Manifest,s=manifest.source
 if(s.repository!=='happytohelp'||typeof s.revision!=='string'||!/^[a-f0-9]{40}$/i.test(s.revision)||typeof s.exportedAt!=='string'||!Number.isFinite(Date.parse(s.exportedAt))||!['string','number'].includes(typeof s.projectId)||!String(s.projectId)||!plain(s.rowCounts)||!plain(s.cloneCounts)||!Array.isArray(s.attachments))invalid('Legacy source provenance is incomplete.')
 if(outer.mode!=='snapshot'||outer.source.version!==1||outer.source.origin!=='legacy-database'||outer.source.adapter!=='rer:happytohelp-legacy'||outer.source.exportedAt!==(manifest.exportedAt??s.exportedAt)||outer.source.synthetic!==(s.synthetic===true)||outer.records.total!==null||Object.keys(outer.records.byKind).length)invalid('Legacy source declaration differs from the complete database snapshot.')
 if(manifest.exportedAt!==undefined&&manifest.exportedAt!==s.exportedAt)invalid('Legacy export timestamps disagree.')
 if(s.excludedTables!==undefined&&(!Array.isArray(s.excludedTables)||s.excludedTables.some((table:unknown)=>typeof table!=='string'||!skippedTables.includes(table))))invalid('Legacy business-table exclusion is unsupported.')
 if(s.omittedColumns!==undefined){if(!plain(s.omittedColumns))invalid('Invalid legacy column omissions.');for(const [table,fields] of Object.entries(s.omittedColumns))if(!Array.isArray(fields)||fields.some(field=>typeof field!=='string'||!credentialColumns[table]?.includes(field)))invalid('Legacy business-column omission is unsupported.')}
 safeValue(manifest)
 let total=0
 for(const [table,n] of Object.entries(s.rowCounts)){if(!/^[a-z][a-z0-9_]*$/.test(table)||!count(n)||s.cloneCounts[table]!==n)invalid('Legacy source and independent snapshot counts differ.');total+=n}
 if(Object.keys(s.cloneCounts).length!==Object.keys(s.rowCounts).length||!Number.isSafeInteger(total))invalid('Legacy snapshot counts are invalid.')
 if(total+manifest.objects.length+1>maxRecords)throw new DoorError('plan_exceeds_grant_quota',413,{reason:'The complete primary rows and objects exceed the record grant.'})
 const files=new Map(upload.files.map(file=>[file.path,file])),used=new Set(['manifest.json']),tables:Record<string,Row[]>=Object.create(null),context:Record<string,Row[]>=Object.create(null)
 async function part(part:Part,into:Record<string,Row[]>){
  if(!plain(part)||typeof part.table!=='string'||!Object.hasOwn(s.rowCounts,part.table)||!count(part.count)||!fileName(part.file)||used.has(part.file)||!count(part.bytes)||part.bytes<2||part.bytes>LEGACY_LIMITS.fileBytes)invalid('Invalid legacy row/context part.')
  const file=files.get(part.file);if(!file||file.bytes!==part.bytes||file.sha256!==part.sha256)invalid('Legacy part differs from its path-bound index.')
  used.add(part.file);const rows=decode(await upload.read(part.file,LEGACY_LIMITS.fileBytes))
  if(!Array.isArray(rows)||rows.length!==part.count||!rows.every(plain))invalid('Legacy part row count or shape differs.')
  policy(part.table,rows);for(const row of rows)(into[part.table]??=[]).push(row)
 }
 for(const p of manifest.chunks)await part(p,tables)
 for(const [table,n] of Object.entries(s.rowCounts))if((tables[table]?.length??0)!==n)invalid('Legacy primary table count differs.')
 for(const p of manifest.context){if(!Object.hasOwn(fields,p.table))invalid('Unknown legacy mapping context.');await part(p,context)}
 for(const [table,projection] of Object.entries(fields)){
  const expected=(tables[table]??[]).map(row=>projection?Object.fromEntries(projection.filter(key=>row[key]!==undefined).map(key=>[key,row[key]])):row)
  if(canonicalJson(expected)!==canonicalJson(context[table]??[]))invalid('Legacy context disagrees with primary rows.')
 }
 if(tables.projects?.length!==1||String(tables.projects[0].id)!==String(s.projectId))invalid('Legacy project provenance differs from the scoped project.')
 for(const [table,rows] of Object.entries(tables))for(const row of rows)if(row.project_id!=null&&String(row.project_id)!==String(s.projectId))invalid('Legacy row refers to another source project.')
 const media=new Map((tables.media??[]).map(row=>[String(row.id),row])),objects:DecodedLegacy['objects']=[],keys=new Set<string>(),ids=new Set<string>();let objectBytes=0
 if(media.size!==(tables.media?.length??0)||s.attachments.length!==manifest.objects.length||media.size!==manifest.objects.length)invalid('Legacy media/object accounting differs.')
 for(const object of manifest.objects){
  if(!plain(object)||!fileName(object.file)||used.has(object.file)||!count(object.size)||typeof object.key!=='string'||keys.has(object.key)||ids.has(String(object.mediaId)))invalid('Invalid legacy object descriptor.')
  const row=media.get(String(object.mediaId)),entry=s.attachments.find(entry=>String(entry.mediaId)===String(object.mediaId)),file=files.get(object.file)
  if(!row||!entry||!file||file.bytes!==object.size||file.sha256!==object.sha256||String(row.id)!==String(entry.mediaId)||!['s3','public'].includes(String(row.disk))||typeof row.filename!=='string'||!row.filename||/[/\\\x00]/.test(row.filename)||row.extension!=null&&typeof row.extension!=='string'||/[/\\\x00]/.test(String(row.extension??'')))invalid('Legacy media metadata differs from its object.')
  const basename=row.filename+(row.extension?'.'+row.extension:''),sourceKey=`${row.directory||''}/${basename}`.replace(/^\/+|\/+$/g,'')
  if(/[\\\x00-\x1f\x7f]/.test(sourceKey)||sourceKey.split('/').some(part=>!part||part==='.'||part==='..')||object.key!==`legacy/projects/${keySegment(s.projectId)}/media/${keySegment(row.id)}`||entry.key!==object.key||entry.disk!==row.disk||entry.sourceKey!==sourceKey||Number(row.size)!==object.size||!count(Number(row.size))||row.sha256!=null&&row.sha256!==object.sha256||row.object_key!=null&&row.object_key!==object.key||row.storage_key!=null&&row.storage_key!==object.key)invalid('Legacy attachment key, ownership, size or digest binding differs.')
  const bytes=await upload.read(object.file,LEGACY_LIMITS.fileBytes);if(sha256(bytes)!==object.sha256)invalid('Legacy object digest differs.')
  keys.add(object.key);ids.add(String(object.mediaId));used.add(object.file);objectBytes+=bytes.length;objects.push({metadata:object,bytes})
 }
 if(used.size!==files.size||[...files.keys()].some(file=>!used.has(file))||manifest.mediaBytes!==undefined&&manifest.mediaBytes!==objectBytes||canonicalJson(outer.totals)!==canonicalJson({rowCounts:s.rowCounts,objects:{count:objects.length,bytes:objectBytes}}))invalid('Legacy inner and outer totals or file inventories differ.')
 return {manifest,bundle:{format:'happytohelp-legacy-v1',source:s,tables},objects,manifestHash:sha256(raw)}
}
