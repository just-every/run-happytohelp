import {countScopedWork} from '../../rehearsal/legacy/work'
import {releaseCanonical,type CanonicalTarget} from './canonical-custody'
import type {Env} from '../../../platform/env'
import type {LegacyPackageManifest} from '../worker-contract'
import type {DeltaLease} from '../lease'
import {insertJson} from '../d1'
import {importLegacy,type PreparedSlice} from '../importer'
import {importDelta} from '../delta'
import {planLegacyKnowledgeTargets} from '../../knowledge/write-boundary'
import {readRows,chunkBundle} from './reader'
import {orderedChunks} from './package-step'
import {sliceRows} from './context-load'
import {hydrate} from './context-read'
import {readDelta,scopedErased} from './delta-context'
import {objectScope,inspectObject} from './object-step'
import {checkpoint,cursor,limits,json,type Run,type Part} from './state'
import {countWork} from './result'
import {adoptionForRun,preflightSlice} from './v2'
import {refuse} from './errors'
/** Same full/delta engine, prepared under the immutable ORIGINAL part identity. */
export async function rowStep(env:Env,run:Run,manifest:LegacyPackageManifest,lease:DeltaLease,checkOnly:boolean){
 const c=cursor(run),ordinal=Number(c.ordinal??0),part=orderedChunks(manifest,run)[ordinal]
 if(!part){
  if(checkOnly)await checkpoint(env,run,{cursor_json:JSON.stringify({stage:'objects',ordinal:0,row:0})})
  else await checkpoint(env,run,{phase:'knowledge',cursor_json:JSON.stringify({})})
  return {rows:0,bytes:0}
 }
 const original=await readRows(env.FILES,run.manifest_sha256,run.project_id,'chunk',part,run.contract_version as 1|2,run.source_project_id),offset=Number(c.row??0),selected=sliceRows(original,offset),hydrated=await hydrate(env,run,manifest,part.table,selected.rows)
 const descriptor=await env.DB.prepare('SELECT * FROM legacy_import_worker_parts WHERE run_id=? AND file=?').bind(run.id,part.file).first<Part>()
 if(!descriptor?.journal_run_id||!descriptor.journal_digest)refuse('unsupported_contract_version')
 let confirmedTargets:CanonicalTarget[]=[]
 const bundle=chunkBundle(manifest,run.manifest_sha256,part,selected.rows),prepared:PreparedSlice={identity:{id:descriptor.journal_run_id,bundleDigest:descriptor.journal_digest,source:bundle.source},finalize:false,journalStatements:(db,sources,applied)=>sources.length?[...releaseCanonical(db,run,part.table,sources.map(s=>s.sourceId),confirmedTargets),insertJson(db,'INSERT OR IGNORE INTO legacy_import_context(run_id,kind,source_table,source_id,parent_id,row_json,row_digest)',7,sources.map(source=>[run.id,'delta_plan','attempt:'+part.file,source.sourceId,source.table,JSON.stringify({applied}), '']))]:[],normalize:targets=>{confirmedTargets=targets.filter(t=>['media','legacy_import_files'].includes(t.table)).map(t=>({key:String(t.row.object_key),kind:t.table,id:String(t.row.id??t.row.media_id)}));return planLegacyKnowledgeTargets(env,run.source_project_id,targets)}}
 const adoption=run.contract_version===2?await adoptionForRun(env,run,lease):undefined
 if(checkOnly&&adoption)await preflightSlice(env,run,bundle,hydrated,prepared,adoption,new Set(manifest.objects.map(o=>o.key)))
 const common={adoption,context:hydrated.context,media:hydrated.media,objectKeys:new Set(manifest.objects.map(object=>object.key)),lease,prepared,checkOnly}
 const applied=run.mode==='delta'?await importDelta(env,bundle,{...common,projectId:run.source_project_id,plan:await readDelta(env,run,part.table,selected.rows,hydrated.context)}):await importLegacy(env,bundle,{...common,erased:await scopedErased(env,run,part.table,selected.rows,hydrated.context)})
 // Commit-before-cursor is safe: the engine journals and state share its guarded
 // transaction. Redelivery of this slice skips those exact original source IDs.
 const next=offset+selected.rows.length,done=next===original.length,statements:D1PreparedStatement[]=[lease.assertion(env.DB),env.DB.prepare(`UPDATE legacy_import_worker_parts SET ${checkOnly?'preflight_rows':'applied_rows'}=? WHERE run_id=? AND file=?`).bind(next,run.id,part.file)]
 if(!checkOnly){
  // Recompute attempt accounting from durable journals below; checkpoint loss
  // cannot turn a source row applied in this attempt into a replay count.
  if(done)statements.push(env.DB.prepare("UPDATE legacy_import_runs SET state='complete',completed_at=? WHERE id=?").bind(Date.now(),descriptor.journal_run_id))
 }
 statements.push(lease.cleared(env.DB))
 await checkpoint(env,run,{cursor_json:JSON.stringify({stage:checkOnly?'rows':undefined,ordinal:done?ordinal+1:ordinal,file:done?null:part.file,row:done?0:next})},statements)
 return {rows:selected.rows.length,bytes:selected.bytes,applied:applied.applied,replayed:applied.replayed}
}
export async function preflightObjects(env:Env,run:Run,manifest:LegacyPackageManifest,lease:DeltaLease){
 const c=cursor(run),ordinal=Number(c.ordinal??0),object=manifest.objects[ordinal]
 if(object){const scope=await objectScope(env,run,manifest,object);if(!scope.withheld)await inspectObject(env,run,object);await checkpoint(env,run,{cursor_json:JSON.stringify({stage:'objects',ordinal:ordinal+1})});return {rows:0,bytes:0}}
 const before=run.authority_mode==='rehearsal'?await countScopedWork(env,run.source_project_id):await countWork(env)
 // Snapshot each original journal's existing row identities for this attempt,
 // without copying source JSON. A resumed tick can distinguish replay/applied.
 await checkpoint(env,run,{phase:'objects',cursor_json:'{}',work_before_json:JSON.stringify(before),metrics_json:JSON.stringify({...json<any>(run.metrics_json,{}),beforeAt:Date.now()})},[
  lease.assertion(env.DB),env.DB.prepare("INSERT OR IGNORE INTO legacy_import_runs(id,source_json,bundle_digest,state,created_at,completed_at) VALUES(?,?,?,'running',?,NULL)").bind(run.id,JSON.stringify(run.contract_version===2?{projectId:run.source_project_id,package:run.manifest_sha256,contractVersion:2,...(run.mode==='delta'?{delta:true}:{})}:manifest.source),run.manifest_sha256,Date.now()),lease.cleared(env.DB),
 ])
 return {rows:0,bytes:0}
}
