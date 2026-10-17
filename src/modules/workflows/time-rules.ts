import type {Env} from '../../platform/env'
import {evaluateConditions,columnPrefilter} from './conditions'
import {ruleTicket,type RuleDefinition} from './rule-model'
import {evaluateTime} from './rule-time'
import {planRuleRun} from './rule-run'
import {liveSlaTicketSql} from './sla'
import type {Spent} from './budget'
const PAGE=10
const statusChanged="coalesce((SELECT max(h.at) FROM ticket_history h WHERE h.conversation_id=c.id AND json_extract(h.changes_json,'$.status_id.to')=c.status_id),c.created_at)"
/** Each anchor as ruleTicket computes it. Business hours never exceed wall-clock hours,
 * so `anchor <= now - hours` is a necessary condition for every calendar too. */
const anchors:Record<string,string>={
 created_at:'c.created_at',updated_at:'c.updated_at',status_changed_at:statusChanged,
 pending_at:`CASE WHEN c.status_category='pending' THEN ${statusChanged} END`,
 on_hold_at:`CASE WHEN c.status_category='on_hold' THEN ${statusChanged} END`,
 solved_at:"CASE WHEN c.status_category='solved' THEN c.resolved_at END",
 assigned_at:"(SELECT max(h.at) FROM ticket_history h WHERE h.conversation_id=c.id AND json_extract(h.changes_json,'$.assigned_to.to')=c.assigned_to)",
 last_customer_reply_at:"(SELECT max(m.created_at) FROM messages m WHERE m.conversation_id=c.id AND m.actor_role='contact')",
 last_operator_reply_at:"(SELECT max(m.created_at) FROM messages m WHERE m.conversation_id=c.id AND m.actor_role<>'contact')",
}
/** Rules are served least recently first, one per workspace before any workspace's
 * second, so one workspace's backlog never holds another's tickets. */
const dueRules=`SELECT * FROM (SELECT r.id,r.project_id,r.position,r.published_version,v.definition_json,sc.hour cursor_hour,sc.version cursor_version,sc.after_id cursor_after,sc.complete cursor_complete,coalesce(sc.updated_at,0) served_at,coalesce(q.turn,0) workspace_served,row_number() OVER (PARTITION BY r.project_id ORDER BY coalesce(sc.updated_at,0),r.position,r.id) turn
 FROM workflow_rules r JOIN workflow_rule_versions v ON v.rule_id=r.id AND v.version=r.published_version LEFT JOIN workflow_scheduler_cursors sc ON sc.rule_id=r.id LEFT JOIN workflow_queue_turns q ON q.queue='time-rules' AND q.project_id=r.project_id
 WHERE r.state='published' AND r.kind='time' AND coalesce(sc.hour=?1 AND sc.version=r.published_version AND sc.complete=1,0)=0 AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=r.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL))
 ORDER BY turn,workspace_served,served_at,project_id,position,id LIMIT 20`
/** An hourly pass reads only tickets whose anchor is due and whose current episode has
 * not run; a pass that does not finish in its hour continues where it stopped. */
