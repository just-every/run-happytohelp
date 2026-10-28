import {ticketScopeSql} from '../access/ticket-scope'
import {Hono} from 'hono'
import {emptyCommand} from './command-body'
import {HTTPException} from 'hono/http-exception'
import type {Actor,AppEnv} from '../../platform/env'
import {scope} from '../management/common'
import {dashboardAccess} from '../management/dashboard'
import {ticketAuthority,ticketReadAccess,object,invalid,availableTicketSql} from '../tickets/model'
import {workflowNow} from './clock'
import {calendarData,calendarDefinition} from './calendars'
import {policyData,policyDefinition} from './sla-policy'
import {validateFieldValue} from '../tickets/fields'
import {publicField} from '../forms/definition'
import {ticketSla,liveSlaTicketSql} from './sla'

export const workflowSlaRoutes=new Hono<AppEnv>()
const prefix='/projects/:projectId'
for(const kind of ['workflow-calendars','sla-policies'] as const){
 const calendar=kind==='workflow-calendars',table=calendar?'workflow_calendars':'sla_policies',decode=calendar?calendarData:policyData,path=`${prefix}/${kind}`
 workflowSlaRoutes.get(path,async c=>{
  const actor=await scope(c) as Actor
  await ticketReadAccess(c.env,actor)
  const rows=await c.env.DB.prepare(`SELECT * FROM ${table} WHERE project_id=? ORDER BY ${calendar?'name,id':'position,id'}`).bind(actor.projectId).all<any>()
  return c.json({data:rows.results.map(row=>decode(row))})
 })
 for(const method of ['post','patch'] as const)workflowSlaRoutes[method](method==='post'?path:`${path}/:id`,async c=>{
  const actor=await scope(c,true) as Actor,guard=await ticketAuthority(c.env,actor,{sessionHash:c.get('sessionHash'),source:'dashboard'},'settings.manage'),id=method==='post'?crypto.randomUUID():c.req.param('id')!
  const existing=method==='post'?null:await c.env.DB.prepare(`SELECT * FROM ${table} WHERE project_id=? AND id=?`).bind(actor.projectId,id).first<any>()
  if(method==='patch'&&!existing)throw new HTTPException(404)
  const body=object(await c.req.json())
  if(existing&&body.expected_updated_at!==undefined&&body.expected_updated_at!==existing.updated_at)throw new HTTPException(409,{message:'Settings changed. Reload before applying changes.'})
  const input={...(existing?decode(existing):{}),...body},definition=calendar?calendarDefinition(input):policyDefinition(input,actor.projectId)
  const extra:string[]=[],args:any[]=[]
  if(existing){extra.push(`EXISTS(SELECT 1 FROM ${table} WHERE project_id=? AND id=? AND updated_at=?)`);args.push(actor.projectId,id,existing.updated_at)}
  if(!calendar){
   const policy=definition as ReturnType<typeof policyDefinition>
   if(policy.slack_destination_id!==(existing?.slack_destination_id??null)&&!['owner','admin'].includes(actor.role))throw new HTTPException(403,{message:'Only an owner or admin can change Slack escalation consent'})
   if(policy.slack_destination_id){
    const destination="SELECT 1 FROM native_integration_destinations WHERE project_id=? AND id=? AND kind='slack' AND enabled=1"
    if(!await c.env.DB.prepare(destination).bind(actor.projectId,policy.slack_destination_id).first())invalid('Choose an enabled workspace Slack destination')
    extra.push(`EXISTS(${destination})`);args.push(actor.projectId,policy.slack_destination_id)
   }
   const conditions=JSON.parse(policy.conditions_json),fieldIds=Object.keys(conditions.fields??{})
   if(fieldIds.length){
    const fields=(await c.env.DB.prepare('SELECT * FROM ticket_fields WHERE project_id=? AND id IN (SELECT value FROM json_each(?))').bind(actor.projectId,JSON.stringify(fieldIds)).all<any>()).results
    if(fields.length!==fieldIds.length||fields.some(f=>!publicField(f)))invalid('SLA conditions require customer-visible workspace fields')
    for(const field of fields){if(validateFieldValue(field,conditions.fields[field.id])===null)invalid('SLA field conditions require a typed value')}
    extra.push("NOT EXISTS(SELECT 1 FROM json_each(?) ref WHERE NOT EXISTS(SELECT 1 FROM ticket_fields f WHERE f.project_id=? AND f.id=json_extract(ref.value,'$[0]') AND f.updated_at=json_extract(ref.value,'$[1]')))");args.push(JSON.stringify(fields.map(f=>[f.id,f.updated_at])),actor.projectId)
   }
   const formIds=conditions.form_ids??[]
   if(formIds.length){
    const found=await c.env.DB.prepare('SELECT count(*) n FROM request_forms WHERE project_id=? AND id IN (SELECT value FROM json_each(?))').bind(actor.projectId,JSON.stringify(formIds)).first<{n:number}>()
    if(found?.n!==formIds.length)invalid('Choose workspace request forms')
    extra.push('NOT EXISTS(SELECT 1 FROM json_each(?) ref WHERE NOT EXISTS(SELECT 1 FROM request_forms f WHERE f.project_id=? AND f.id=ref.value))');args.push(JSON.stringify(formIds),actor.projectId)
   }
   const schedule=await c.env.DB.prepare('SELECT active,updated_at FROM workflow_calendars WHERE project_id=? AND id=?').bind(actor.projectId,policy.calendar_id).first<any>()
   if(!schedule)invalid('Choose a workspace business calendar')
   if(policy.active&&!schedule.active)invalid('An active SLA policy needs an active calendar')
   extra.push('EXISTS(SELECT 1 FROM workflow_calendars WHERE project_id=? AND id=? AND updated_at=?)');args.push(actor.projectId,policy.calendar_id,schedule.updated_at)
   for(const user of JSON.parse(policy.backup_user_ids_json)){
    if(!await c.env.DB.prepare('SELECT 1 FROM memberships WHERE project_id=? AND user_id=?').bind(actor.projectId,user).first())invalid('Every backup must belong to the workspace')
    extra.push('EXISTS(SELECT 1 FROM memberships WHERE project_id=? AND user_id=?)');args.push(actor.projectId,user)
   }
  }
  const now=Math.max(workflowNow(c.env),(existing?.updated_at??0)+1),receipt=crypto.randomUUID(),accepted='EXISTS(SELECT 1 FROM audit_events WHERE id=?)',columns=Object.keys(definition),values=Object.values(definition)
  const results=await c.env.DB.batch([
   c.env.DB.prepare(`INSERT INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,detail_json) SELECT ?,?,?,'data',?,'succeeded','user',?,'dashboard',?,?,? WHERE EXISTS(${guard.sql}) ${extra.map(predicate=>'AND '+predicate).join(' ')}`).bind(receipt,actor.projectId,now,`${kind}.${method}`,actor.id,table,id,JSON.stringify(calendar?{}:{slack_destination_id:(definition as ReturnType<typeof policyDefinition>).slack_destination_id}),...guard.params,...args),
   method==='post'?c.env.DB.prepare(`INSERT INTO ${table}(project_id,id,${columns.join(',')},updated_at) SELECT ?,?,${columns.map(()=>'?').join(',')},? WHERE ${accepted}`).bind(actor.projectId,id,...values,now,receipt):c.env.DB.prepare(`UPDATE ${table} SET ${columns.map(column=>`${column}=?`).join(',')},updated_at=? WHERE project_id=? AND id=? AND ${accepted}`).bind(...values,now,actor.projectId,id,receipt)
  ])
  if(!results[0].meta.changes)throw new HTTPException(409,{message:'Settings or authority changed. Reload before applying changes.'})
  return c.json({data:decode(await c.env.DB.prepare(`SELECT * FROM ${table} WHERE project_id=? AND id=?`).bind(actor.projectId,id).first<any>())},method==='post'?201:200)
 })
}
workflowSlaRoutes.get(`${prefix}/sla-alerts`,async c=>{
 const actor=await scope(c) as Actor
 await ticketReadAccess(c.env,actor)
 const alerts=await c.env.DB.prepare(`SELECT a.* FROM sla_alerts a JOIN conversations c ON c.project_id=a.project_id AND c.id=a.conversation_id WHERE a.project_id=? AND ${liveSlaTicketSql()} AND ${ticketScopeSql('?')} ORDER BY a.created_at DESC,a.id`).bind(actor.projectId,actor.id).all<any>()
 return c.json({data:alerts.results})
})
workflowSlaRoutes.patch(`${prefix}/sla-alerts/:id/ack`,async c=>{
 const actor=await scope(c) as Actor,id=c.req.param('id'),now=workflowNow(c.env),receipt=crypto.randomUUID()
 await emptyCommand(c)
 const alert=await c.env.DB.prepare(`SELECT a.* FROM sla_alerts a JOIN conversations c ON c.project_id=a.project_id AND c.id=a.conversation_id WHERE a.id=? AND a.project_id=? AND ${liveSlaTicketSql()} AND ${ticketScopeSql('?')}`).bind(id,actor.projectId,actor.id).first<any>()
 if(!alert)throw new HTTPException(404)
 const guard=await ticketAuthority(c.env,actor,{sessionHash:c.get('sessionHash'),source:'dashboard'},'conversations.manage',alert.conversation_id)
 if(alert.state!=='open')return c.json({data:alert})
 const results=await c.env.DB.batch([
  c.env.DB.prepare(`INSERT INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,detail_json) SELECT ?,?,?,'data','sla.alert.acknowledged','succeeded','user',?,'dashboard','sla_alert',?,'{}' WHERE EXISTS(${guard.sql}) AND EXISTS(SELECT 1 FROM sla_alerts a JOIN conversations c ON c.project_id=a.project_id AND c.id=a.conversation_id WHERE a.id=? AND a.project_id=? AND a.state='open' AND ${availableTicketSql()})`).bind(receipt,actor.projectId,now,actor.id,id,...guard.params,id,actor.projectId),
  c.env.DB.prepare("UPDATE sla_alerts SET state='acknowledged',acknowledged_at=?,acknowledged_by=? WHERE id=? AND project_id=? AND EXISTS(SELECT 1 FROM audit_events WHERE id=?)").bind(now,actor.id,id,actor.projectId,receipt)
 ])
 if(!results[0].meta.changes)throw new HTTPException(409,{message:'Alert or authority changed. Reload before acknowledging.'})
 return c.json({data:await c.env.DB.prepare('SELECT * FROM sla_alerts WHERE id=? AND project_id=?').bind(id,actor.projectId).first()})
})
workflowSlaRoutes.get(`${prefix}/conversations/:conversationId/sla`,async c=>{
 const {actor,conversation}=await dashboardAccess(c)
 return c.json({data:await ticketSla(c.env,actor.projectId,conversation.id)})
})
