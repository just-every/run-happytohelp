import {LEGACY_LIMITS,type LegacyPackageManifest,type LegacyFileKind,type LegacyPart,type LegacyObject} from '../worker-contract'
import {exportedObjectKey} from '../media-index'
import {refuse} from './errors'
// The exporter owns this inventory; the reader cannot admit a table it cannot scope.
// @ts-expect-error The exporter is an existing JavaScript module.
import {directTables,childScopes} from '../../../../scripts/legacy-export/scope.mjs'
export const hex256=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)
export const encodedBytes=(value:string)=>new TextEncoder().encode(value).length
export function identifier(value:unknown){return (typeof value==='string'||typeof value==='number')&&String(value).length>0&&encodedBytes(String(value))<=512&&!/[\x00-\x1f\x7f]/.test(String(value))}
export function filename(value:unknown):value is string{return typeof value==='string'&&identifier(value)&&/^\w[\w.-]*$/.test(value)&&value!=='manifest.json'}
const number=(value:unknown,max=Number.MAX_SAFE_INTEGER):value is number=>Number.isSafeInteger(value)&&Number(value)>=0&&Number(value)<=max
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)
const tables=new Set<string>([...directTables,...Object.keys(childScopes),'users','ai_defaults','media','mediables','local_agent_devices','local_agent_grants','article_categories'])
export type Descriptor={kind:LegacyFileKind;ordinal:number;part:LegacyPart|LegacyObject}
export function descriptors(manifest:LegacyPackageManifest):Descriptor[]{return [
 ...manifest.chunks.map((part,ordinal)=>({kind:'chunk' as const,ordinal,part})),
 ...manifest.context.map((part,ordinal)=>({kind:'context' as const,ordinal,part})),
 ...manifest.objects.map((part,ordinal)=>({kind:'object' as const,ordinal,part})),
]}
export function validateManifest(value:unknown):LegacyPackageManifest{
 if(!object(value)||value.format!=='happytohelp-legacy-chunks-v1')refuse('unsupported_package',422)
 const s=value.source
 if(!object(s)||!identifier(s.projectId)||typeof s.projectId!=='string'||!identifier(s.repository)||!identifier(s.revision)||typeof s.exportedAt!=='string'||!Number.isFinite(Date.parse(s.exportedAt))||!object(s.rowCounts)||!Array.isArray(s.attachments))refuse('invalid_manifest',400)
 if(!Array.isArray(value.chunks)||!Array.isArray(value.context)||!Array.isArray(value.objects)||value.attachmentsComplete!==true)refuse('invalid_manifest',400)
 const m=value as unknown as LegacyPackageManifest,all=descriptors(m),names=new Set<string>(),keys=new Set<string>(),media=new Set<string>(),counts:Record<string,number>={}
 if(all.length>LEGACY_LIMITS.descriptors)refuse('invalid_manifest',400)
 let bytes=0
 for(const {kind,part} of all){
  if(!object(part)||!filename(part.file)||names.has(part.file)||!hex256(part.sha256))refuse('invalid_manifest',400)
  names.add(part.file)
  if(kind==='object'){
   const p=part as LegacyObject
   if(!identifier(p.mediaId)||!number(p.size,LEGACY_LIMITS.objectBytes)||!identifier(p.key)||p.key!==exportedObjectKey(s.projectId,String(p.mediaId))||keys.has(p.key)||media.has(String(p.mediaId)))refuse('invalid_scope',422)
   keys.add(p.key);media.add(String(p.mediaId));bytes+=p.size
  }else{
   const p=part as LegacyPart
   if(!tables.has(p.table)||!number(p.count)||!number(p.bytes,LEGACY_LIMITS.partBytes)||p.bytes<2)refuse('invalid_manifest',400)
   if(kind==='chunk'){counts[p.table]=(counts[p.table]||0)+p.count;if(!Number.isSafeInteger(counts[p.table]))refuse('invalid_manifest',400)}
  }
 }
 for(const [table,count] of Object.entries(s.rowCounts))if(!tables.has(table)||!number(count)||(counts[table]??0)!==count)refuse('row_count_mismatch',422)
 if(Object.keys(counts).some(table=>!Object.hasOwn(s.rowCounts as object,table)))refuse('row_count_mismatch',422)
 const pairs=new Set<string>(),objects=new Set(m.objects.map(o=>JSON.stringify([String(o.mediaId),o.key])))
 for(const entry of s.attachments){if(!object(entry)||!identifier(entry.mediaId)||!identifier(entry.key))refuse('invalid_manifest',400);const pair=JSON.stringify([String(entry.mediaId),entry.key]);if(pairs.has(pair)||!objects.has(pair))refuse('invalid_scope',422);pairs.add(pair)}
 if(pairs.size!==m.objects.length||!Number.isSafeInteger(bytes)||m.mediaBytes!==undefined&&m.mediaBytes!==bytes)refuse('invalid_manifest',400)
 return m
}
export const packageKey=(sha:string,kind:LegacyFileKind|'manifest',file='manifest.json')=>`legacy-package/${sha}/${kind==='manifest'?file:`${kind==='chunk'?'chunks':kind==='object'?'objects':'context'}/${file}`}`
