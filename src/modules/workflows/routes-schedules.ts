import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {Actor,AppEnv} from '../../platform/env'
import {memberAccess} from '../access/gate'
import {scope} from '../management/common'
import {dashboardAccess} from '../management/dashboard'
import {ticketAuthority,object,invalid} from '../tickets/model'
import {workflowNow} from './clock'
import {scheduleDefinition,scheduleReferences,scheduleRows,workflowTicketData,scheduleConflict} from './schedules-model'
export const workflowScheduleRoutes=new Hono<AppEnv>()
const prefix='/projects/:projectId'
workflowScheduleRoutes.get(`${prefix}/workflow-schedules`,async c=>{const actor=await scope(c) as Actor;return c.json({data:await scheduleRows(c.env,actor.projectId,c.req.query('conversation_id'))})})
workflowScheduleRoutes.get(`${prefix}/conversations/:conversationId/workflows`,async c=>{const {actor,conversation}=await dashboardAccess(c);const access=await memberAccess(c.env.DB,actor.projectId,actor.id);return c.json({data:{...await workflowTicketData(c.env,actor.projectId,conversation.id),permissions:{manage:!!access?.permissions.has('conversations.manage'),reply:!!access?.permissions.has('conversations.reply')}}})})
workflowScheduleRoutes.post(`${prefix}/workflow-schedules`,async c=>{
 const actor=await scope(c) as Actor,b=object(await c.req.json()),now=workflowNow(c.env),definition=scheduleDefinition(b,now),guard=await ticketAuthority(c.env,actor,{sessionHash:c.get('sessionHash')},definition.kind==='reply'?'conversations.reply':'conversations.manage')
 if(typeof b.conversation_id!=='string')invalid('Choose a ticket')
 const ticket=await c.env.DB.prepare('SELECT c.* FROM conversations c WHERE c.project_id=? AND c.id=? AND c.status_category NOT IN (\'solved\',\'closed\') AND NOT EXISTS(SELECT 1 FROM contact_erasures e WHERE e.project_id=c.project_id AND e.contact_id=c.contact_id)').bind(actor.projectId,b.conversation_id).first<any>();if(!ticket)throw new HTTPException(404)
 for(const [key,column] of [['expected_revision','revision'],['expected_ticket_version','ticket_version'],['expected_last_message_id','last_message_id']])if(b[key]!==undefined&&b[key]!==ticket[column])throw scheduleConflict()
 await scheduleReferences(c.env,actor.projectId,ticket.id,definition)
 const role=await c.env.DB.prepare('SELECT mr.role_key,pr.updated_at FROM member_roles mr LEFT JOIN project_roles pr ON pr.project_id=mr.project_id AND pr.id=mr.role_key WHERE mr.project_id=? AND mr.user_id=?').bind(actor.projectId,actor.id).first<any>(),id=crypto.randomUUID()
 const result=await c.env.DB.prepare(`INSERT INTO workflow_schedules(id,project_id,conversation_id,kind,due_at,timezone,body,owner_id,sender_id,sender_role,sender_role_key,sender_role_updated_at,dependency_id,expected_revision,expected_last_message_id,expected_assignee,created_at,updated_at) SELECT ?,c.project_id,c.id,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? FROM conversations c WHERE c.project_id=? AND c.id=? AND c.ticket_version=? AND c.revision=? AND c.last_message_id IS ? AND c.assigned_to IS ? AND c.status_category NOT IN ('solved','closed') AND EXISTS(${guard.sql}) AND EXISTS(SELECT 1 FROM memberships WHERE project_id=c.project_id AND user_id=?) AND NOT EXISTS(SELECT 1 FROM contact_erasures e WHERE e.project_id=c.project_id AND e.contact_id=c.contact_id) ${definition.dependency_id?'AND EXISTS(SELECT 1 FROM conversations d WHERE d.id=? AND d.project_id=c.project_id)':''} ${definition.kind==='snooze'?"AND NOT EXISTS(SELECT 1 FROM workflow_schedules WHERE conversation_id=c.id AND kind='snooze' AND state='pending')":''}`).bind(id,definition.kind,definition.due_at,definition.timezone,definition.body,definition.owner_id,actor.id,actor.role,role?.role_key??null,role?.updated_at??null,definition.dependency_id,ticket.revision,ticket.last_message_id,ticket.assigned_to,now,now,actor.projectId,ticket.id,ticket.ticket_version,ticket.revision,ticket.last_message_id,ticket.assigned_to,...guard.params,definition.owner_id,...(definition.dependency_id?[definition.dependency_id]:[])).run()
 if(!result.meta.changes)throw scheduleConflict()
 return c.json({data:await c.env.DB.prepare('SELECT * FROM workflow_schedules WHERE id=?').bind(id).first()},201)
})
workflowScheduleRoutes.patch(`${prefix}/workflow-schedules/:id`,async c=>{
 const actor=await scope(c) as Actor,b=object(await c.req.json()),row=await c.env.DB.prepare('SELECT * FROM workflow_schedules WHERE project_id=? AND id=?').bind(actor.projectId,c.req.param('id')).first<any>();if(!row)throw new HTTPException(404)
 if(b.kind!==undefined&&b.kind!==row.kind)invalid('The schedule kind cannot change')
 if(b.conversation_id!==undefined&&b.conversation_id!==row.conversation_id)invalid('The scheduled ticket cannot change')
 if(row.state!=='pending')throw new HTTPException(409,{message:'This schedule has already settled; an uncertain send cannot be replayed'})
 const guard=await ticketAuthority(c.env,actor,{sessionHash:c.get('sessionHash')},row.kind==='reply'?'conversations.reply':'conversations.manage'),now=workflowNow(c.env)
 if(row.sender_id!==actor.id&&!['owner','admin'].includes(actor.role))throw new HTTPException(403,{message:'Only the sender or a workspace lead can edit this schedule'})
 if(b.action==='cancel'){
  const result=await c.env.DB.prepare(`UPDATE workflow_schedules SET state='cancelled',reason='Cancelled by teammate',updated_at=?,version=version+1 WHERE id=? AND project_id=? AND state='pending' AND version=? AND EXISTS(${guard.sql})`).bind(now,row.id,actor.projectId,row.version,...guard.params).run();if(!result.meta.changes)throw scheduleConflict()
 }else{
  const definition=scheduleDefinition(b,now,row);await scheduleReferences(c.env,actor.projectId,row.conversation_id,definition)
  const result=await c.env.DB.prepare(`UPDATE workflow_schedules SET due_at=?,timezone=?,body=?,owner_id=?,dependency_id=?,updated_at=?,version=version+1 WHERE id=? AND project_id=? AND state='pending' AND version=? AND EXISTS(${guard.sql}) AND EXISTS(SELECT 1 FROM memberships WHERE project_id=? AND user_id=?)`).bind(definition.due_at,definition.timezone,definition.body,definition.owner_id,definition.dependency_id,now,row.id,actor.projectId,row.version,...guard.params,actor.projectId,definition.owner_id).run();if(!result.meta.changes)throw scheduleConflict()
 }
 return c.json({data:await c.env.DB.prepare('SELECT * FROM workflow_schedules WHERE id=?').bind(row.id).first()})
})
