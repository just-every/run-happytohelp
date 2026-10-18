import {conversationHasMessages} from '../management/inbox-visible'
import type {Env} from '../../platform/env'
import {applyWorkflowActions,type WorkflowGuard} from './actions'
import {evaluateConditions} from './conditions'
import {publishedRules,ruleTicket,type RuleDefinition} from './rule-model'
import {chooseCandidate,routingCandidates,routingMemberSql} from './routing-candidates'
import {workflowNow} from './clock'
import {inRoutingTurn} from './routing-turn'
import {workflowMemberGuard} from './rule-access'
import {validateRuleReferences} from './rule-validation'
export interface RoutingResult {state:'not_found'|'complete'|'skipped'|'pending';decision?:any;explanation?:string}
/** Fairness state, decision and ticket assignment commit together. Contended
 * plans are retried by the durable caller, once per attempt. */
export async function routeTicket(env:Env,ticketId:string,eventId:string|number,outerGuard?:WorkflowGuard,onCommit?:(accepted:string,args:unknown[])=>D1PreparedStatement[]):Promise<RoutingResult>{
 const ticketProject=await env.DB.prepare('SELECT project_id FROM conversations WHERE id=?').bind(ticketId).first<{project_id:string}>();if(!ticketProject)return {state:'not_found'}
 const projectId=ticketProject.project_id,event=String(eventId)
 return inRoutingTurn<RoutingResult>(projectId,async()=>{
 const recorded=await env.DB.prepare('SELECT * FROM routing_decisions WHERE project_id=? AND conversation_id=? AND event_id=?').bind(projectId,ticketId,event).first<any>();if(recorded)return {state:'complete',decision:decisionData(recorded)}
 {
  const ticket=await ruleTicket(env,projectId,ticketId);if(!ticket||ticket.assigned_to||['solved','closed'].includes(ticket.status_category))return {state:'skipped',explanation:'Existing ownership or terminal status is preserved'}
  const rules=await publishedRules(env,'routing',projectId)
  const winner=rules.find(row=>(!/^\d+$/.test(event)||Number(event)>(row.event_after_id??0))&&evaluateConditions(ticket,(JSON.parse(row.definition_json) as RuleDefinition).conditions).matched)
  if(!winner)return {state:'skipped',explanation:'No published routing rule matched; ticket remains in its responsible queue'}
  const d=JSON.parse(winner.definition_json) as RuleDefinition,routing=d.routing!
  await env.DB.prepare('INSERT OR IGNORE INTO routing_state(project_id,rule_id,revision) VALUES(?,?,0)').bind(projectId,winner.id).run()
  const state=await env.DB.prepare('SELECT * FROM routing_state WHERE project_id=? AND rule_id=?').bind(projectId,winner.id).first<any>()
  let groupId=routing.group_id??ticket.group_id??null,overflow=false,candidates=await routingCandidates(env,projectId,routing,groupId??undefined)
  if(!candidates.length&&routing.overflow_group_id){groupId=routing.overflow_group_id;overflow=true;candidates=await routingCandidates(env,projectId,{...routing,strategy:'round_robin'},groupId)}
  const selected=chooseCandidate(candidates,routing.strategy,state.last_user_id),id=`routing:${projectId}:${ticketId}:${event}`
  const explanation=`Rule ${d.name} won at position ${winner.position}; strategy ${routing.strategy}. ${selected?`${selected.user_id} selected from ${candidates.length} eligible operators, workload ${selected.workload}/${selected.capacity}; previous turn ${state.last_user_id??'none'}.`:'No current operator satisfies membership, availability, skills and capacity; ticket remains unassigned.'} ${overflow?'Overflow responsible group selected.':groupId?'Responsible group retained.':'Workspace unassigned queue is responsible.'}`
  let guard=`EXISTS(SELECT 1 FROM workflow_rules WHERE id=? AND project_id=? AND state='published' AND published_version=?) AND EXISTS(SELECT 1 FROM routing_state WHERE project_id=? AND rule_id=? AND revision=?) AND c.assigned_to IS NULL`,params:unknown[]=[winner.id,projectId,winner.published_version,projectId,winner.id,state.revision]
  if(selected){guard+=` AND EXISTS(SELECT 1 FROM routing_operators o JOIN memberships m ON m.project_id=o.project_id AND m.user_id=o.user_id LEFT JOIN member_roles mr ON mr.project_id=m.project_id AND mr.user_id=m.user_id LEFT JOIN project_roles pr ON pr.project_id=mr.project_id AND pr.id=mr.role_key WHERE o.project_id=c.project_id AND o.user_id=? AND o.available=1 AND o.capacity=? AND o.skills_json=? AND o.updated_at=? AND ${routingMemberSql()} AND (SELECT count(*) FROM conversations load WHERE load.project_id=o.project_id AND load.assigned_to=o.user_id AND load.status_category NOT IN ('solved','closed') AND ${conversationHasMessages('load')})<o.capacity ${groupId?'AND EXISTS(SELECT 1 FROM ticket_group_members gm WHERE gm.project_id=o.project_id AND gm.user_id=o.user_id AND gm.group_id=?)':''})`;params.push(selected.user_id,selected.capacity,selected.skills_json,selected.updated_at,...(groupId?[groupId]:[]))}
  try{const authority=await workflowMemberGuard(env,projectId,winner.owner_id),references=await validateRuleReferences(env,projectId,d,winner.owner_id);guard+=` AND (${authority.guard.sql}) AND (${references.sql})`;params.push(...authority.guard.params,...references.params)}catch{return {state:'skipped',explanation:'The routing publisher or referenced configuration is no longer authorized; the responsible queue is retained'}}
  if(outerGuard){guard+=` AND (${outerGuard.sql})`;params.push(...outerGuard.params)}
  const now=workflowNow(env),result=await applyWorkflowActions(env,{projectId,conversationId:ticketId,id,source:'rule',actorId:`routing ${d.name}`,noteAuthorId:winner.owner_id,expectedVersion:ticket.ticket_version,expectedRevision:ticket.revision,expectedLastMessageId:ticket.last_message_id,actions:[{type:'assign',user_id:selected?.user_id??null,group_id:groupId}],guard:{sql:guard,params},after:(accepted,args)=>[
   env.DB.prepare(`INSERT INTO routing_decisions(id,project_id,conversation_id,event_id,rule_id,rule_name,version,strategy,winner_id,group_id,overflow,explanation,candidates_json,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${accepted}`).bind(id,projectId,ticketId,event,winner.id,d.name,winner.published_version,routing.strategy,selected?.user_id??null,groupId,overflow?1:0,explanation,JSON.stringify(candidates.map(c=>({user_id:c.user_id,workload:c.workload,capacity:c.capacity}))),now,...args),
   env.DB.prepare(`UPDATE routing_state SET revision=revision+1,last_user_id=? WHERE project_id=? AND rule_id=? AND ${accepted}`).bind(selected?.user_id??state.last_user_id,projectId,winner.id,...args),
   ...(onCommit?.(accepted,args)??[])
  ]})
  if(result.state==='complete'){const decision=await env.DB.prepare('SELECT * FROM routing_decisions WHERE id=?').bind(id).first<any>();return {state:'complete',decision:decisionData(decision)}}
 }
 return {state:'pending',explanation:'Routing commit was refused by the current ticket, rule or operator guard'}
 })
}
export function decisionData(row:any){if(!row)return null;const {candidates_json,...rest}=row;return {...rest,overflow:!!row.overflow,candidates:JSON.parse(candidates_json)}}
