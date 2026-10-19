import type {Env,Job} from '../../platform/env'
import {mutateTicket,TicketCommittedError} from './mutate'
import {applyMacro} from '../macros/apply'
import {auditStatement} from '../audit/record'
import {notificationRequestEnvironment,requestRoom,flushRequestAssignments} from '../integrations/notification-request'
import {ticketBatchEnvironment} from './request-batch'
import {finishBatchWorkflows} from './batch-workflows'
import {cronRoom,inCron} from '../../platform/cron-budget'
import {batchWake,bulkReceipt,batchEvent,readContinuation,finishContinuation,maxBatchAttempts,type BatchRow,type BatchResult,type Selection} from './continuation-store'
export {bulkReceipt,queueTicketContinuation} from './continuation-store'

/** No process owns the frontier: compare-and-set cursor writes and the native
 * mutation receipts fence concurrent queue/cron delivery, including process death.
 * Each invocation is bounded; unsuccessful attempts survive in the job row. */
export async function consumeTicketContinuation(job:Job,input:Env){
 if(job.type!=='ticket.batch')return false
 const row=await input.DB.prepare("UPDATE ticket_batch_jobs SET attempts=attempts+1,updated_at=? WHERE id=? AND project_id=? AND state='pending' RETURNING *").bind(Date.now(),job.id,job.projectId).first<BatchRow>()
 if(!row)return true
 const work=readContinuation(row),results:BatchResult[]=JSON.parse(row.results_json)
 if(row.attempts>maxBatchAttempts){await finishContinuation(input,row,work,results,true);return true}
 const env=await ticketBatchEnvironment(notificationRequestEnvironment(input),work.actor,work.tickets.map(t=>t.id)),applied:string[]=[]
 let retry=false
 for(;row.cursor<work.tickets.length;){
  if(requestRoom(env)<112||!cronRoom(env,112))break
  const selected=work.tickets[row.cursor],prior=results.find(r=>r.id===selected.id)!,receipt=`bulk:${work.batchId}:${selected.id}`
  let status=prior.status,attempts=prior.attempts??0,event
  if(['pending','retry'].includes(status)){
   try{
    const committed=work.macro?await env.DB.prepare('SELECT 1 FROM macro_usage WHERE project_id=? AND actor_id=? AND command_id=? AND conversation_id=? AND macro_id=? AND version=?').bind(row.project_id,work.actor.id,work.macro.commandId,selected.id,work.macro.id,work.macro.version).first():await env.DB.prepare('SELECT 1 FROM ticket_history WHERE id=? AND project_id=? AND conversation_id=?').bind(receipt,row.project_id,selected.id).first()
    if(!committed){if(work.macro)await applyMacro(env,work.actor,work.macro.id,work.macro.version,selected,work.macro.commandId,work.authority)
    else await mutateTicket(env,work.actor,selected.id,{...work.changes,expected_ticket_version:selected.expected_version},work.authority,bulkReceipt(work.actor,work.authority.source??'dashboard',work.batchId,selected.id,work.changes!),receipt)}
    status='applied';applied.push(selected.id)
   }catch(error){
    if(error instanceof TicketCommittedError){status='applied';applied.push(selected.id)}
    else{
     const code=(error as {status?:number}).status,refused=Boolean(code&&[400,401,403,404,409,422].includes(code))
     attempts++;status=refused?'refused':attempts<5?'retry':'failed'
     event=batchEvent(work,selected.id,refused?'refused':'failed',status==='retry')
    }
   }
  }
  const next=results.map(r=>r.id===selected.id?{id:r.id,status,attempts}:r)
  const guard={sql:"EXISTS(SELECT 1 FROM ticket_batch_jobs WHERE id=? AND state='pending' AND cursor=?)",params:[row.id,row.cursor]}
  const saved=await env.DB.batch([
   ...(event?[auditStatement(env.DB,event,Date.now(),guard)]:[]),
   env.DB.prepare("UPDATE ticket_batch_jobs SET cursor=cursor+1,results_json=?,updated_at=? WHERE id=? AND state='pending' AND cursor=?").bind(JSON.stringify(next),Date.now(),row.id,row.cursor)
  ])
  if(!saved.at(-1)!.meta.changes)return true
  results.splice(0,results.length,...next);row.cursor++
 }
 if(row.cursor===work.tickets.length){
  const next=work.tickets.findIndex(t=>results.some(r=>r.id===t.id&&r.status==='retry'))
  if(next<0)await finishContinuation(env,row,work,results)
  else{await env.DB.prepare("UPDATE ticket_batch_jobs SET cursor=?,updated_at=? WHERE id=? AND state='pending' AND cursor=?").bind(next,Date.now(),row.id,row.cursor).run();retry=true}
 }else retry=true
 await finishBatchWorkflows(env,row.project_id,applied)
 // Cron leaves the committed assignment intents to its notifications consumer,
 // which admits each entire delivery before claiming it.
 if(!inCron(env))await flushRequestAssignments(env)
 if(retry){try{await env.JOBS.send(batchWake(work.batchId,work.actor.projectId,work.tickets))}catch{console.error('Ticket batch retained for recovery',row.id)}}
 return true
}
/** One discovery statement comes from Context's existing reservation. Ticket
 * units use unused earlier credit only; every later consumer remains reserved.
 * The first cron sighting only wakes a never-started job. This persisted marker
 * keeps a concurrent request's results boundary, even with a frozen Worker clock.
 * Already-attempted jobs recover inline immediately; a lost initial wake is
 * eligible inline on the next tick, without a wall-clock lease or grace delay. */
export async function recoverTicketContinuations(env:Env){
 const rows=await env.DB.prepare(`UPDATE ticket_batch_jobs SET recovery_ticks=recovery_ticks+1
  WHERE id IN (SELECT id FROM ticket_batch_jobs WHERE state='pending' ORDER BY updated_at,id LIMIT 10)
  RETURNING id,project_id,selection_json,attempts,recovery_ticks,updated_at`).all<{id:string;project_id:string;selection_json:string;attempts:number;recovery_ticks:number;updated_at:number}>()
 rows.results.sort((a,b)=>a.updated_at-b.updated_at||a.id.localeCompare(b.id))
 for(const row of rows.results){
  // A saturated cron still wakes the job in its own queue invocation. Inline
  // progress also recovers a lost wakeup without depending on queue delivery.
  try{await env.JOBS.send(batchWake(row.id,row.project_id,JSON.parse(row.selection_json) as Selection[]))}catch{console.error('Ticket batch wakeup retained',row.id)}
  if((row.attempts===0&&row.recovery_ticks===1)||!cronRoom(env,256))continue
  try{await consumeTicketContinuation({type:'ticket.batch',id:row.id,projectId:row.project_id},env)}catch(error){console.error('Ticket batch recovery retained',row.id,error instanceof Error?error.name:'Error')}
 }
}
