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
   c.env.DB.prepare(`INSERT INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,detail_json) SELECT ?,?,?,'data',?,'succeeded','user',?,'dashboard',?,?,'{}' WHERE EXISTS(${guard.sql}) ${extra.map(predicate=>'AND '+predicate).join(' ')}`).bind(receipt,actor.projectId,now,`${kind}.${method}`,actor.id,table,id,...guard.params,...args),
   method==='post'?c.env.DB.prepare(`INSERT INTO ${table}(project_id,id,${columns.join(',')},updated_at) SELECT ?,?,${columns.map(()=>'?').join(',')},? WHERE ${accepted}`).bind(actor.projectId,id,...values,now,receipt):c.env.DB.prepare(`UPDATE ${table} SET ${columns.map(column=>`${column}=?`).join(',')},updated_at=? WHERE project_id=? AND id=? AND ${accepted}`).bind(...values,now,actor.projectId,id,receipt)
  ])
  if(!results[0].meta.changes)throw new HTTPException(409,{message:'Settings or authority changed. Reload before applying changes.'})
  return c.json({data:decode(await c.env.DB.prepare(`SELECT * FROM ${table} WHERE project_id=? AND id=?`).bind(actor.projectId,id).first<any>())},method==='post'?201:200)
 })
}
workflowSlaRoutes.get(`${prefix}/sla-alerts`,async c=>{
 const actor=await scope(c) as Actor
 await ticketReadAccess(c.env,actor)
 const alerts=await c.env.DB.prepare(`SELECT a.* FROM sla_alerts a JOIN conversations c ON c.project_id=a.project_id AND c.id=a.conversation_id WHERE a.project_id=? AND ${liveSlaTicketSql()} ORDER BY a.created_at DESC,a.id`).bind(actor.projectId).all<any>()
 return c.json({data:alerts.results})
})
workflowSlaRoutes.patch(`${prefix}/sla-alerts/:id/ack`,async c=>{
 const actor=await scope(c) as Actor,guard=await ticketAuthority(c.env,actor,{sessionHash:c.get('sessionHash'),source:'dashboard'}),id=c.req.param('id'),now=workflowNow(c.env),receipt=crypto.randomUUID()
 await emptyCommand(c)
 const alert=await c.env.DB.prepare(`SELECT a.* FROM sla_alerts a JOIN conversations c ON c.project_id=a.project_id AND c.id=a.conversation_id WHERE a.id=? AND a.project_id=? AND ${liveSlaTicketSql()}`).bind(id,actor.projectId).first<any>()
 if(!alert)throw new HTTPException(404)
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
