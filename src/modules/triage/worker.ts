import type {Env,Job} from '../../platform/env'
import {auditStatement} from '../audit/record'
import {processWorkflowEvents} from '../workflows/events'
import {placeUnsureTicket} from '../workflows/routing-triage'
import {classify} from './provider'
import {currentJob,liveJob,settings,dimensions} from './model'
export async function dispatchTriage(env:Env,conversationId?:string){
 const rows=(await env.DB.prepare(`SELECT id,project_id FROM triage_jobs WHERE state='pending' ${conversationId?'AND conversation_id=?':''} ORDER BY created_at LIMIT 10`).bind(...(conversationId?[conversationId]:[])).all<any>()).results
 for(const row of rows)await env.JOBS.send({type:'triage',id:row.id,projectId:row.project_id})
}
export async function consumeTriage(job:Job,env:Env){
 if(job.type!=='triage')return false
 const row=await env.DB.prepare(liveJob).bind(job.id).first<any>()
 if(!row||row.project_id!==job.projectId||!['pending','running'].includes(row.state))return true
 if(row.state==='running'){await unavailable(env,row,'Interrupted model attempt; outcome unknown and never replayed');await placeUnsureTicket(env,row.project_id,row.conversation_id,row.id);return true}
 const claim=await env.DB.prepare(`UPDATE triage_jobs SET state='running',updated_at=? WHERE id=? AND state='pending' AND ${currentJob}`).bind(Date.now(),row.id).run()
 if(!claim.meta.changes){await unavailable(env,row,'A newer customer message or triage settings superseded this request');return true}
 try{
  const s=await settings(env,row.project_id),predictions=await classify(env,row,s.taxonomy),now=Date.now()
  const receipt=crypto.randomUUID(),ok='EXISTS(SELECT 1 FROM audit_events WHERE id=?)'
  const guarded=`EXISTS(SELECT 1 FROM triage_jobs WHERE id=? AND state='running' AND ${currentJob})`
  const result=await env.DB.batch([
   env.DB.prepare(`INSERT INTO audit_events(id,project_id,at,category,action,outcome,actor_type,source,target_type,target_id,detail_json) SELECT ?,?,?,'data','triage.classified','succeeded','system','system','conversation',?,'{}' WHERE ${guarded}`).bind(receipt,row.project_id,now,row.conversation_id,row.id),
   env.DB.prepare(`UPDATE conversations SET ticket_source='system',ticket_actor_type='system',ticket_actor_id='triage' WHERE id=? AND ${ok}`).bind(row.conversation_id,receipt),
   env.DB.prepare(`UPDATE triage_jobs SET state='complete',reason=NULL,predictions_json=?,updated_at=? WHERE id=? AND ${ok}`).bind(JSON.stringify(predictions),now,row.id,receipt),
   ...dimensions.flatMap(field=>[{id:`triage_${field}`,value:predictions[field].value},{id:`triage_${field}_confidence`,value:predictions[field].confidence},{id:`triage_${field}_quote`,value:predictions[field].quote}]).map(f=>env.DB.prepare(`INSERT INTO ticket_field_values(project_id,conversation_id,field_id,value_json) SELECT ?,?,?,? WHERE ${ok} AND EXISTS(SELECT 1 FROM ticket_fields WHERE project_id=? AND id=?) ON CONFLICT(project_id,conversation_id,field_id) DO UPDATE SET value_json=excluded.value_json`).bind(row.project_id,row.conversation_id,f.id,JSON.stringify(f.value),receipt,row.project_id,f.id)),
  ])
  if(!result[0].meta.changes)await unavailable(env,row,'A newer customer message, erasure or settings change superseded this result')
 }catch(error){const reason=error instanceof Error&&/^(CONFIGURATION_REQUIRED: [A-Z_]+$|No enabled workspace AI model|AI_REPLY_CEILING:|Model returned|Model evidence)/.test(error.message)?error.message:'The configured model was unavailable, refused the request or returned invalid evidence. Ticket kept in the default queue.';await unavailable(env,row,reason)}
 await placeUnsureTicket(env,row.project_id,row.conversation_id,row.id)
 await processWorkflowEvents(env,row.conversation_id,20)
 return true
}
async function unavailable(env:Env,row:any,reason:string){
 await env.DB.batch([env.DB.prepare("UPDATE triage_jobs SET state='unavailable',reason=?,predictions_json=NULL,updated_at=? WHERE id=? AND state IN ('pending','running')").bind(reason,Date.now(),row.id),auditStatement(env.DB,{projectId:row.project_id,category:'data',action:'triage.unavailable',outcome:'failed',actor:{type:'system'},source:'system',target:{type:'conversation',id:row.conversation_id},detail:{job_id:row.id}})])
}
