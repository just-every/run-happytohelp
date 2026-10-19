import type {Actor,Env,Job,BaseJob} from '../../platform/env'
import type {TicketAuthority} from './model'
import {mutateTicket,TicketCommittedError} from './mutate'
import {applyMacro} from '../macros/apply'
import {auditStatement,type AuditEvent} from '../audit/record'
import {notificationRequestEnvironment,requestRoom,flushRequestAssignments} from '../integrations/notification-request'
import {ticketBatchEnvironment} from './request-batch'
import {finishBatchWorkflows} from './batch-workflows'

interface Selection {id:string;expected_version:number}
export interface TicketContinuation extends BaseJob {
 type:'ticket.batch';actor:Actor;authority:TicketAuthority;tickets:Selection[];
 changes?:Record<string,unknown>;macro?:{id:string;version:number;commandId:string};batchId:string
}
export function bulkReceipt(actor:Actor,source:AuditEvent['source'],batchId:string,id:string,changes:Record<string,unknown>):AuditEvent{
 return {projectId:actor.projectId,category:'data',action:'ticket.bulk.apply',actor:{type:'user',id:actor.id},source,target:{type:'conversation',id},detail:{batch_id:batchId,result:'applied',fields:Object.keys(changes)}}
}
/** Queue acceptance is the durable continuation boundary. The original live
 * authority and frontier are checked again; fixed receipts fence queue redelivery. */
export async function consumeTicketContinuation(job:Job,input:Env){
 if(job.type!=='ticket.batch')return false
 const work=job as TicketContinuation
 if(!work.actor||work.actor.projectId!==work.projectId||!work.authority?.sessionHash||!Array.isArray(work.tickets)||!work.tickets.length||work.tickets.length>100||!work.batchId||Boolean(work.changes)===Boolean(work.macro))throw new Error('Invalid ticket continuation')
 const env=await ticketBatchEnvironment(notificationRequestEnvironment(input),work.actor,work.tickets.map(t=>t.id)),applied:string[]=[]
 for(let index=0;index<work.tickets.length;index++){
  if(requestRoom(env)<96){await env.JOBS.send({...work,id:`${work.batchId}:${index}`,tickets:work.tickets.slice(index)});break}
  const selected=work.tickets[index],receipt=`bulk:${work.batchId}:${selected.id}`
  try{
   if(work.macro)await applyMacro(env,work.actor,work.macro.id,work.macro.version,selected,work.macro.commandId,work.authority)
   else if(!await env.DB.prepare('SELECT 1 FROM ticket_history WHERE id=? AND project_id=? AND conversation_id=?').bind(receipt,work.projectId,selected.id).first())await mutateTicket(env,work.actor,selected.id,{...work.changes,expected_ticket_version:selected.expected_version},work.authority,bulkReceipt(work.actor,work.authority.source??'dashboard',work.batchId,selected.id,work.changes!),receipt)
   applied.push(selected.id)
  }catch(error){
   if(error instanceof TicketCommittedError){applied.push(selected.id);continue}
   const status=(error as {status?:number}).status
   if(!status||![400,401,403,404,409,422].includes(status))throw error
   await auditStatement(env.DB,{projectId:work.projectId,category:'data',action:'ticket.batch.refused',outcome:'refused',actor:{type:'user',id:work.actor.id},source:work.authority.source??'dashboard',target:{type:'conversation',id:selected.id},detail:{batch_id:work.batchId,status}}).run()
  }
 }
 await finishBatchWorkflows(env,work.projectId,applied)
 await flushRequestAssignments(env)
 return true
}
export async function queueTicketContinuation(env:Env,work:Pick<TicketContinuation,'actor'|'authority'|'tickets'|'changes'|'macro'|'batchId'>,results:Record<string,unknown>[]){
 const pending=results.filter(r=>r.code==='request_capacity')
 if(!pending.length)return
 const ids=new Set(pending.map(r=>r.id))
 try{
  await env.JOBS.send({...work,type:'ticket.batch',id:work.batchId,projectId:work.actor.projectId,tickets:work.tickets.filter(t=>ids.has(t.id))})
  for(const result of pending){result.status='queued';result.code='request_continuation';result.reason='Queued to finish with the original permissions and ticket version. Reload to see the result.'}
 }catch{
  // A lost queue response is not proof of refusal. Do not replay it here.
  for(const result of pending){result.status='queued';result.code='continuation_unconfirmed';result.reason='Queue acceptance could not be confirmed. Reload this ticket before applying another change.'}
 }
}
