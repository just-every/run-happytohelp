import type {Env} from '../../../platform/env'
import type {LegacyPackageManifest,LegacyPart,LegacyObject} from '../worker-contract'
import {jsonBytes,insertJson} from '../d1'
import {tableOrder} from '../mapping'
import {readRows,checkPart,originalIdentity} from './reader'
import {cursor,checkpoint,packageParts,limits,type Run,type Part} from './state'
import {refuse} from './errors'
export const orderedChunks=(manifest:LegacyPackageManifest,run:Run)=>manifest.chunks.filter(part=>!JSON.parse(run.exclude_json).includes(part.table)).sort((a,b)=>{const order=(table:string)=>{const i=tableOrder.indexOf(table);return i<0?1000:i};return order(a.table)-order(b.table)})
/** Descriptor registration and part verification are separate resumable steps. */
export async function verifyPackage(env:Env,run:Run,manifest:LegacyPackageManifest){
 const c=cursor(run),parts=packageParts(manifest,JSON.parse(run.exclude_json)),ordinal=Number(c.ordinal??0)
 if(c.stage!=='verify'){
  const page=parts.slice(ordinal,ordinal+limits.rows),rows=page.map(part=>[run.id,part.file,part.kind,part.ordinal,part.kind==='object'?null:(part as LegacyPart).table,part.kind==='object'?0:(part as LegacyPart).count,part.kind==='object'?(part as LegacyObject).size:(part as LegacyPart).bytes,part.sha256,part.kind==='object'?String((part as LegacyObject).mediaId):null,part.kind==='object'?(part as LegacyObject).key:null])
  const done=ordinal+page.length>=parts.length,statements=rows.length?[insertJson(env.DB,'INSERT OR IGNORE INTO legacy_import_worker_parts(run_id,file,kind,ordinal,source_table,expected_rows,expected_bytes,sha256,media_id,target_key)',10,rows)]:[]
  if(ordinal===0){for(const [table,count] of Object.entries(manifest.source.rowCounts))statements.push(env.DB.prepare('INSERT OR IGNORE INTO legacy_import_worker_counts(run_id,source_table,package_rows,excluded_rows) VALUES(?,?,?,?)').bind(run.id,table,count,JSON.parse(run.exclude_json).includes(table)?count:0))}
  if(statements.length>150)refuse('row_too_large')
  await checkpoint(env,run,{cursor_json:JSON.stringify({stage:done?'verify':'register',ordinal:done?0:ordinal+page.length})},statements);return {rows:page.length,bytes:jsonBytes(page)}
 }
 const part=parts[ordinal]
 if(!part){await checkpoint(env,run,{phase:'context',cursor_json:JSON.stringify({stage:'load',ordinal:0,row:0})});return {rows:0,bytes:0}}
 let identity:{id:string;bundleDigest:string}|undefined
 if(part.kind==='object')await checkPart(env.FILES,run.manifest_sha256,run.project_id,'object',part as LegacyObject)
 else {const rows=await readRows(env.FILES,run.manifest_sha256,run.project_id,part.kind,part as LegacyPart);if(part.kind==='chunk')identity=await originalIdentity(manifest,run.manifest_sha256,part as LegacyPart,rows)}
 await checkpoint(env,run,{cursor_json:JSON.stringify({stage:'verify',ordinal:ordinal+1})},[env.DB.prepare('UPDATE legacy_import_worker_parts SET verified=1,journal_run_id=?,journal_digest=? WHERE run_id=? AND file=?').bind(identity?.id??null,identity?.bundleDigest??null,run.id,part.file)])
 return {rows:part.kind==='object'?0:(part as LegacyPart).count,bytes:part.kind==='object'?0:(part as LegacyPart).bytes}
}
