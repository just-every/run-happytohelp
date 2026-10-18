import type {Env} from '../../platform/env'
import {availableTicketSql} from '../tickets/model'
import {evaluateConditions} from './conditions'
import {ruleTicket,type RuleDefinition} from './rule-model'
import {evaluateTime} from './rule-time'
import {workflowNow} from './clock'
/** Read-only historical simulation. This module never calls an action executor,
 * allocates a receipt, advances a routing cursor, or invokes a delivery adapter. */
export async function previewRule(env:Env,projectId:string,d:RuleDefinition){
 const events=(await env.DB.prepare(`SELECT e.* FROM workflow_events e JOIN conversations c ON c.id=e.conversation_id AND c.project_id=e.project_id WHERE e.project_id=? AND e.id=(SELECT max(latest.id) FROM workflow_events latest WHERE latest.project_id=e.project_id AND latest.conversation_id=e.conversation_id) AND ${availableTicketSql()} ORDER BY e.id DESC LIMIT 250`).bind(projectId).all<any>()).results
 const rows=events.map(e=>({conversation_id:e.conversation_id,event_id:e.id,event_kind:e.kind,at:e.at,snapshot:JSON.parse(e.after_json)}))
 // Upgrades have pre-journal history. Include actual stored tickets as evidence,
 // rather than manufacturing historical events to reach a numeric preview target.
 if(rows.length<250){const tickets=(await env.DB.prepare(`SELECT c.id conversation_id FROM conversations c WHERE c.project_id=? AND ${availableTicketSql()} ORDER BY c.updated_at DESC,c.id LIMIT 250`).bind(projectId).all<any>()).results;const included=new Set(rows.map(r=>r.conversation_id));for(const t of tickets){if(rows.length>=250)break;if(!included.has(t.conversation_id)){included.add(t.conversation_id);rows.push({conversation_id:t.conversation_id,event_id:null,event_kind:'stored_ticket',at:workflowNow(env),snapshot:null})}}}
 const results=[]
 for(const row of rows){const current=await ruleTicket(env,projectId,row.conversation_id,true);if(!current)continue;const snapshot=row.snapshot?{...current,...row.snapshot}:current,condition=evaluateConditions(snapshot,d.conditions),time=d.kind==='time'?await evaluateTime(env,projectId,snapshot,d,workflowNow(env)):null,eventMatches=!d.event_kind||row.event_kind==='stored_ticket'||row.event_kind===d.event_kind||row.event_kind==='created'&&d.event_kind===(row.snapshot?.actor_role==='contact'?'customer_reply':'operator_reply')
  results.push({conversation_id:row.conversation_id,event_id:row.event_id,matched:condition.matched&&eventMatches&&(!time||time.matched),explanation:{conditions:condition.explanation,event_matches:eventMatches,time,...(d.routing?{routing:d.routing}:{}),conflict_order:d.position},actions:d.actions})}
 return {total:results.length,matched:results.filter(r=>r.matched).length,results,side_effects:false}
}
