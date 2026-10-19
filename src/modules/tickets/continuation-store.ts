import type {Actor,Env,BaseJob} from '../../platform/env'
import type {TicketAuthority} from './model'
import {auditStatement,type AuditEvent} from '../audit/record'

export interface Selection {id:string;expected_version:number}
export interface TicketContinuation {
 actor:Actor;authority:TicketAuthority;tickets:Selection[];
 changes?:Record<string,unknown>;macro?:{id:string;version:number;commandId:string};batchId:string
}
export interface BatchResult {id:string;status:string;attempts?:number;[key:string]:unknown}
export interface BatchRow {id:string;project_id:string;actor_json:string;authority_json:string;operation_json:string;selection_json:string;results_json:string;cursor:number;attempts:number;state:string}
export const maxBatchAttempts=128
export function readContinuation(row:BatchRow):TicketContinuation{
 return {batchId:row.id,actor:JSON.parse(row.actor_json),authority:JSON.parse(row.authority_json),tickets:JSON.parse(row.selection_json),...JSON.parse(row.operation_json)}
}
/** Selection ids make a wakeup observable; only the D1 row supplies work or authority. */
export const batchWake=(work:TicketContinuation):BaseJob=>({type:'ticket.batch',id:work.batchId,projectId:work.actor.projectId,tickets:work.tickets.map(({id})=>({id}))})
export function bulkReceipt(actor:Actor,source:AuditEvent['source'],batchId:string,id:string,changes:Record<string,unknown>):AuditEvent{
 return {projectId:actor.projectId,category:'data',action:'ticket.bulk.apply',actor:{type:'user',id:actor.id},source,target:{type:'conversation',id},detail:{batch_id:batchId,result:'applied',fields:Object.keys(changes)}}
}
export async function queueTicketContinuation(env:Env,work:TicketContinuation,results:Record<string,unknown>[]){
 const pending=results.filter(r=>r.code==='request_capacity')
 if(!pending.length)return
 const ids=new Set(pending.map(r=>r.id)),selection=work.tickets.filter(t=>ids.has(t.id))
 let persisted=false
 try{
  await env.DB.prepare(`INSERT INTO ticket_batch_jobs(id,project_id,actor_json,authority_json,operation_json,selection_json,results_json,created_at,updated_at)
   VALUES(?,?,?,?,?,?,?,?,?)`).bind(work.batchId,work.actor.projectId,JSON.stringify(work.actor),JSON.stringify(work.authority),JSON.stringify(work.macro?{macro:work.macro}:{changes:work.changes}),JSON.stringify(selection),JSON.stringify(results.map(r=>ids.has(r.id)?{id:r.id,status:'pending'}:{id:r.id,status:r.status})),Date.now(),Date.now()).run()
  persisted=true
 }catch{
  // Reconcile a lost insert response before acknowledging durable acceptance.
  try{persisted=Boolean(await env.DB.prepare('SELECT 1 FROM ticket_batch_jobs WHERE id=? AND project_id=?').bind(work.batchId,work.actor.projectId).first())}catch{}
 }
 if(!persisted){for(const result of pending){result.status='failed';result.code='continuation_unconfirmed';result.reason='Batch acceptance could not be confirmed. Reload this ticket before applying another change.'}return}
 for(const result of pending){result.status='queued';result.code='request_continuation';result.batch_id=work.batchId;result.reason='Queued to finish with the original permissions and ticket version. Reload to see the result.'}
 try{await env.JOBS.send(batchWake({...work,tickets:selection}))}catch{console.error('Ticket batch wakeup retained for recovery',work.batchId)}
}
export function batchEvent(work:TicketContinuation,id:string,status:string,retryable=false):AuditEvent{
 return {projectId:work.actor.projectId,category:'data',action:status==='refused'?'ticket.batch.refused':'ticket.batch.failed',outcome:status==='refused'?'refused':'failed',actor:{type:'user',id:work.actor.id},source:work.authority.source??'dashboard',target:{type:'conversation',id},detail:{batch_id:work.batchId,result:status,retryable}}
}
/** The terminal audit and state transition commit together, once. Receipts also
 * reconcile the last ticket if its process ended between mutation and cursor. */
export async function finishContinuation(env:Env,row:BatchRow,work:TicketContinuation,results:BatchResult[],exhausted=false){
 const receipts=work.macro?await env.DB.prepare('SELECT conversation_id id FROM macro_usage WHERE project_id=? AND actor_id=? AND command_id=? AND macro_id=? AND version=?').bind(row.project_id,work.actor.id,work.macro.commandId,work.macro.id,work.macro.version).all<{id:string}>():await env.DB.prepare("SELECT conversation_id id FROM ticket_history WHERE project_id=? AND id IN (SELECT 'bulk:' || ? || ':' || json_extract(value,'$.id') FROM json_each(?))").bind(row.project_id,row.id,JSON.stringify(work.tickets)).all<{id:string}>()
 const changed=new Set(receipts.results.map(r=>r.id))
 for(const result of results){if(changed.has(result.id))result.status='applied';else if(['pending','retry'].includes(result.status))result.status='failed'}
 const applied=results.filter(r=>['applied','duplicate'].includes(r.status)).map(r=>r.id),unchanged=results.filter(r=>!['applied','duplicate'].includes(r.status)).map(r=>r.id)
 const state=exhausted||unchanged.length?'failed':'complete'
 await env.DB.batch([
  auditStatement(env.DB,{projectId:row.project_id,category:'data',action:'ticket.batch',outcome:state==='complete'?'succeeded':'failed',actor:{type:'user',id:work.actor.id},source:work.authority.source??'dashboard',target:{type:'ticket_batch',id:row.id},detail:{batch_id:row.id,state,applied,unchanged,results}},Date.now(),{sql:"EXISTS(SELECT 1 FROM ticket_batch_jobs WHERE id=? AND state='pending' AND cursor=?)",params:[row.id,row.cursor]}),
  env.DB.prepare("UPDATE ticket_batch_jobs SET state=?,results_json=?,updated_at=? WHERE id=? AND state='pending' AND cursor=?").bind(state,JSON.stringify(results),Date.now(),row.id,row.cursor)
 ])
}
