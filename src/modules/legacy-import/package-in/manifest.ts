import {LEGACY_LIMITS,type LegacyPackageManifest,type LegacyFileKind} from '../worker-contract'
// @ts-expect-error Exporter scope is shared JavaScript, with no alternate secret policy.
import {directTables,childScopes} from '../../../../scripts/legacy-export/scope.mjs'
import {refuse} from './errors'
export const digestPattern=/^[a-f0-9]{64}$/
const encoder=new TextEncoder()
export const boundedName=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&encoder.encode(value).length<=512&&!/[\x00-\x1f\x7f]/.test(value)
export const safeFile=(value:unknown):value is string=>boundedName(value)&&/^\w[\w.-]*$/.test(value)&&value!=='manifest.json'
const integer=(v:unknown,min=0,max=Number.MAX_SAFE_INTEGER):v is number=>Number.isSafeInteger(v)&&Number(v)>=min&&Number(v)<=max
const supported=new Set([...directTables,...Object.keys(childScopes),'users','ai_defaults','article_categories','mediables','media','local_agent_devices','local_agent_grants'])
export interface Descriptor{kind:LegacyFileKind;file:string;bytes:number;sha256:string;table?:string;count?:number}
export function descriptors(m:LegacyPackageManifest):Descriptor[]{return [...m.chunks.map(p=>({...p,kind:'chunk' as const})),...m.context.map(p=>({...p,kind:'context' as const})),...m.objects.map(p=>({...p,bytes:p.size,kind:'object' as const}))]}
export function validateManifest(value:unknown):LegacyPackageManifest{
 const bad=()=>refuse(400,'invalid_manifest','Invalid package manifest or descriptor')
 if(!value||typeof value!=='object'||Array.isArray(value))bad()
 const m=value as LegacyPackageManifest,s=m.source,format=(value as {format?:unknown}).format
 if(format!=='happytohelp-legacy-chunks-v1'){if(typeof format==='string'&&format.startsWith('happytohelp-legacy-chunks-'))refuse(422,'unsupported_package','Unsupported legacy package version');bad()}
 if(!s||!boundedName(s.repository)||!boundedName(s.revision)||!boundedName(s.exportedAt)||!Number.isFinite(Date.parse(s.exportedAt))||!boundedName(s.projectId)||!s.rowCounts||typeof s.rowCounts!=='object'||Array.isArray(s.rowCounts)||!Array.isArray(s.attachments)||!Array.isArray(m.chunks)||!Array.isArray(m.context)||!Array.isArray(m.objects)||m.attachmentsComplete!==true)bad()
 if(m.chunks.length+m.context.length+m.objects.length>LEGACY_LIMITS.descriptors)bad()
 const names=new Set<string>(),totals=new Map<string,number>(),keys=new Set<string>(),media=new Set<string>()
 for(const p of [...m.chunks,...m.context]){
  if(!p||!safeFile(p.file)||names.has(p.file)||!boundedName(p.table)||!supported.has(p.table)||!integer(p.count)||!integer(p.bytes,2,LEGACY_LIMITS.partBytes)||(typeof p.sha256!=='string'||!digestPattern.test(p.sha256)))bad()
  names.add(p.file)
 }
 for(const p of m.chunks){const total=(totals.get(p.table)||0)+p.count;if(!integer(total))bad();totals.set(p.table,total)}
 for(const [table,count]of Object.entries(s.rowCounts))if(!supported.has(table)||!integer(count)||(totals.get(table)||0)!==count)bad()
 for(const table of totals.keys())if(!Object.hasOwn(s.rowCounts,table))bad()
 let bytes=0
 for(const o of m.objects){
  if(!o||!safeFile(o.file)||names.has(o.file)||!integer(o.size,0,LEGACY_LIMITS.objectBytes)||(typeof o.sha256!=='string'||!digestPattern.test(o.sha256))||!boundedName(o.key)||!o.key.startsWith('legacy/')||/[\\\x00-\x1f\x7f]/.test(o.key)||o.key.split('/').some(p=>!p||p==='.'||p==='..')||!(boundedName(o.mediaId)||integer(o.mediaId))||keys.has(o.key)||media.has(String(o.mediaId)))bad()
  names.add(o.file);keys.add(o.key);media.add(String(o.mediaId));bytes+=o.size
 }
 if(m.mediaBytes!==undefined&&(!integer(m.mediaBytes)||m.mediaBytes!==bytes))bad()
 const attachments=new Set<string>(),pairs=new Set(m.objects.map(o=>JSON.stringify([o.key,String(o.mediaId)])))
 for(const a of s.attachments){if(!a||!pairs.has(JSON.stringify([a.key,String(a.mediaId)])))bad();attachments.add(JSON.stringify([a.key,String(a.mediaId)]))}
 if(s.attachments.length!==m.objects.length||attachments.size!==m.objects.length)bad()
 return m
}
export function exclusions(raw:string|undefined){if(raw===undefined||raw==='ai_usages')return ['ai_usages'];if(raw==='')return [];return refuse(400,'invalid_request','Only AI usage chunks may be omitted')}
export function inventory(m:LegacyPackageManifest,exclude:string[]){const excluded:Record<string,number>={};const files=descriptors(m).filter(p=>{if(p.kind==='chunk'&&exclude.includes(p.table!)){excluded[p.table!]=(excluded[p.table!]||0)+p.count!;return false}return true});return {files,excluded}}
export const storageKey=(sha:string,p:Descriptor)=>`legacy-package/${sha}/${p.kind==='chunk'?'chunks':p.kind==='context'?'context':'objects'}/${p.file}`
