import type {Env} from '../../platform/env'
import {evaluateConditions} from './conditions'
import {publishedRules,ruleTicket,type RuleDefinition} from './rule-model'
import {planRuleRun} from './rule-run'
import type {Spent} from './budget'
export interface WorkflowEvent {id:number|string;project_id:string;conversation_id:string;kind:string;at:number;source?:string;revision:number;last_message_id:string|null;ticket_version?:number;before_json?:string;after_json?:string;time_reset_done?:number;rule_position?:number;rule_after_id?:string}
/** The native journal is the only admission door. Generated rule/automation
 * changes do not recursively re-enter event rules. Ordered rules see the result
 * of earlier rules, and every execution retains its immutable version. */
export async function runEventRules(env:Env,event:WorkflowEvent,spent?:Spent,executionEnv=env){
 let ticket=await ruleTicket(env,event.project_id,event.conversation_id);if(!ticket)return
 let applicable:any[]|undefined
 if(!event.time_reset_done){
  applicable=await publishedRules(env,['time','event'],event.project_id)
  const timeRules=applicable.filter(row=>row.kind==='time'),eventTicket={...ticket,...(event.after_json?JSON.parse(event.after_json):{})}
  const resets=timeRules.map(row=>({id:row.id,reset:event.kind==='customer_reply'||!evaluateConditions(eventTicket,(JSON.parse(row.definition_json) as RuleDefinition).conditions).matched}))
  await env.DB.prepare(`UPDATE workflow_time_state SET eligible=CASE WHEN json_extract(r.value,'$.reset') THEN 0 ELSE eligible END,episode=CASE WHEN json_extract(r.value,'$.reset') THEN '' ELSE episode END,last_run_at=CASE WHEN json_extract(r.value,'$.reset') THEN NULL ELSE last_run_at END,last_event_id=? FROM json_each(?) r WHERE rule_id=json_extract(r.value,'$.id') AND conversation_id=? AND last_event_id<?`).bind(Number(event.id),JSON.stringify(resets),ticket.id,Number(event.id)).run()
  event.time_reset_done=1
 }
 if(ticket.revision!==event.revision||ticket.last_message_id!==event.last_message_id)return
 if(['rule','automation','routing'].includes(event.source??''))return
 const newer=await env.DB.prepare("SELECT 1 FROM workflow_events WHERE project_id=? AND conversation_id=? AND id>? AND source NOT IN ('rule','automation','routing') LIMIT 1").bind(event.project_id,event.conversation_id,event.id).first()
 if(newer)return
 const rules=applicable?.filter(row=>row.kind==='event')??await publishedRules(env,'event',event.project_id);let evaluated=false
 for(const row of rules){
  if(row.position<(event.rule_position??-1)||row.position===event.rule_position&&row.id<=(event.rule_after_id??''))continue
  if(spent?.())return false
  const d=JSON.parse(row.definition_json) as RuleDefinition
  // Publication captures the committed journal frontier in its transaction.
  // A backlog of old events never activates a newly published definition.
  if(Number(event.id)<=(row.event_after_id??0))continue
  // The first customer message admits the ticket once, and also satisfies reply rules.
  if(d.event_kind&&d.event_kind!==event.kind&&!(event.kind==='created'&&d.event_kind==='customer_reply'))continue
  if(evaluated)ticket=await ruleTicket(env,event.project_id,event.conversation_id);evaluated=true;if(!ticket||ticket.revision!==event.revision||ticket.last_message_id!==event.last_message_id)break
  const condition=evaluateConditions(ticket,d.conditions)
  if(condition.matched){const run=await planRuleRun(env,row,ticket,`event:${event.id}`,{event:event.id,kind:event.kind,conditions:condition.explanation,position:row.position,stop_condition:'Terminal receipt, changed ticket frontier, pause or cancellation'},spent,executionEnv);if(run&&['pending','running'].includes(run.state))return false}
  await env.DB.prepare('UPDATE workflow_events SET rule_position=?,rule_after_id=? WHERE id=?').bind(row.position,row.id,event.id).run()
 }
 return true
}
