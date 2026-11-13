import type {Env} from '../../../platform/env'
import {view,json,type Run} from './state'
export {workTables} from '../../identity/installation-baseline'
import {workCountSelect} from '../../identity/installation-baseline'
export async function countWork(env:Env){return (await env.DB.prepare(workCountSelect).first<Record<string,number>>())!}

export const emptyAttachments=()=>({package:0,required:0,journal:0,identical:0,withheld:0,missing:0,different:0,unverified:0,bytes:0,complete:false,method:'r2-sha256-vs-manifest' as const})
/** GET reads persisted counts/diagnostics only. No source scan or file reads. */
export async function result(env:Env,run:Run){
 const rows=await env.DB.prepare('SELECT * FROM legacy_import_worker_counts WHERE run_id=? ORDER BY source_table').bind(run.id).all<any>()
 const tables=Object.fromEntries(rows.results.map(row=>[row.source_table,{packageRows:row.package_rows,excludedRows:row.excluded_rows,requiredRows:row.package_rows-row.excluded_rows,journalRows:row.journal_rows,mapped:row.mapped_rows,archivedOnly:row.archived_rows,erased:row.erased_rows,journalEqualsPackage:run.verified_at?row.journal_rows===row.package_rows-row.excluded_rows:run.error_code==='result_mismatch'?false:null,holds:row.holds}]))
 const held=await env.DB.prepare('SELECT expires_at FROM legacy_delta_leases WHERE project_id=?').bind(run.source_project_id).first<{expires_at:number}>()
 let savedAttachments:any=null
 if(run.contract_version===2&&run.verified_at&&run.objects_json==='{}'){const saved=await env.DB.prepare('SELECT detail_json FROM audit_events WHERE id=? AND project_id=?').bind(`legacy-import-summary:${run.manifest_sha256}:${run.attempt}`,run.source_project_id).first<{detail_json:string}>();savedAttachments=saved?JSON.parse(saved.detail_json).attachments:null}
 const m=json<any>(run.metrics_json,{}),before=json<Record<string,number>>(run.work_before_json,{}),after=json<Record<string,number>|null>(run.work_after_json,null),delta=after?Object.fromEntries(Object.keys(before).map(key=>[key,after[key]-before[key]])):null,attachment=savedAttachments??json<any>(run.objects_json,emptyAttachments())
 return {run:view(run),verifiedAt:run.verified_at,verification:run.verified_at?'verified':run.error_code==='result_mismatch'?'failed':run.phase==='verify_result'||run.phase==='cleanup'?'partial':'pending',tables,excluded:Object.fromEntries(rows.results.filter(row=>row.excluded_rows).map(row=>[row.source_table,row.excluded_rows])),journalEqualsPackage:run.verified_at?Object.values(tables).every((row:any)=>row.journalEqualsPackage):run.error_code==='result_mismatch'?false:null,attachments:{...emptyAttachments(),...attachment},work:{before,after,delta,unchanged:delta?Object.values(delta).every(n=>n===0):null},lease:{runHeld:!!run.lease_token&&(run.lease_until??0)>Date.now(),runLeaseUntil:run.lease_until,workspaceHeld:(held?.expires_at??0)>Date.now(),workspaceLeaseUntil:held?.expires_at??null,waitingFor:m.lease?.waitingFor??'none'},attempt:{number:run.attempt,appliedRows:rows.results.reduce((n,row)=>n+row.applied_rows,0),replayedRows:rows.results.reduce((n,row)=>n+row.replayed_rows,0),measuredRows:m.rows??0,measuredBytes:m.bytes??0,maxCpuMs:null,maxHeapBytes:null},...(m.diagnostics?{diagnostics:m.diagnostics}:{})}
}
