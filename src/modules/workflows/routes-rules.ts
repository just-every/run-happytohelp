import {ticketScopeSql} from '../access/ticket-scope'
import {Hono,type Context} from 'hono'
import {emptyCommand} from './command-body'
import {HTTPException} from 'hono/http-exception'
import type {Actor,AppEnv} from '../../platform/env'
import {scope} from '../management/common'
import {memberAccess} from '../access/gate'
import {checkedRule,ruleData,ruleSelect} from './rule-model'
import {validateRuleReferences} from './rule-validation'
import {previewRule} from './rule-preview'
import {workflowTemplates} from './rule-time'
import {workflowNow} from './clock'
import {commitWorkflowSettings,andWorkflowGuards} from './rule-admin'
import {definitionVisible,workflowVisibleFields} from './rule-access'
import {availableTicketSql,fieldAllowed,object,named} from '../tickets/model'
export const workflowRuleRoutes=new Hono<AppEnv>()
const base='/projects/:projectId/workflow-rules'
export async function workflowScope(c:Context<AppEnv>,write=false){const actor=await scope(c,write),access=await memberAccess(c.env.DB,actor.projectId,actor.id);if(!access?.permissions.has(write?'settings.manage':'conversations.manage'))throw new HTTPException(403,{message:'Your current role cannot access workflow settings'});return actor as Actor}
async function getRule(c:Context<AppEnv>,projectId:string){
 const row=await c.env.DB.prepare(`${ruleSelect} WHERE r.project_id=? AND r.id=?`).bind(projectId,c.req.param('id')).first<any>();if(!row)throw new HTTPException(404)
 const actor=await scope(c),visible=await workflowVisibleFields(c.env,projectId,actor.id)
 if(!definitionVisible(JSON.parse(row.draft_json),visible.fields,visible.access)||row.definition_json&&!definitionVisible(JSON.parse(row.definition_json),visible.fields,visible.access))throw new HTTPException(403,{message:'Your role cannot inspect fields used by this workflow'})
 return row
}
workflowRuleRoutes.get(base,async c=>{
 const actor=await workflowScope(c),[rules,history,visible]=await Promise.all([
  c.env.DB.prepare(`${ruleSelect} WHERE r.project_id=? ORDER BY r.position,r.id`).bind(actor.projectId).all<any>(),
  c.env.DB.prepare('SELECT rule_id,version,definition_json,published_by,published_at,event_after_id FROM workflow_rule_versions WHERE project_id=? ORDER BY version DESC').bind(actor.projectId).all<any>(),
  workflowVisibleFields(c.env,actor.projectId,actor.id)
 ])
 const canSee=(definition:string)=>definitionVisible(JSON.parse(definition),visible.fields,visible.access)
 return c.json({rules:rules.results.filter(row=>canSee(row.draft_json)&&(!row.definition_json||canSee(row.definition_json))).map(row=>({...ruleData(row),versions:history.results.filter(v=>v.rule_id===row.id&&canSee(v.definition_json)).map(({definition_json,...v})=>({...v,definition:JSON.parse(definition_json)}))})),templates:workflowTemplates})
})
workflowRuleRoutes.post(base,async c=>{
 const actor=await workflowScope(c,true),definition=checkedRule(await c.req.json());const references=await validateRuleReferences(c.env,actor.projectId,definition,actor.id)
 const id=crypto.randomUUID(),now=workflowNow(c.env)
 await commitWorkflowSettings(c,actor,'workflow.rule.created',id,(accepted,args)=>[c.env.DB.prepare(`INSERT INTO workflow_rules(id,project_id,name,kind,position,state,draft_json,owner_id,created_at,updated_at) SELECT ?,?,?,?,?,'draft',?,?,?,? WHERE ${accepted}`).bind(id,actor.projectId,definition.name,definition.kind,definition.position,JSON.stringify(definition),actor.id,now,now,...args)],references)
 const row=await c.env.DB.prepare(`${ruleSelect} WHERE r.id=?`).bind(id).first<any>();return c.json({rule:ruleData(row)},201)
})
workflowRuleRoutes.patch(`${base}/:id`,async c=>{
 const actor=await workflowScope(c,true),row=await getRule(c,actor.projectId);if(row.state==='cancelled')throw new HTTPException(409,{message:'A cancelled rule is final; create a new draft'})
 const definition=checkedRule({...JSON.parse(row.draft_json),...await c.req.json()});const references=await validateRuleReferences(c.env,actor.projectId,definition,actor.id)
 await commitWorkflowSettings(c,actor,'workflow.rule.drafted',row.id,(accepted,args)=>[c.env.DB.prepare(`UPDATE workflow_rules SET draft_json=?,updated_at=? WHERE id=? AND project_id=? AND ${accepted}`).bind(JSON.stringify(definition),Math.max(workflowNow(c.env),row.updated_at+1),row.id,actor.projectId,...args)],andWorkflowGuards(references,{sql:'EXISTS(SELECT 1 FROM workflow_rules WHERE id=? AND project_id=? AND updated_at=?)',params:[row.id,actor.projectId,row.updated_at]}))
 return c.json({rule:ruleData(await getRule(c,actor.projectId))})
})
workflowRuleRoutes.post(`${base}/:id/preview`,async c=>{const actor=await workflowScope(c,true),row=await getRule(c,actor.projectId),definition=checkedRule(JSON.parse(row.draft_json));await validateRuleReferences(c.env,actor.projectId,definition,actor.id);await emptyCommand(c);return c.json(await previewRule(c.env,actor.projectId,definition))})
workflowRuleRoutes.post(`${base}/:id/publish`,async c=>{
 const actor=await workflowScope(c,true),row=await getRule(c,actor.projectId);if(row.state==='cancelled')throw new HTTPException(409,{message:'A cancelled rule cannot be published'})
 await emptyCommand(c)
 const definition=checkedRule(JSON.parse(row.draft_json));const references=await validateRuleReferences(c.env,actor.projectId,definition,actor.id)
 const version=row.published_version+1,now=Math.max(workflowNow(c.env),row.updated_at+1),serialized=JSON.stringify(definition)
 await commitWorkflowSettings(c,actor,'workflow.rule.published',row.id,(accepted,args)=>[
  c.env.DB.prepare(`INSERT INTO workflow_rule_versions(rule_id,project_id,version,definition_json,published_by,published_at,event_after_id) SELECT ?,?,?,?,?,?,coalesce((SELECT max(id) FROM workflow_events),0) WHERE ${accepted}`).bind(row.id,actor.projectId,version,serialized,actor.id,now,...args),
  c.env.DB.prepare(`UPDATE workflow_rules SET name=?,kind=?,position=?,state='published',published_version=?,updated_at=?,owner_id=? WHERE id=? AND project_id=? AND ${accepted}`).bind(definition.name,definition.kind,definition.position,version,now,actor.id,row.id,actor.projectId,...args),
  c.env.DB.prepare(`DELETE FROM workflow_scheduler_cursors WHERE rule_id=? AND ${accepted}`).bind(row.id,...args),
  c.env.DB.prepare(`UPDATE workflow_runs SET state='cancelled',reason='Superseded by a newer published version',next_attempt_at=NULL,updated_at=? WHERE rule_id=? AND version<>? AND state IN ('running','pending') AND ${accepted}`).bind(now,row.id,version,...args),
  c.env.DB.prepare(`UPDATE workflow_notifications SET state='cancelled',detail='Workflow version superseded',updated_at=? WHERE state='pending' AND EXISTS(SELECT 1 FROM workflow_runs r WHERE r.rule_id=? AND r.version<>? AND substr(workflow_notifications.id,1,length(r.id)+8)=r.id||':action:') AND ${accepted}`).bind(now,row.id,version,...args)
 ],andWorkflowGuards(references,{sql:"EXISTS(SELECT 1 FROM workflow_rules WHERE id=? AND project_id=? AND updated_at=? AND published_version=? AND state<>'cancelled')",params:[row.id,actor.projectId,row.updated_at,row.published_version]}))
 return c.json({rule:ruleData(await getRule(c,actor.projectId))})
})
for(const state of ['pause','cancel'] as const)workflowRuleRoutes.post(`${base}/:id/${state}`,async c=>{
 const actor=await workflowScope(c,true),row=await getRule(c,actor.projectId);if(row.state==='cancelled'&&state==='pause')throw new HTTPException(409)
 await emptyCommand(c)
 const now=Math.max(workflowNow(c.env),row.updated_at+1)
 await commitWorkflowSettings(c,actor,`workflow.rule.${state}`,row.id,(accepted,args)=>[
  c.env.DB.prepare(`UPDATE workflow_rules SET state=?,updated_at=? WHERE id=? AND project_id=? AND ${accepted}`).bind(state==='pause'?'paused':'cancelled',now,row.id,actor.projectId,...args),
  c.env.DB.prepare(`UPDATE workflow_runs SET state='cancelled',reason=?,next_attempt_at=NULL,updated_at=? WHERE rule_id=? AND state IN ('running','pending') AND ${accepted}`).bind(`Rule ${state==='pause'?'paused':'cancelled'} before the next side effect`,now,row.id,...args),
  c.env.DB.prepare(`UPDATE workflow_notifications SET state='cancelled',detail=?,updated_at=? WHERE state='pending' AND EXISTS(SELECT 1 FROM workflow_runs r WHERE r.rule_id=? AND substr(workflow_notifications.id,1,length(r.id)+8)=r.id||':action:') AND ${accepted}`).bind(`Rule ${state==='pause'?'paused':'cancelled'}`,now,row.id,...args)
 ],{sql:'EXISTS(SELECT 1 FROM workflow_rules WHERE id=? AND project_id=? AND updated_at=?)',params:[row.id,actor.projectId,row.updated_at]})
 return c.json({rule:ruleData(await getRule(c,actor.projectId))})
})
workflowRuleRoutes.get('/projects/:projectId/workflow-runs',async c=>{
 const actor=await workflowScope(c),limit=Math.min(500,Math.max(1,Number(c.req.query('limit'))||200)),conversation=c.req.query('conversation_id'),[rows,visible]=await Promise.all([
  c.env.DB.prepare(`SELECT r.*,v.definition_json FROM workflow_runs r LEFT JOIN workflow_rule_versions v ON v.rule_id=r.rule_id AND v.version=r.version JOIN conversations c ON c.id=r.conversation_id AND c.project_id=r.project_id WHERE r.project_id=? AND ${availableTicketSql()} AND ${ticketScopeSql('?')} ${conversation?'AND r.conversation_id=?':''} ORDER BY r.created_at DESC,r.id DESC LIMIT ?`).bind(actor.projectId,actor.id,...(conversation?[conversation]:[]),limit).all<any>(),
  workflowVisibleFields(c.env,actor.projectId,actor.id)
 ])
 const allowed=new Set(visible.fields.filter(f=>fieldAllowed(f,visible.access)).map(f=>f.id))
 return c.json({runs:rows.results.filter(row=>!row.definition_json||definitionVisible(JSON.parse(row.definition_json),visible.fields,visible.access)).map(({actions_json,frontier_json,definition_json,lease_token,lease_until,...row})=>({...row,...(!definition_json?{explanation:{reason:'The immutable workflow version is missing'}}:{}),actions:(definition_json?JSON.parse(actions_json):[]).map((a:any)=>a.type==='fields'?{...a,values:Object.fromEntries(Object.entries(a.values).filter(([id])=>allowed.has(id)))}:a),frontier:JSON.parse(frontier_json)}))})
})

