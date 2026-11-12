import type {Env} from '../../../platform/env'
import type {LegacyPackageManifest} from '../worker-contract'
import type {DeltaLease} from '../lease'
import {checksum} from './reader'
import {objectScope} from './object-step'
import {orderedChunks} from './package-step'
import {checkpoint,cursor,json,limits,type Run,type Part} from './state'
import {countWork,emptyAttachments} from './result'
import {refuse} from './errors'
const scratch=['legacy_import_context','legacy_import_context_messages','legacy_import_context_media','legacy_import_context_identities'] as const
/** One original journal or one object per verification quantum. */
export async function verifyResult(env:Env,run:Run,manifest:LegacyPackageManifest,lease:DeltaLease){
 const c=cursor(run),ordinal=Number(c.ordinal??0)
 if(c.stage!=='objects'){
  const part=orderedChunks(manifest,run)[ordinal]
  if(!part){await checkpoint(env,run,{cursor_json:JSON.stringify({stage:'objects',ordinal:0}),objects_json:JSON.stringify({...emptyAttachments(),package:manifest.objects.length,required:manifest.objects.length})});return {rows:0,bytes:0}}
  const descriptor=await env.DB.prepare('SELECT * FROM legacy_import_worker_parts WHERE run_id=? AND file=?').bind(run.id,part.file).first<Part>()
  const counts=await env.DB.prepare("SELECT count(*) total,sum(status='mapped' OR status='updated' OR status='unchanged') mapped,sum(status='archived_only') archived,sum(status='erased') erased FROM legacy_import_rows WHERE run_id=? AND source_table=?").bind(descriptor!.journal_run_id,part.table).first<{total:number;mapped:number;archived:number;erased:number}>()
  const holds=await env.DB.prepare('SELECT count(*) n FROM legacy_import_holds WHERE run_id=?').bind(descriptor!.journal_run_id).first<{n:number}>()
  if(counts?.total!==part.count)refuse('result_mismatch')
  const attempt=await env.DB.prepare("SELECT sum(json_extract(row_json,'$.applied')=1) applied,sum(json_extract(row_json,'$.applied')=0) replayed FROM legacy_import_context WHERE run_id=? AND kind='delta_plan' AND source_table=?").bind(run.id,'attempt:'+part.file).first<{applied:number;replayed:number}>()
  const recorded=await env.DB.prepare('SELECT checked_rows FROM legacy_import_worker_parts WHERE run_id=? AND file=?').bind(run.id,part.file).first<{checked_rows:number}>()
  const statements:D1PreparedStatement[]=[]
  if(!recorded?.checked_rows){statements.push(env.DB.prepare(`UPDATE legacy_import_worker_counts SET journal_rows=journal_rows+?,mapped_rows=mapped_rows+?,archived_rows=archived_rows+?,erased_rows=erased_rows+?,holds=holds+?,applied_rows=applied_rows+?,replayed_rows=replayed_rows+? WHERE run_id=? AND source_table=?`).bind(counts.total,counts.mapped??0,counts.archived??0,counts.erased??0,holds?.n??0,attempt?.applied??0,attempt?.replayed??0,run.id,part.table),env.DB.prepare('UPDATE legacy_import_worker_parts SET checked_rows=? WHERE run_id=? AND file=?').bind(part.count||1,run.id,part.file))}
  await checkpoint(env,run,{cursor_json:JSON.stringify({stage:'tables',ordinal:ordinal+1})},statements);return {rows:counts.total,bytes:0}
 }
 const object=manifest.objects[ordinal],attachments=json<any>(run.objects_json,emptyAttachments())
 if(object){
  const scope=await objectScope(env,run,manifest,object)
  const journal=await env.DB.prepare('SELECT sha256,size FROM legacy_import_objects WHERE run_id=? AND object_key=?').bind(run.id,object.key).first<{sha256:string;size:number}>()
  if(journal)attachments.journal++
  if(scope.withheld){attachments.withheld++;attachments.required--}
  else {const held=await env.FILES.head(object.key);if(!held)attachments.missing++;else if(!checksum(held))attachments.unverified++;else if(held.size!==object.size||checksum(held)!==object.sha256||journal?.sha256!==object.sha256||journal?.size!==object.size)attachments.different++;else {attachments.identical++;attachments.bytes+=object.size}}
  await checkpoint(env,run,{cursor_json:JSON.stringify({stage:'objects',ordinal:ordinal+1}),objects_json:JSON.stringify(attachments)});return {rows:0,bytes:0}
 }
 attachments.complete=attachments.identical===attachments.required&&attachments.missing===0&&attachments.different===0&&attachments.unverified===0
 if(!attachments.complete)refuse(attachments.unverified?'checksum_unavailable':'result_mismatch')
 const unequal=await env.DB.prepare('SELECT 1 FROM legacy_import_worker_counts WHERE run_id=? AND journal_rows<>package_rows-excluded_rows LIMIT 1').bind(run.id).first();if(unequal)refuse('result_mismatch')
 const after=await countWork(env),metrics=json<any>(run.metrics_json,{}),diagnostics=await collectDiagnostics(env,run,after)
 await checkpoint(env,run,{phase:'cleanup',cursor_json:'{}',verified_at:Date.now(),work_after_json:JSON.stringify(after),objects_json:JSON.stringify(attachments),metrics_json:JSON.stringify({...metrics,diagnostics})},[lease.assertion(env.DB),env.DB.prepare("UPDATE legacy_import_runs SET state='complete',completed_at=? WHERE id=?").bind(Date.now(),run.id),lease.cleared(env.DB)])
 return {rows:0,bytes:0}
}
async function collectDiagnostics(env:Env,run:Run,after:Record<string,number>){
 const counts=await env.DB.prepare(`SELECT (SELECT count(*) FROM conversations WHERE project_id=?1) conversations,(SELECT count(DISTINCT source_id) FROM legacy_import_rows rows JOIN legacy_import_runs runs ON runs.id=rows.run_id WHERE json_extract(runs.source_json,'$.projectId')=?1 AND json_extract(runs.source_json,'$.delta')=1) deltaSourceIds,(SELECT count(*) FROM legacy_import_runs WHERE json_extract(source_json,'$.projectId')=?1 AND json_extract(source_json,'$.delta')=1 AND state<>'complete') incompleteDeltaRuns`).bind(run.project_id).first<{conversations:number;deltaSourceIds:number;incompleteDeltaRuns:number}>()
 const samples=await env.DB.prepare('SELECT id FROM conversations WHERE project_id=? ORDER BY id LIMIT 5').bind(run.project_id).all<{id:string}>()
 return {scope:'workspace-and-installation',conversationCount:counts?.conversations??0,distinctDeltaSourceIds:counts?.deltaSourceIds??0,incompleteDeltaRuns:counts?.incompleteDeltaRuns??0,sampleConversationIds:samples.results.map(row=>row.id),installationWork:{before:json(run.work_before_json,{}),after,qualification:'whole-installation; concurrent native work is not attributed to this import'},baseline:{kind:'before-import',at:json<any>(run.metrics_json,{}).beforeAt??null,counts:json(run.work_before_json,{}),installation:null}}
}
export async function cleanup(env:Env,run:Run){
 const c=cursor(run),ordinal=Number(c.ordinal??0),table=scratch[ordinal]
 if(!table){await checkpoint(env,run,{phase:'done',state:'complete',completed_at:Date.now(),cursor_json:'{}'});return {rows:0,bytes:0}}
 // rowid is local to a scratch table; delete only this run's bounded page.
 const deleted=await env.DB.prepare(`SELECT rowid FROM ${table} WHERE run_id=? LIMIT ?`).bind(run.id,limits.rows).all<{rowid:number}>()
 await checkpoint(env,run,{cursor_json:JSON.stringify({ordinal:deleted.results.length?ordinal:ordinal+1})},deleted.results.length?[env.DB.prepare(`DELETE FROM ${table} WHERE run_id=? AND rowid IN (SELECT value FROM json_each(?))`).bind(run.id,JSON.stringify(deleted.results.map(row=>row.rowid)))]:[])
 return {rows:deleted.results.length,bytes:0}
}