export async function runTimeRules(env:Env,now:number,spent?:Spent){
 const hour=Math.floor(now/3600000),rules=(await env.DB.prepare(dueRules).bind(hour).all<any>()).results
 for(const row of rules){if(spent?.())break
  await env.DB.prepare("INSERT INTO workflow_queue_turns(queue,project_id,turn) SELECT 'time-rules',?,coalesce(max(turn),0)+1 FROM workflow_queue_turns WHERE queue='time-rules' ON CONFLICT(queue,project_id) DO UPDATE SET turn=excluded.turn").bind(row.project_id).run()
  const d=JSON.parse(row.definition_json) as RuleDefinition,anchor=anchors[d.time!.field]
  const after=row.cursor_version===row.published_version&&(row.cursor_hour===hour||!row.cursor_complete)?row.cursor_after:''
  // Imported history never enters the journal, so automations never act on it. A ticket
  // that stops matching is reset by the journal event that changed it (runEventRules).
  const prefilter=columnPrefilter(d.conditions),due=anchor?` AND (${anchor})<=?`:'',dueArgs=anchor?[now-d.time!.hours*3600000]:[]
  const conversations=await env.DB.prepare(`SELECT c.id FROM conversations c WHERE c.project_id=? AND c.id>? AND c.status_category<>'closed' AND ${liveSlaTicketSql()}${prefilter.sql}${due} AND NOT EXISTS(SELECT 1 FROM workflow_time_state ts WHERE ts.rule_id=? AND ts.conversation_id=c.id AND ts.version=? AND ts.eligible=1 AND ts.last_run_at IS NOT NULL) ORDER BY c.id LIMIT ?`).bind(row.project_id,after,...prefilter.params,...dueArgs,row.id,row.published_version,PAGE).all<{id:string}>()
  let last=after,done=0
  for(const {id} of conversations.results){if(spent?.())break;done++;last=id
   const ticket=await ruleTicket(env,row.project_id,id);if(!ticket)continue
   const condition=evaluateConditions(ticket,d.conditions)
   if(!condition.matched){await env.DB.prepare("UPDATE workflow_time_state SET eligible=0,episode='',last_run_at=NULL WHERE rule_id=? AND conversation_id=? AND version=?").bind(row.id,id,row.published_version).run();continue}
   const time=await evaluateTime(env,row.project_id,ticket,d,now)
   if(!time.matched)continue
   let state=await env.DB.prepare('SELECT * FROM workflow_time_state WHERE rule_id=? AND conversation_id=? AND version=?').bind(row.id,id,row.published_version).first<any>()
   // A new eligibility episode is the only repeat permission. Merely ticking
   // another hour, restarting, or an unrelated ticket update never resets it.
   if(!state||!state.eligible){const episode=crypto.randomUUID();await env.DB.prepare('INSERT INTO workflow_time_state(rule_id,project_id,conversation_id,version,episode,eligible,last_event_id,last_run_at) SELECT ?,?,?,?,?,1,coalesce(max(id),0),NULL FROM workflow_events WHERE project_id=? AND conversation_id=? ON CONFLICT(rule_id,conversation_id,version) DO UPDATE SET episode=excluded.episode,eligible=1,last_event_id=max(workflow_time_state.last_event_id,excluded.last_event_id),last_run_at=NULL WHERE workflow_time_state.eligible=0').bind(row.id,row.project_id,id,row.published_version,episode,row.project_id,id).run();state=await env.DB.prepare('SELECT * FROM workflow_time_state WHERE rule_id=? AND conversation_id=? AND version=?').bind(row.id,id,row.published_version).first<any>()}
   if(state.last_run_at!==null)continue
   const run=await planRuleRun(env,row,ticket,`time:${state.episode}`,{conditions:condition.explanation,time,position:row.position,stop_condition:'Once per continuous eligibility episode; reset by a customer reply or a false condition'},spent)
   if(run)await env.DB.prepare('UPDATE workflow_time_state SET last_run_at=? WHERE rule_id=? AND conversation_id=? AND version=? AND episode=?').bind(now,row.id,id,row.published_version,state.episode).run()
  }
  // One write per visit; a concurrent tick never moves a cursor backwards.
  await env.DB.prepare("INSERT INTO workflow_scheduler_cursors(rule_id,project_id,version,hour,after_id,complete,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(rule_id) DO UPDATE SET version=excluded.version,hour=excluded.hour,after_id=excluded.after_id,complete=max(excluded.complete,CASE WHEN workflow_scheduler_cursors.hour=excluded.hour AND workflow_scheduler_cursors.version=excluded.version THEN workflow_scheduler_cursors.complete ELSE 0 END),updated_at=excluded.updated_at WHERE workflow_scheduler_cursors.version<excluded.version OR workflow_scheduler_cursors.version=excluded.version AND (workflow_scheduler_cursors.hour<excluded.hour OR workflow_scheduler_cursors.hour=excluded.hour AND workflow_scheduler_cursors.after_id<=excluded.after_id)").bind(row.id,row.project_id,row.published_version,hour,last,done===conversations.results.length&&done<PAGE?1:0,now).run()
 }
}
