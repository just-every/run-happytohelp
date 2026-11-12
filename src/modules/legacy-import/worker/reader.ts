import {LEGACY_LIMITS,type LegacyPart,type LegacyObject,type LegacyFileKind,type LegacyPackageManifest} from '../worker-contract'
import {digest,stable,type LegacyBundle,type Row} from '../types'
import {refuse} from './errors'
import {hex256,packageKey,validateManifest} from './manifest'
// @ts-expect-error The same exporter classifier is JavaScript and runs under nodejs_compat.
import {classifySnapshot} from '../../../../scripts/legacy-export/secrets.mjs'
export function checksum(object:R2Object){const bytes=object.checksums.sha256;return bytes?Array.from(new Uint8Array(bytes)).map(x=>x.toString(16).padStart(2,'0')).join(''):null}
function custody(object:R2Object,sha:string,projectId:string,kind:LegacyFileKind|'manifest',file:string,version:1|2){
 const m=object.customMetadata
 if(!m||(version===2?m.custodyProjectId:m.projectId)!==projectId)refuse('package_not_found',404)
 if(version===2?m.custodyBody!=='accepted'||!m.custodyGeneration:m.contractVersion!=='1')refuse('unsupported_contract_version')
 if(m.manifestSha256!==sha||version===1&&kind!=='manifest'&&(m.kind!==kind||m.file!==file))refuse('custody_conflict')
}
/** Counts actual streamed bytes even if metadata claims a smaller object. JSON only. */
async function boundedBody(object:R2ObjectBody,limit:number){
 const reader=object.body.getReader(),chunks:Uint8Array[]=[];let size=0
 try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>limit){await reader.cancel();refuse('part_too_large',413)}chunks.push(part.value)}}finally{reader.releaseLock()}
 const bytes=new Uint8Array(size);let at=0;for(const part of chunks){bytes.set(part,at);at+=part.length}return bytes
}
function parse(bytes:Uint8Array):unknown{try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}catch{refuse('invalid_manifest',400)}}
export async function readManifest(files:R2Bucket,sha:string,projectId:string,version:1|2=1){
 if(!hex256(sha))refuse('invalid_request',400)
 const object=await files.get(packageKey(sha,'manifest'));if(!object)refuse('package_not_found',404)
 custody(object,sha,projectId,'manifest','manifest.json',version)
 if(object.size>LEGACY_LIMITS.manifestBytes)refuse('manifest_too_large',413)
 const bytes=await boundedBody(object,LEGACY_LIMITS.manifestBytes)
 if(object.size!==bytes.length||await digest(bytes)!==sha||checksum(object)!==sha)refuse('digest_mismatch',422)
 return validateManifest(parse(bytes))
}
export async function checkPart(files:R2Bucket,sha:string,projectId:string,kind:LegacyFileKind,part:LegacyPart|LegacyObject,version:1|2=1){
 const object=await files.head(packageKey(sha,kind,part.file));if(!object)refuse('package_incomplete')
 custody(object,sha,projectId,kind,part.file,version)
 if(object.size!==(kind==='object'?(part as LegacyObject).size:(part as LegacyPart).bytes))refuse('size_mismatch',422)
 if(!checksum(object))refuse('checksum_unavailable')
 if(checksum(object)!==part.sha256)refuse('digest_mismatch',422)
 return object
}
export async function readRows(files:R2Bucket,sha:string,projectId:string,kind:'chunk'|'context',part:LegacyPart,version:1|2=1,sourceProjectId=projectId):Promise<Row[]>{
 await checkPart(files,sha,projectId,kind,part,version)
 const object=await files.get(packageKey(sha,kind,part.file));if(!object)refuse('package_incomplete')
 custody(object,sha,projectId,kind,part.file,version)
 const bytes=await boundedBody(object,LEGACY_LIMITS.partBytes)
 if(bytes.length!==part.bytes||object.size!==bytes.length)refuse('size_mismatch',422)
 if(checksum(object)!==part.sha256||await digest(bytes)!==part.sha256)refuse('digest_mismatch',422)
 const rows=parse(bytes)
 if(!Array.isArray(rows)||rows.length!==part.count||rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)))refuse('row_count_mismatch',422)
 try{classifySnapshot({tables:{[part.table]:rows}})}catch{refuse('source_policy_refused',422)}
 for(const row of rows){if(row.project_id!=null&&String(row.project_id)!==sourceProjectId||part.table==='projects'&&String(row.id)!==sourceProjectId)refuse('invalid_scope',422)}
 return rows
}
/** Exactly the CLI's original chunkBundle, before slicing. No normalized-manifest digest. */
export function chunkBundle(manifest:LegacyPackageManifest,sha:string,part:LegacyPart,rows:Row[]):LegacyBundle{return {
 format:'happytohelp-legacy-v1',source:{repository:manifest.source.repository,revision:manifest.source.revision,exportedAt:manifest.source.exportedAt,projectId:manifest.source.projectId,package:sha,chunk:part.file,table:part.table,chunkSha256:part.sha256,...(manifest.source.since!==undefined||manifest.source.delta!==undefined?{delta:true}:{})},tables:{[part.table]:rows},
}}
export async function originalIdentity(manifest:LegacyPackageManifest,sha:string,part:LegacyPart,rows:Row[]){const bundle=chunkBundle(manifest,sha,part,rows),bundleDigest=await digest(stable(bundle));return {id:`legacy:${bundleDigest}`,bundleDigest,source:bundle.source}}
