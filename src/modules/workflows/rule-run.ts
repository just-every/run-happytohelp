import type {Env} from '../../platform/env'
import {applyWorkflowActions,type WorkflowGuard} from './actions'
import type {WorkflowAction} from './actions-validation'
import {notifyWorkflow} from './notify'
import {routeTicket} from './routing'
import {ruleTicket,type RuleDefinition} from './rule-model'
import {workflowNow} from './clock'
import {workflowMemberGuard} from './rule-access'
import {validateRuleReferences} from './rule-validation'
import {boundedDatabase} from '../../platform/d1-budget'
import type {Spent} from './budget'
/** A run that cannot finish yet waits 1, 5, 15 and 60 minutes between attempts, then
 * ends visibly. An interrupted run counts as an attempt too, so nothing retries forever. */
export const RUN_ATTEMPTS=5
const backoffMinutes=[1,5,15,60]
export function activeRuleGuard(row:any):WorkflowGuard{return {sql:"EXISTS(SELECT 1 FROM workflow_rules WHERE id=? AND project_id=? AND state='published' AND published_version=?)",params:[row.rule_id??row.id,row.project_id,row.version??row.published_version]}}
const quantumLimit=80
const budgetError=(error:unknown)=>error instanceof Error&&error.message==='WORKER_D1_STATEMENT_LIMIT'
export async function executeRuleRun(env:Env,runId:string,spent?:Spent){
 const budget=spent?boundedDatabase(env.DB,quantumLimit,5):null
 if(budget)env={...env,DB:budget.database}
 let run=await env.DB.prepare('SELECT r.*,v.definition_json,w.owner_id FROM workflow_runs r LEFT JOIN workflow_rule_versions v ON v.rule_id=r.rule_id AND v.version=r.version LEFT JOIN workflow_rules w ON w.id=r.rule_id WHERE r.id=?').bind(runId).first<any>()
 if(!run||!['running','pending'].includes(run.state)||Number(run.next_attempt_at??0)>workflowNow(env)||spent?.())return run
 const lease=crypto.randomUUID(),leaseNow=workflowNow(env),claimed=await env.DB.prepare("UPDATE workflow_runs SET lease_token=?,lease_until=?,attempts=attempts+1,next_attempt_at=NULL WHERE id=? AND state IN ('running','pending') AND coalesce(next_attempt_at,0)<=? AND (lease_token IS NULL OR lease_until<=?)").bind(lease,leaseNow+120000,runId,leaseNow,leaseNow).run()
 if(!claimed.meta.changes)return run
 const attempt=run.attempts+1,startingCursor=run.cursor
 let continued=false
 const setState=async(state:string,reason:string,retryAt:number|null=null)=>{await env.DB.prepare("UPDATE workflow_runs SET state=?,reason=?,next_attempt_at=?,updated_at=? WHERE id=? AND lease_token=? AND state IN ('running','pending')").bind(state,reason,retryAt,workflowNow(env),runId,lease).run()}
 const defer=async(terminal:'not_delivered'|'failed',reason:string)=>attempt>=RUN_ATTEMPTS?setState(terminal,`${reason}. Stopped after ${attempt} attempts.`):setState('pending',reason,workflowNow(env)+backoffMinutes[attempt-1]*60000)
 const continueRun=async(reason:string)=>{if(continued)return;await env.DB.prepare("UPDATE workflow_runs SET state='running',attempts=max(0,attempts-1),next_attempt_at=NULL,reason=?,updated_at=? WHERE id=? AND lease_token=? AND state IN ('running','pending')").bind(reason,workflowNow(env),runId,lease).run();continued=true}
 try{
 if(spent)await env.DB.prepare("INSERT INTO workflow_queue_turns(queue,project_id,turn) SELECT 'rule-runs',?,coalesce(max(turn),0)+1 FROM workflow_queue_turns WHERE queue='rule-runs' ON CONFLICT(queue,project_id) DO UPDATE SET turn=excluded.turn").bind(run.project_id).run()
 if(attempt>RUN_ATTEMPTS){await setState('failed',`Stopped after ${RUN_ATTEMPTS} interrupted attempts`);return await env.DB.prepare('SELECT * FROM workflow_runs WHERE id=?').bind(runId).first<any>()}
 const definition=run.definition_json?{definition_json:run.definition_json}:null
 if(!definition){await setState('failed','The immutable workflow version is missing; no action was executed');return await env.DB.prepare('SELECT * FROM workflow_runs WHERE id=?').bind(runId).first<any>()}
 const d=JSON.parse(definition.definition_json) as RuleDefinition,rule=activeRuleGuard(run),actions=JSON.parse(run.actions_json) as WorkflowAction[]
 const owner={owner_id:run.owner_id as string}
 try{
  const systemDefault=owner?.owner_id==='system'&&run.rule_id===`workflow:auto-close:${run.project_id}`
  if(!systemDefault){const authority=await workflowMemberGuard(env,run.project_id,owner?.owner_id??''),references=await validateRuleReferences(env,run.project_id,d,owner!.owner_id);rule.sql+=` AND (${authority.guard.sql}) AND (${references.sql})`;rule.params.push(...authority.guard.params,...references.params)}
 }catch(error){if(budgetError(error))throw error;await setState('cancelled','Workflow owner or referenced configuration is no longer authorized');return await env.DB.prepare('SELECT * FROM workflow_runs WHERE id=?').bind(runId).first<any>()}
 run.lease_token=lease
 for(let i=run.cursor;i<actions.length;i++){
  if(i>startingCursor)run=await env.DB.prepare('SELECT * FROM workflow_runs WHERE id=?').bind(runId).first<any>();if(!run||!['running','pending'].includes(run.state)||run.lease_token!==lease)break;if(run.cursor>i)continue
  const frontier=JSON.parse(run.frontier_json),action=actions[i]
  const ticket=action.type==='route'?await ruleTicket(env,run.project_id,run.conversation_id):frontier
  if(!ticket||ticket.ticket_version!==frontier.ticket_version||ticket.revision!==frontier.revision||ticket.last_message_id!==frontier.last_message_id){await setState('cancelled','Ticket changed after the run was planned; stale actions were cancelled');break}
  const actionId=`${runId}:action:${i}`,guard:WorkflowGuard={sql:`${rule.sql} AND c.ticket_version=? AND c.revision=? AND c.last_message_id IS ? AND EXISTS(SELECT 1 FROM workflow_runs WHERE id=? AND lease_token=? AND state IN ('running','pending') AND cursor=?)`,params:[...rule.params,frontier.ticket_version,frontier.revision,frontier.last_message_id,runId,lease,i]}
   if(action.type==='notify'){
    const result=await notifyWorkflow(env,{projectId:run.project_id,conversationId:run.conversation_id,id:actionId,kind:action.kind,recipientId:action.recipient_id,message:action.message,guard})
    if(result.state==='pending'){if(attempt>=RUN_ATTEMPTS)await env.DB.prepare("UPDATE workflow_notifications SET state='not_delivered',detail=?,updated_at=? WHERE id=? AND state='pending'").bind(`${result.detail??'Notification delivery is waiting'}. Stopped after ${RUN_ATTEMPTS} attempts.`,workflowNow(env),actionId).run();await defer('not_delivered',result.detail??'Notification delivery is waiting');break}
    if(result.state!=='complete'){await setState(result.state,result.detail??`Notification ${result.state.replace('_',' ')}`);break}
    await env.DB.prepare("UPDATE workflow_runs SET cursor=max(cursor,?),state='running',updated_at=? WHERE id=? AND cursor=? AND state IN ('running','pending') AND lease_token=?").bind(i+1,workflowNow(env),runId,i,lease).run()
   }else if(action.type==='route'){
    const result=await routeTicket(env,run.conversation_id,actionId,guard,(accepted,args)=>[
     env.DB.prepare(`UPDATE workflow_runs SET cursor=max(cursor,?),frontier_json=(SELECT json_object('ticket_version',ticket_version,'revision',revision,'last_message_id',last_message_id) FROM conversations WHERE id=?),state='running',updated_at=? WHERE id=? AND cursor=? AND ${accepted}`).bind(i+1,run.conversation_id,workflowNow(env),runId,i,...args)
    ])
    if(result.state==='pending'){await defer('failed','The assignment kept losing to concurrent routing changes');break}
    if(result.state==='not_found'){await setState('cancelled','The ticket is no longer available');break}
    if(result.state==='skipped')await env.DB.prepare("UPDATE workflow_runs SET cursor=max(cursor,?),updated_at=? WHERE id=? AND cursor=? AND lease_token=? AND state IN ('running','pending')").bind(i+1,workflowNow(env),runId,i,lease).run()
   }else{
    const result=await applyWorkflowActions(env,{projectId:run.project_id,conversationId:run.conversation_id,id:actionId,source:d.kind==='time'?'automation':'rule',actorId:`${d.kind==='time'?'automation':'rule'} ${d.name}`,noteAuthorId:owner?.owner_id,expectedVersion:frontier.ticket_version,expectedRevision:frontier.revision,expectedLastMessageId:frontier.last_message_id,actions:[action],guard,after:(accepted,args)=>[
     env.DB.prepare(`UPDATE workflow_runs SET cursor=max(cursor,?),frontier_json=(SELECT json_object('ticket_version',ticket_version,'revision',revision,'last_message_id',last_message_id) FROM conversations WHERE id=?),state='running',updated_at=? WHERE id=? AND cursor=? AND ${accepted}`).bind(i+1,run.conversation_id,workflowNow(env),runId,i,...args)
    ]})
    if(result.state!=='complete'){await setState('cancelled','Ticket, authority or configuration changed before action commit');break}
   }
  if(spent&&i+1<actions.length){await continueRun('Action committed; remaining actions continue in the next workflow execution quantum');break}
 }
 const completed=await env.DB.prepare("UPDATE workflow_runs SET state='complete',reason=NULL,updated_at=? WHERE id=? AND lease_token=? AND cursor>=json_array_length(actions_json) AND state IN ('running','pending') RETURNING *").bind(workflowNow(env),runId,lease).first<any>()
 return completed??await env.DB.prepare('SELECT * FROM workflow_runs WHERE id=?').bind(runId).first<any>()
 }catch(error){
  if(budgetError(error)){
   const saved=await env.DB.prepare('SELECT cursor FROM workflow_runs WHERE id=?').bind(runId).first<{cursor:number}>()
   if(saved&&saved.cursor>startingCursor)await continueRun('Action committed; statement budget exhausted before continuation')
   else await setState('failed',`A workflow action or its authorization exceeds the ${quantumLimit}-statement execution quantum; no automatic retry`)
  }else await defer('failed',error instanceof Error?error.message.slice(0,1000):'Action failed before completion')
  return await env.DB.prepare('SELECT * FROM workflow_runs WHERE id=?').bind(runId).first<any>()
 }finally{await env.DB.prepare('UPDATE workflow_runs SET lease_token=NULL,lease_until=NULL WHERE id=? AND lease_token=?').bind(runId,lease).run()}
}
export async function planRuleRun(env:Env,row:any,ticket:any,eventId:string,explanation:unknown,spent?:Spent){
 const d=JSON.parse(row.definition_json) as RuleDefinition,id=`workflow:${row.id}:${row.published_version}:${ticket.id}:${eventId}`,now=workflowNow(env)
 await env.DB.prepare("INSERT OR IGNORE INTO workflow_runs(id,project_id,conversation_id,rule_id,version,event_id,rule_name,state,explanation,actions_json,frontier_json,created_at,updated_at) SELECT ?,?,?,?,?,?,?,'running',?,?,?,?,? WHERE EXISTS(SELECT 1 FROM workflow_rules WHERE id=? AND state='published' AND published_version=?)").bind(id,row.project_id,ticket.id,row.id,row.published_version,eventId,d.name,JSON.stringify(explanation),JSON.stringify(d.actions),JSON.stringify({ticket_version:ticket.ticket_version,revision:ticket.revision,last_message_id:ticket.last_message_id}),now,now,row.id,row.published_version).run()
 return executeRuleRun(env,id,spent)
}
