import type {Env} from '../../platform/env'
import {applyWorkflowActions,type WorkflowGuard} from './actions'
import type {WorkflowAction} from './actions-validation'
import {notifyWorkflow} from './notify'
import {routeTicket} from './routing'
import {ruleTicket,type RuleDefinition} from './rule-model'
import {workflowNow} from './clock'
import {workflowMemberGuard} from './rule-access'
import {validateRuleReferences} from './rule-validation'
export function activeRuleGuard(row:any):WorkflowGuard{return {sql:"EXISTS(SELECT 1 FROM workflow_rules WHERE id=? AND project_id=? AND state='published' AND published_version=?)",params:[row.rule_id??row.id,row.project_id,row.version??row.published_version]}}
export async function executeRuleRun(env:Env,runId:string){
 let run=await env.DB.prepare('SELECT * FROM workflow_runs WHERE id=?').bind(runId).first<any>()
 if(!run||!['running','pending'].includes(run.state))return run
 const lease=crypto.randomUUID(),leaseNow=workflowNow(env),claimed=await env.DB.prepare("UPDATE workflow_runs SET lease_token=?,lease_until=? WHERE id=? AND state IN ('running','pending') AND (lease_token IS NULL OR lease_until<=?)").bind(lease,leaseNow+120000,runId,leaseNow).run()
 if(!claimed.meta.changes)return run
 try{
 const definition=(await env.DB.prepare('SELECT definition_json FROM workflow_rule_versions WHERE rule_id=? AND version=?').bind(run.rule_id,run.version).first<{definition_json:string}>())
 if(!definition)return null
 const d=JSON.parse(definition.definition_json) as RuleDefinition,rule=activeRuleGuard(run),actions=JSON.parse(run.actions_json) as WorkflowAction[]
 const setState=async(state:string,explanation:string)=>{await env.DB.prepare("UPDATE workflow_runs SET state=?,explanation=CASE WHEN instr(explanation,?)>0 THEN explanation ELSE explanation||char(10)||? END,updated_at=? WHERE id=? AND lease_token=? AND state IN ('running','pending')").bind(state,explanation,explanation,workflowNow(env),runId,lease).run()}
 const owner=await env.DB.prepare('SELECT owner_id FROM workflow_rules WHERE id=?').bind(run.rule_id).first<{owner_id:string}>()
 try{
  const systemDefault=owner?.owner_id==='system'&&run.rule_id===`workflow:auto-close:${run.project_id}`
  if(!systemDefault){const authority=await workflowMemberGuard(env,run.project_id,owner?.owner_id??''),references=await validateRuleReferences(env,run.project_id,d,owner!.owner_id);rule.sql+=` AND (${authority.guard.sql}) AND (${references.sql})`;rule.params.push(...authority.guard.params,...references.params)}
 }catch{await setState('cancelled','Workflow owner or referenced configuration is no longer authorized');return await env.DB.prepare('SELECT * FROM workflow_runs WHERE id=?').bind(runId).first<any>()}
 for(let i=run.cursor;i<actions.length;i++){
  run=await env.DB.prepare('SELECT * FROM workflow_runs WHERE id=?').bind(runId).first<any>();if(!run||!['running','pending'].includes(run.state)||run.lease_token!==lease)break;if(run.cursor>i)continue
  if(!await env.DB.prepare(`SELECT 1 WHERE ${rule.sql}`).bind(...rule.params).first()){await setState('cancelled','Rule paused, cancelled or superseded before the next action');break}
  const ticket=await ruleTicket(env,run.project_id,run.conversation_id),frontier=JSON.parse(run.frontier_json)
  if(!ticket||ticket.ticket_version!==frontier.ticket_version||ticket.revision!==frontier.revision||ticket.last_message_id!==frontier.last_message_id){await setState('cancelled','Ticket changed after the run was planned; stale actions were cancelled');break}
  const action=actions[i],actionId=`${runId}:action:${i}`,guard:WorkflowGuard={sql:`${rule.sql} AND c.ticket_version=? AND c.revision=? AND c.last_message_id IS ? AND EXISTS(SELECT 1 FROM workflow_runs WHERE id=? AND lease_token=? AND state IN ('running','pending') AND cursor=?)`,params:[...rule.params,frontier.ticket_version,frontier.revision,frontier.last_message_id,runId,lease,i]}
  try{
   if(action.type==='notify'){
    const result=await notifyWorkflow(env,{projectId:run.project_id,conversationId:run.conversation_id,id:actionId,kind:action.kind,recipientId:action.recipient_id,message:action.message,guard})
    if(result.state!=='complete'){await setState(result.state==='cancelled'?'cancelled':result.state,result.detail??`Notification ${result.state}`);break}
    await env.DB.prepare("UPDATE workflow_runs SET cursor=max(cursor,?),state='running',updated_at=? WHERE id=? AND cursor=? AND state IN ('running','pending') AND lease_token=?").bind(i+1,workflowNow(env),runId,i,lease).run()
   }else if(action.type==='route'){
    const result=await routeTicket(env,run.conversation_id,actionId,guard,(accepted,args)=>[
     env.DB.prepare(`UPDATE workflow_runs SET cursor=max(cursor,?),frontier_json=(SELECT json_object('ticket_version',ticket_version,'revision',revision,'last_message_id',last_message_id) FROM conversations WHERE id=?),state='running',updated_at=? WHERE id=? AND cursor=? AND ${accepted}`).bind(i+1,run.conversation_id,workflowNow(env),runId,i,...args)
    ])
    if(result.state==='pending'){await setState('pending',result.explanation??'Routing is contended');break}
    if(result.state==='skipped')await env.DB.prepare('UPDATE workflow_runs SET cursor=max(cursor,?),updated_at=? WHERE id=? AND cursor=?').bind(i+1,workflowNow(env),runId,i).run()
   }else{
    const result=await applyWorkflowActions(env,{projectId:run.project_id,conversationId:run.conversation_id,id:actionId,source:d.kind==='time'?'automation':'rule',actorId:`${d.kind==='time'?'automation':'rule'} ${d.name}`,noteAuthorId:owner?.owner_id,expectedVersion:frontier.ticket_version,expectedRevision:frontier.revision,expectedLastMessageId:frontier.last_message_id,actions:[action],guard,after:(accepted,args)=>[
     env.DB.prepare(`UPDATE workflow_runs SET cursor=max(cursor,?),frontier_json=(SELECT json_object('ticket_version',ticket_version,'revision',revision,'last_message_id',last_message_id) FROM conversations WHERE id=?),state='running',updated_at=? WHERE id=? AND cursor=? AND ${accepted}`).bind(i+1,run.conversation_id,workflowNow(env),runId,i,...args)
    ]})
    if(result.state!=='complete'){await setState('cancelled','Ticket, authority or configuration changed before action commit');break}
   }
  }catch(error){await setState('failed',error instanceof Error?error.message.slice(0,1000):'Action failed before completion');break}
 }
 await env.DB.prepare("UPDATE workflow_runs SET state='complete',updated_at=? WHERE id=? AND cursor>=json_array_length(actions_json) AND state IN ('running','pending')").bind(workflowNow(env),runId).run()
 return await env.DB.prepare('SELECT * FROM workflow_runs WHERE id=?').bind(runId).first<any>()
 }finally{await env.DB.prepare('UPDATE workflow_runs SET lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?').bind(runId,lease).run()}
}
export async function planRuleRun(env:Env,row:any,ticket:any,eventId:string,explanation:unknown){
 const d=JSON.parse(row.definition_json) as RuleDefinition,id=`workflow:${row.id}:${row.published_version}:${ticket.id}:${eventId}`,now=workflowNow(env)
 await env.DB.prepare("INSERT OR IGNORE INTO workflow_runs(id,project_id,conversation_id,rule_id,version,event_id,rule_name,state,explanation,actions_json,frontier_json,created_at,updated_at) SELECT ?,?,?,?,?,?,?,'running',?,?,?,?,? WHERE EXISTS(SELECT 1 FROM workflow_rules WHERE id=? AND state='published' AND published_version=?)").bind(id,row.project_id,ticket.id,row.id,row.published_version,eventId,d.name,JSON.stringify(explanation),JSON.stringify(d.actions),JSON.stringify({ticket_version:ticket.ticket_version,revision:ticket.revision,last_message_id:ticket.last_message_id}),now,now,row.id,row.published_version).run()
 return executeRuleRun(env,id)
}
