import type {Env} from '../../platform/env'
import {evaluateConditions} from './conditions'
import {publishedRules,ruleTicket,type RuleDefinition} from './rule-model'
import {evaluateTime} from './rule-time'
import {planRuleRun,executeRuleRun} from './rule-run'
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
export async function runTimeRules(env:Env,now:number){
 // Resuming pending preparation is safe: local actions and notify claims each
 // have a permanent receipt. Failed/uncertain actions are deliberately excluded.
 const pending=await env.DB.prepare("SELECT id FROM workflow_runs WHERE state IN ('running','pending') ORDER BY created_at,id LIMIT 5").all<{id:string}>()
 for(const run of pending.results)await executeRuleRun(env,run.id)
 const rules=await publishedRules(env,'time'),hour=Math.floor(now/3600000)
 let budget=30
 for(const row of rules){const d=JSON.parse(row.definition_json) as RuleDefinition
  let cursor=await env.DB.prepare('SELECT * FROM workflow_scheduler_cursors WHERE rule_id=?').bind(row.id).first<any>()
  if(cursor&&cursor.hour===hour&&cursor.version===row.published_version&&cursor.complete)continue
  if(!budget)break
  if(!cursor||cursor.hour!==hour||cursor.version!==row.published_version){await env.DB.prepare("INSERT INTO workflow_scheduler_cursors(rule_id,project_id,version,hour,after_id,complete,updated_at) VALUES(?,?,?,?,'',0,?) ON CONFLICT(rule_id) DO UPDATE SET version=excluded.version,hour=excluded.hour,after_id='',complete=0,updated_at=excluded.updated_at WHERE workflow_scheduler_cursors.version<excluded.version OR workflow_scheduler_cursors.version=excluded.version AND workflow_scheduler_cursors.hour<=excluded.hour").bind(row.id,row.project_id,row.published_version,hour,now).run();cursor={after_id:''}}
  const pageSize=budget,conversations=await env.DB.prepare("SELECT id FROM conversations WHERE project_id=? AND id>? AND status_category<>'closed' ORDER BY id LIMIT ?").bind(row.project_id,cursor.after_id,pageSize).all<{id:string}>()
  budget-=conversations.results.length
  for(const {id} of conversations.results){const ticket=await ruleTicket(env,row.project_id,id);if(!ticket)continue
   const condition=evaluateConditions(ticket,d.conditions)
   if(!condition.matched){await env.DB.prepare("UPDATE workflow_time_state SET eligible=0,episode='',last_run_at=NULL WHERE rule_id=? AND conversation_id=? AND version=?").bind(row.id,id,row.published_version).run();continue}
   const time=await evaluateTime(env,row.project_id,ticket,d,now)
   if(!time.matched)continue
   let state=await env.DB.prepare('SELECT * FROM workflow_time_state WHERE rule_id=? AND conversation_id=? AND version=?').bind(row.id,id,row.published_version).first<any>()
   // A new eligibility episode is the only repeat permission. Merely ticking
   // another hour, restarting, or an unrelated ticket update never resets it.
   if(!state||!state.eligible){const episode=crypto.randomUUID();await env.DB.prepare('INSERT INTO workflow_time_state(rule_id,project_id,conversation_id,version,episode,eligible,last_event_id,last_run_at) SELECT ?,?,?,?,?,1,coalesce(max(id),0),NULL FROM workflow_events WHERE project_id=? AND conversation_id=? ON CONFLICT(rule_id,conversation_id,version) DO UPDATE SET episode=excluded.episode,eligible=1,last_event_id=max(workflow_time_state.last_event_id,excluded.last_event_id),last_run_at=NULL WHERE workflow_time_state.eligible=0').bind(row.id,row.project_id,id,row.published_version,episode,row.project_id,id).run();state=await env.DB.prepare('SELECT * FROM workflow_time_state WHERE rule_id=? AND conversation_id=? AND version=?').bind(row.id,id,row.published_version).first<any>()}
   if(state.last_run_at!==null)continue
   const run=await planRuleRun(env,row,ticket,`time:${state.episode}`,{conditions:condition.explanation,time,position:row.position,stop_condition:'Once per continuous eligibility episode; reset by a customer reply or a false condition'})
   if(run)await env.DB.prepare('UPDATE workflow_time_state SET last_run_at=? WHERE rule_id=? AND conversation_id=? AND version=? AND episode=?').bind(now,row.id,id,row.published_version,state.episode).run()
  }
  await env.DB.prepare('UPDATE workflow_scheduler_cursors SET after_id=max(after_id,?),complete=max(complete,?),updated_at=max(updated_at,?) WHERE rule_id=? AND hour=? AND version=?').bind(conversations.results.at(-1)?.id??cursor.after_id,conversations.results.length<pageSize?1:0,now,row.id,hour,row.published_version).run()
 }
}
