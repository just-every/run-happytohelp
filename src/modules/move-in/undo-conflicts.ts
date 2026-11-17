import type {Env} from '../../platform/env'
import type {Run} from './types'
import type {ProvenanceRow,TargetRow} from '../import-kit/src/types'
import {canonicalJson,sha256} from '../import-kit/src/d1/index'
import {attachmentHash} from '../import-kit/src/provenance/identity'
import {nativeTargets} from './targets'
import {undoReferenceConflictSql} from './undo-references'
import {undoProgress} from './undo-progress'
import {updateRun} from './run-store'
import type {NativeValue} from './readers/normalise'

type Conflict={kind:string;name:string;reason:'changed'|'missing'|'referenced'}
type Scan={after:string;total:number;records:Conflict[]}
const labels:Record<string,string>={contact:'Contact',company:'Company',conversation:'Conversation',reply:'Reply',tag:'Tag',macro:'Saved reply',article:'Article',category:'Category',field:'Ticket field',form:'Request form',group:'Group',sla_policy:'SLA policy',calendar:'Business calendar',view:'Saved view',rule:'Workflow rule'}
const tables:Record<string,string>={contact:'contacts',company:'companies',conversation:'conversations',tag:'workspace_tags',macro:'macros',article:'knowledge_articles',category:'knowledge_categories',field:'ticket_fields',form:'request_forms',group:'ticket_groups',sla_policy:'sla_policies',calendar:'workflow_calendars',view:'ticket_views',rule:'workflow_rules'}

/** Diagnostics never authorize or perform reversal. After strict undo stops,
 * inspect twenty remaining targets per queue turn, retaining only twenty names
 * and a count. This uses the same complete images and reference predicate as
 * reversal; no full-workspace scan or unbounded target bodies are retained. */
export async function startUndoConflictReport(env:Env,run:Run){
 const report={state:'undoing',...await undoProgress(env,run),referencesChecked:false,undoConflictScan:{after:'',total:0,records:[]} satisfies Scan}
 await updateRun(env,run,{report_json:JSON.stringify(report),error:null})
}
function recordName(p:ProvenanceRow,target:TargetRow|undefined,sourceName:string|null){
 const value=target?.value as unknown as NativeValue|undefined,row=value?.tables[tables[p.targetKind]]?.[0]
 const config=row?.config_json?JSON.parse(row.config_json):null
 const reply=p.targetKind==='reply'?(value?.tables.messages?.[0]?.content||value?.tables.move_in_notes?.[0]?.content):null
 const providedName=p.targetKind==='contact'&&row?.metadata_json?JSON.parse(row.metadata_json).provided_name:null
 const name=providedName||row?.name||row?.title||row?.subject||config?.name||config?.title||reply||sourceName
 return String(name||`Source ${p.sourceKind} ${p.sourceId}`).slice(0,500)
}
export async function advanceUndoConflictReport(env:Env,run:Run):Promise<boolean>{
 const report=JSON.parse(run.report_json||'{}'),scan=report.undoConflictScan as Scan|undefined
 if(!scan)return false
 const {results}=await env.DB.prepare(`SELECT p.id,p.record_json,(${undoReferenceConflictSql()}) referenced
 FROM ik_provenance p WHERE p.job_id IN (SELECT kit_job_id FROM move_in_batches WHERE run_id=?1) AND p.destination=?2 AND p.reversed=0 AND p.id>?3 ORDER BY p.id LIMIT 20`).bind(run.id,run.project_id,scan.after).all<{id:string;record_json:string;referenced:number}>()
 const provenance=results.map(raw=>JSON.parse(raw.record_json) as ProvenanceRow)
 const targets=await nativeTargets.readMany!(env.DB,run.project_id,provenance.map(p=>({kind:p.targetKind,id:p.targetId})))
 for(let i=0;i<results.length;i++){
  const p=provenance[i],target=targets[i]
  const changed=!target||target.revision!==p.appliedRevision||sha256(canonicalJson(target.value))!==p.valueHash||attachmentHash(target.attachment)!==p.attachmentHash
  if(!changed&&!results[i].referenced)continue
  scan.total++
  if(scan.records.length<20){
   // Missing rows have no current display name. Read only their source label,
   // and only while there is room to show it; never scan source bodies for the count.
   const source=!target?await env.DB.prepare("SELECT COALESCE(json_extract(record_json,'$.payload.name'),json_extract(record_json,'$.payload.title'),json_extract(record_json,'$.payload.subject')) name FROM move_in_records WHERE run_id=? AND json_extract(record_json,'$.kind')=? AND json_extract(record_json,'$.sourceId')=? LIMIT 1").bind(run.id,p.sourceKind,p.sourceId).first<{name:string|null}>():null
   scan.records.push({kind:labels[p.targetKind]||'Imported record',name:recordName(p,target,source?.name??null),reason:!target?'missing':changed?'changed':'referenced'})
  }
 }
 const more=results.length===20
 if(more)scan.after=results.at(-1)!.id
 else{delete report.undoConflictScan;report.undoConflicts={total:scan.total,records:scan.records}}
 await updateRun(env,run,{report_json:JSON.stringify({...report,...await undoProgress(env,run)}),error:more?null:'NATIVE_EDIT_CONFLICT'})
 return true
}
