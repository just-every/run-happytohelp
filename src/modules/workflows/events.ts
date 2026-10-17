import type {Env} from '../../platform/env'
import {runEventRules} from './rule-engine'
import {routeTicket} from './routing'
import {syncSlaTickets} from './sla'
import {workflowNow} from './clock'
import type {Spent} from './budget'
/** Each engine has its own durable effects. Re-reading a pending journal event
 * never authorizes a second send or another round-robin turn. */
export async function processWorkflowEvents(env:Env,conversationId?:string,limit=20,spent?:Spent){
 const rows=await env.DB.prepare(`SELECT e.* FROM workflow_events e WHERE e.state='pending' ${conversationId?'AND e.conversation_id=?':''} ORDER BY e.id LIMIT ?`).bind(...(conversationId?[conversationId]:[]),limit).all<any>()
 let processed=0
 for(const event of rows.results){
  if(spent?.())break
  const live=await env.DB.prepare(`SELECT c.id FROM conversations c WHERE c.project_id=? AND c.id=? AND NOT EXISTS(SELECT 1 FROM contact_erasures er WHERE er.project_id=c.project_id AND er.contact_id=c.contact_id) AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=c.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM move_in_conversations mi WHERE mi.project_id=c.project_id AND mi.conversation_id=c.id) AND NOT EXISTS(SELECT 1 FROM reporting_legacy_conversations li WHERE li.project_id=c.project_id AND li.conversation_id=c.id)`).bind(event.project_id,event.conversation_id).first()
  if(!live){await env.DB.prepare("UPDATE workflow_events SET state='cancelled',error='Historical import, erased contact or unavailable workspace' WHERE id=? AND state='pending'").bind(event.id).run();continue}
  // Rule-generated changes may feed SLA clocks, but never restart the rule
  // chain. Every published rule is evaluated at most once in its ordered pass.
  if(!['rule','automation','schedule','rer'].includes(event.source)){
   await runEventRules(env,event)
   if(['created','customer_reply','changed'].includes(event.kind)){
    const routed=await routeTicket(env,event.conversation_id,event.id)
    if(routed.state==='pending')continue
   }
  }
  await syncSlaTickets(env,[event.conversation_id],workflowNow(env))
  await env.DB.prepare("UPDATE workflow_events SET state='complete',error=NULL WHERE id=? AND state='pending'").bind(event.id).run()
  processed++
 }
 return {processed}
}
