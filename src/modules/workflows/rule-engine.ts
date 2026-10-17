import type {Env} from '../../platform/env'
import {evaluateConditions} from './conditions'
import {publishedRules,ruleTicket,type RuleDefinition} from './rule-model'
import {planRuleRun} from './rule-run'
export interface WorkflowEvent {id:number|string;project_id:string;conversation_id:string;kind:string;at:number;source?:string;revision:number;last_message_id:string|null;ticket_version?:number;before_json?:string;after_json?:string}
/** The native journal is the only admission door. Generated rule/automation
 * changes do not recursively re-enter event rules. Ordered rules see the result
 * of earlier rules, and every execution retains its immutable version. */
export async function runEventRules(env:Env,event:WorkflowEvent){
 let ticket=await ruleTicket(env,event.project_id,event.conversation_id);if(!ticket)return
 const timeRules=await publishedRules(env,'time',event.project_id)
 for(const row of timeRules){const d=JSON.parse(row.definition_json) as RuleDefinition
  const eventTicket={...ticket,...(event.after_json?JSON.parse(event.after_json):{})},reset=event.kind==='customer_reply'||!evaluateConditions(eventTicket,d.conditions).matched
  await env.DB.prepare(`UPDATE workflow_time_state SET eligible=CASE WHEN ? THEN 0 ELSE eligible END,episode=CASE WHEN ? THEN '' ELSE episode END,last_run_at=CASE WHEN ? THEN NULL ELSE last_run_at END,last_event_id=? WHERE rule_id=? AND conversation_id=? AND last_event_id<?`).bind(reset?1:0,reset?1:0,reset?1:0,Number(event.id),row.id,ticket.id,Number(event.id)).run()
 }
 if(ticket.revision!==event.revision||ticket.last_message_id!==event.last_message_id)return
 if(['rule','automation','routing'].includes(event.source??''))return
 const newer=await env.DB.prepare("SELECT 1 FROM workflow_events WHERE project_id=? AND conversation_id=? AND id>? AND source NOT IN ('rule','automation','routing') LIMIT 1").bind(event.project_id,event.conversation_id,event.id).first()
 if(newer)return
 const rules=await publishedRules(env,'event',event.project_id)
 for(const row of rules){const d=JSON.parse(row.definition_json) as RuleDefinition
  // Publication captures the committed journal frontier in its transaction.
  // A backlog of old events never activates a newly published definition.
  if(Number(event.id)<=(row.event_after_id??0))continue
  if(d.event_kind&&d.event_kind!==event.kind)continue
  ticket=await ruleTicket(env,event.project_id,event.conversation_id);if(!ticket||ticket.revision!==event.revision||ticket.last_message_id!==event.last_message_id)break
  const condition=evaluateConditions(ticket,d.conditions)
  if(condition.matched)await planRuleRun(env,row,ticket,`event:${event.id}`,{event:event.id,kind:event.kind,conditions:condition.explanation,position:row.position,stop_condition:'Terminal receipt, changed ticket frontier, pause or cancellation'})
 }
}
