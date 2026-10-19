import type {Env} from '../../platform/env'
import {boundedDatabase} from '../../platform/d1-budget'
import {requestRoom} from '../integrations/notification-request'
import {syncSlaTickets,liveSlaTicketSql} from '../workflows/sla'
import {workflowNow} from '../workflows/clock'
/** The empty-rule case needs one SLA rebuild for the selection, rather than one
 * journal execution per ticket. The live predicate prevents a publication race.
 * Nonempty rule work remains in the native durable journal for scheduled recovery. */
export async function finishBatchWorkflows(input:Env,projectId:string,ids:string[]){
 if(!ids.length||requestRoom(input)<32)return
 const meter=boundedDatabase(input.DB,Math.min(32,requestRoom(input))),env={...input,DB:meter.database}
 try{
  await syncSlaTickets(env,ids)
  await env.DB.prepare(`UPDATE workflow_events AS e SET state='complete',rules_done=1,routing_done=1,time_reset_done=1,error=NULL
   WHERE e.project_id=? AND e.conversation_id IN (SELECT value FROM json_each(?)) AND e.state='pending'
   AND coalesce(e.next_attempt_at,0)<=? AND coalesce(e.lease_until,0)<=?
   AND NOT EXISTS(SELECT 1 FROM workflow_rules r WHERE r.project_id=e.project_id AND r.state='published' AND r.published_version IS NOT NULL)
   AND EXISTS(SELECT 1 FROM conversations c WHERE c.id=e.conversation_id AND c.project_id=e.project_id AND ${liveSlaTicketSql()})`).bind(projectId,JSON.stringify(ids),workflowNow(env),workflowNow(env)).run()
 }catch(error){console.error('Bulk workflow journal retained',error instanceof Error?error.name:'Error')}
}
