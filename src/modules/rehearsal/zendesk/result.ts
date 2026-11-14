import type {Env} from '../../../platform/env'
import {canonicalJson,sha256,type ProvenanceRow} from '../../import-kit/src/d1/index'
import {nativeTargets} from '../../move-in/targets'
import {pullBatches} from '../../move-in/zendesk-source/approval'
import {getPull,json,savePull,type PullRow} from '../../move-in/zendesk-source/pull-store'
import {getRun as getAttachmentRun} from '../../move-in/zendesk-attachments/store'
import {attachmentView} from '../../move-in/zendesk-attachments/view'
import {assertRehearsal} from '../authority'
import {verifyCopy} from '../copies'
import {grantRef,reject,type RehearsalGrant} from '../types'
import {attachmentId} from './attachments'
import {scopedWork} from './work'
interface Verification {after:string;checked:number;identical:number;nativeChanged:number;nativeMissing:number;complete:boolean;workUnchanged:boolean|null}
const empty=():Verification=>({after:'',checked:0,identical:0,nativeChanged:0,nativeMissing:0,complete:false,workUnchanged:null})
/** One bounded verification window. Native edits/deletions are reported, never repaired. */
export async function verifyResult(env:Env,g:RehearsalGrant,pull:PullRow){
 await assertRehearsal(env,grantRef(g),g.zendesk_project_id,'zendesk')
 if(pull.state!=='applied'||pull.error||!pull.resume_json)reject('zendesk_pull_not_applied')
 const day=await env.DB.prepare('SELECT day,zendesk_verified FROM rehearsal_copies WHERE grant_id=? AND generation=? AND zendesk_pull_id=?').bind(g.id,g.generation,pull.id).first<{day:string;zendesk_verified:number}>()
 if(!day)reject('copy_not_found',404)
 if(day.zendesk_verified)return result(env,g,pull)
 const attachment=await getAttachmentRun(env,attachmentId(pull))
 if(!attachment||attachment.state!=='done'||attachment.error)reject('zendesk_attachments_incomplete')
 const batches=await pullBatches(env,pull.id)
 if(batches.some(b=>b.error||!(b.state==='completed'||b.state==='ready'&&b.total===0)))reject('zendesk_children_incomplete')
 const counts=json<Record<string,any>>(pull.counts_json,{}),verification:Verification=counts.rehearsalVerification??empty()
 if(!verification.complete){
  const rows=(await env.DB.prepare("SELECT p.id,p.record_json FROM ik_provenance p JOIN move_in_batches b ON b.kit_job_id=p.job_id JOIN move_in_zendesk_pull_runs r ON r.run_id=b.run_id WHERE r.pull_id=? AND p.id>? AND p.reversed=0 ORDER BY p.id LIMIT 20").bind(pull.id,verification.after).all<{id:string;record_json:string}>()).results
  const provenance=rows.map(row=>JSON.parse(row.record_json) as ProvenanceRow)
  const native=await nativeTargets.readMany!(env.DB,g.zendesk_project_id,provenance.map(p=>({kind:p.targetKind,id:p.targetId})))
  for(let i=0;i<rows.length;i++){
   const p=provenance[i],row=native[i]
   if(p.destination!==g.zendesk_project_id||p.reversed)reject('zendesk_journal_changed')
   verification.checked++
   if(!row)verification.nativeMissing++
   else if(sha256(canonicalJson(row.value))===p.valueHash)verification.identical++
   else verification.nativeChanged++
   verification.after=rows[i].id
  }
  verification.complete=rows.length<20
  if(verification.complete){
   const before=counts.rehearsalWorkBefore,after=await scopedWork(env,g.zendesk_project_id)
   verification.workUnchanged=!!before&&Object.keys(after).every(key=>before[key]===after[key])
  }
  counts.rehearsalVerification=verification
  await savePull(env,pull,{counts_json:JSON.stringify(counts)})
 }
 if(verification.complete){
  if(!verification.workUnchanged)reject('zendesk_work_invariant_changed')
  await verifyCopy(env,g,day.day,'zendesk',pull.id,{cursor:pull.resume_json!})
 }
 return result(env,g,(await getPull(env,pull.id))!)
}
export async function result(env:Env,g:RehearsalGrant,pull:PullRow){
 const counts=json<Record<string,any>>(pull.counts_json,{}),verification:Verification=counts.rehearsalVerification??empty(),attachment=await getAttachmentRun(env,attachmentId(pull))
 const day=await env.DB.prepare('SELECT day,zendesk_verified FROM rehearsal_copies WHERE grant_id=? AND generation=? AND zendesk_pull_id=?').bind(g.id,g.generation,pull.id).first<{day:string;zendesk_verified:number}>()
 return {id:pull.id,day:day?.day,state:pull.state,error:pull.error,verified:day?.zendesk_verified===1,cursor:day?.zendesk_verified?json(pull.resume_json,{}):null,equality:{complete:verification.complete,checked:verification.checked,identical:verification.identical,protectedNativeChanges:verification.nativeChanged,protectedNativeDeletions:verification.nativeMissing,nativeEqualsJournal:verification.complete?verification.identical===verification.checked:null},attachments:attachment?await attachmentView(env,attachment):null,work:{unchanged:verification.workUnchanged}}
}
