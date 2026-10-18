import {conversationHasMessages} from '../management/inbox-visible'
import type {Env} from '../../platform/env'
import {runEventRules} from './rule-engine'
import {routeTicket} from './routing'
import {syncSlaTickets} from './sla'
import {workflowNow} from './clock'
import {boundedDatabase} from '../../platform/d1-budget'
import type {Spent} from './budget'
import {workflowInvocation,servedWorkflowEvents} from './invocation'
const delays=[1,5,15,60],attemptLimit=5
/** Workspace turns survive completed events and clock ties. Inline recovery uses the
 * same due/lease predicate as cron, so it cannot bypass a deferred attempt. */
const dueEvents=`SELECT * FROM (SELECT e.*,coalesce(q.turn,0) workspace_turn,row_number() OVER (PARTITION BY e.project_id ORDER BY e.id) turn FROM workflow_events e LEFT JOIN workflow_queue_turns q ON q.project_id=e.project_id AND q.queue='events' WHERE e.state='pending' AND (?2 IS NULL OR e.last_tick IS NULL OR e.last_tick<>?2) AND e.source NOT IN ('rule','automation','schedule','rer') AND coalesce(e.next_attempt_at,0)<=?1 AND coalesce(e.lease_until,0)<=?1) ORDER BY turn,workspace_turn,id LIMIT ?3`
export async function processWorkflowEvents(input:Env,conversationId?:string,limit=20,spent?:Spent){
 const tick=workflowInvocation(input),served=servedWorkflowEvents(input);if(tick&&!spent)spent=()=>false
 const now=workflowNow(input),rows=await input.DB.prepare(conversationId?`SELECT * FROM workflow_events WHERE state='pending' AND conversation_id=?1 AND (?2 IS NULL OR last_tick IS NULL OR last_tick<>?2) AND coalesce(next_attempt_at,0)<=?3 AND coalesce(lease_until,0)<=?3 ORDER BY id LIMIT ?4`:dueEvents).bind(...(conversationId?[conversationId,tick??null,now,limit]:[now,tick??null,limit])).all<any>()
 let processed=0
 for(const event of rows.results){
  if(spent?.())break
  if(served?.has(event.id))continue
  // Journal work is capped separately from a rule run's 80-statement quantum.
  // Five durable outcome writes and the shared queue read fit inside 71. The reserve protects its outcome;
  // a continuation is not another failed attempt and never repeats committed effects.
  const meter=boundedDatabase(input.DB,spent?65:800,3),env={...input,DB:meter.database},lease=crypto.randomUUID()
  const claim=await env.DB.prepare("UPDATE workflow_events SET lease_token=?,lease_until=?,last_tick=coalesce(?,last_tick),attempts=attempts+CASE WHEN attempts<5 THEN 1 ELSE 0 END WHERE id=? AND state='pending' AND coalesce(next_attempt_at,0)<=? AND coalesce(lease_until,0)<=?").bind(lease,now+120000,tick??null,event.id,now,now).run()
  if(!claim.meta.changes)continue
  served?.add(event.id)
  await env.DB.prepare("INSERT INTO workflow_queue_turns(queue,project_id,turn) VALUES('events',?,(SELECT coalesce(max(turn),0)+1 FROM workflow_queue_turns WHERE queue='events')) ON CONFLICT(queue,project_id) DO UPDATE SET turn=excluded.turn").bind(event.project_id).run()
  const update=async(sql:string,...args:unknown[])=>input.DB.prepare(`UPDATE workflow_events SET ${sql} WHERE id=? AND lease_token=? AND state='pending'`).bind(...args,event.id,lease).run()
  let retainedAttempt=false
  const defer=async(reason:string)=>{retainedAttempt=true;const attempts=event.attempts+1;await update('state=?,attempts=?,next_attempt_at=?,error=?',attempts>=attemptLimit?'not_routed':'pending',attempts,attempts>=attemptLimit?null:now+delays[attempts-1]*60000,attempts>=attemptLimit?`${reason}. Stopped after ${attemptLimit} attempts; ticket remains in its responsible queue.`:reason)}
  try{
   if(event.attempts>=attemptLimit&&!event.routing_done){retainedAttempt=true;await update("state='not_routed',next_attempt_at=NULL,error=?",`Workflow processing was interrupted. Stopped after ${attemptLimit} attempts; ticket remains in its responsible queue.`);continue}
   const live=await env.DB.prepare(`SELECT c.id FROM conversations c WHERE c.project_id=? AND c.id=? AND ${conversationHasMessages()} AND NOT EXISTS(SELECT 1 FROM contact_erasures er WHERE er.project_id=c.project_id AND er.contact_id=c.contact_id) AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=c.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM move_in_conversations mi WHERE mi.project_id=c.project_id AND mi.conversation_id=c.id) AND NOT EXISTS(SELECT 1 FROM reporting_legacy_conversations li WHERE li.project_id=c.project_id AND li.conversation_id=c.id)`).bind(event.project_id,event.conversation_id).first()
   if(!live){await update("state='cancelled',error='Historical import, erased contact or unavailable workspace'");continue}
   if(!['rule','automation','schedule','rer'].includes(event.source)){
    if(!event.rules_done){
     const done=await runEventRules(env,event,spent?()=>spent()||meter.statements>=55:undefined,input)
     if(done===false)continue
     await update('rules_done=1');event.rules_done=1
    }
    if(!event.routing_done&&['created','customer_reply','changed'].includes(event.kind)){
     // Route from a fresh quantum; its transaction is attempted once, never in a loop.
     if(spent&&meter.statements>38)continue
     if(event.attempts>=attemptLimit){await update("state='not_routed',next_attempt_at=NULL,error=?",`Routing was interrupted. Stopped after ${attemptLimit} attempts; ticket remains in its responsible queue.`);continue}
     // Count before attempting the transaction, including a process exit after it.
     retainedAttempt=true
     await update('attempts=?,next_attempt_at=?',event.attempts+1,now+delays[Math.min(event.attempts,delays.length-1)]*60000)
     const routed=await routeTicket(env,event.conversation_id,event.id)
     if(routed.state==='pending'){await defer(routed.explanation??'Routing commit was refused');continue}
     await update('routing_done=1,next_attempt_at=NULL');event.routing_done=1
    }
   }
   if(spent&&meter.statements>53)continue
   await syncSlaTickets(env,[event.conversation_id],now)
   await update("state='complete',next_attempt_at=NULL,error=NULL")
   processed++
  }catch(error){
   if(error instanceof Error&&error.message==='WORKER_D1_STATEMENT_LIMIT'){
    // A rule run owns its action cursor. Re-reading the event resumes that run;
    // routing is single-attempt and fits a fresh quantum.
    if(event.rules_done)await defer('Workflow event exceeded its statement allowance')
   }else await defer(error instanceof Error?error.message.slice(0,1000):'Workflow event failed')
  }finally{await input.DB.prepare('UPDATE workflow_events SET lease_token=NULL,lease_until=NULL,time_reset_done=max(time_reset_done,?),attempts=max(0,attempts-?) WHERE id=? AND lease_token=?').bind(event.time_reset_done??0,!retainedAttempt&&event.attempts<attemptLimit?1:0,event.id,lease).run()}
 }
 return {processed}
}