// A human can close reviewed work, but cannot turn an unknown provider result
// into success or resume the remaining actions on a run that crossed a send.
workflowRuleRoutes.post('/projects/:projectId/workflow-runs/:runId/reconcile',async c=>{
 const actor=await workflowScope(c,true),body=object(await c.req.json()),note=named(body.note,2000),reference=named(body.reference,500)
 if(!Number.isSafeInteger(body.expected_updated_at))throw new HTTPException(400,{message:'Provide the last inspected run timestamp'})
 const run=await c.env.DB.prepare(`SELECT r.*,v.definition_json FROM workflow_runs r JOIN conversations c ON c.project_id=r.project_id AND c.id=r.conversation_id LEFT JOIN workflow_rule_versions v ON v.rule_id=r.rule_id AND v.version=r.version WHERE r.id=? AND r.project_id=? AND ${availableTicketSql()} AND ${ticketScopeSql('?')}`).bind(c.req.param('runId'),actor.projectId,actor.id).first<any>()
 if(!run)throw new HTTPException(404)
 const visible=await workflowVisibleFields(c.env,actor.projectId,actor.id)
 if(run.definition_json&&!definitionVisible(JSON.parse(run.definition_json),visible.fields,visible.access))throw new HTTPException(403,{message:'Your role cannot inspect fields used by this workflow'})
 if(!['uncertain','failed','not_delivered'].includes(run.state)||run.updated_at!==body.expected_updated_at)throw new HTTPException(409,{message:'Inspect the current terminal run before reconciling it'})
 const at=Math.max(workflowNow(c.env),run.updated_at+1),detail={run_id:run.id,previous_state:run.state,cursor:run.cursor,note,reference,disposition:'remaining_actions_cancelled',provider_outcome:'unchanged'}
 await commitWorkflowSettings(c,actor,'workflow.run.reconciled',run.id,(accepted,args)=>[
  c.env.DB.prepare(`UPDATE workflow_runs SET state='cancelled',reason='Manually reviewed; remaining actions cancelled. Existing delivery outcomes are unchanged.',next_attempt_at=NULL,updated_at=? WHERE id=? AND project_id=? AND ${accepted}`).bind(at,run.id,actor.projectId,...args),
 ],{sql:`EXISTS(SELECT 1 FROM workflow_runs r JOIN conversations c ON c.project_id=r.project_id AND c.id=r.conversation_id WHERE r.id=? AND r.project_id=? AND r.state=? AND r.updated_at=? AND ${availableTicketSql()} AND ${ticketScopeSql('?')})`,params:[run.id,actor.projectId,run.state,run.updated_at,actor.id]},detail)
 return c.json({run_id:run.id,state:'cancelled',provider_outcome:'unchanged',updated_at:at})
})
