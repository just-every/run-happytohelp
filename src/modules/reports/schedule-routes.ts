import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {auditStatement,requestSource} from '../audit/record'
import {requireStepUp} from '../identity/two-factor/step-up'
import {nextScheduleWindow} from './schedule-calendar'
import {reportMemberJoin,reportMemberSql,scheduleData,scheduleDefinition,scheduleScope,scheduleTimezone,type ReportSchedule} from './schedule-model'

export const scheduleRoutes=new Hono<AppEnv>()
const path='/projects/:projectId/report-schedules'
scheduleRoutes.get(path,async c=>{
 const actor=await scheduleScope(c)
 const [rows,recipients,links,timezone]=await Promise.all([
  c.env.DB.prepare('SELECT * FROM report_schedules WHERE project_id=? ORDER BY created_at,id').bind(actor.projectId).all<ReportSchedule>(),
  c.env.DB.prepare(`SELECT u.id,u.name,u.email ${reportMemberJoin} WHERE m.project_id=? AND ${reportMemberSql()} ORDER BY u.name,u.id`).bind(actor.projectId).all<{id:string;name:string;email:string}>(),
  c.env.DB.prepare('SELECT r.schedule_id,r.user_id FROM report_schedule_recipients r JOIN report_schedules s ON s.id=r.schedule_id WHERE s.project_id=?').bind(actor.projectId).all<{schedule_id:string;user_id:string}>(),
  scheduleTimezone(c.env.DB,actor.projectId),
 ])
 return c.json({schedules:rows.results.map(row=>scheduleData(row,links.results.filter(r=>r.schedule_id===row.id).map(r=>r.user_id))),recipients:recipients.results,timezone,permissions:{manage:true}})
})
scheduleRoutes.post(path,async c=>{
 const actor=await scheduleScope(c);await requireStepUp(c,actor,'reports.export')
 const b=scheduleDefinition(await c.req.json()),now=Date.now(),timezone=await scheduleTimezone(c.env.DB,actor.projectId),window=nextScheduleWindow(b,timezone,now),id=crypto.randomUUID()
 const eligible=await c.env.DB.prepare(`SELECT u.id ${reportMemberJoin} WHERE m.project_id=? AND ${reportMemberSql()} AND u.id IN (SELECT value FROM json_each(?))`).bind(actor.projectId,JSON.stringify(b.recipients)).all<{id:string}>()
 if(eligible.results.length!==b.recipients.length)throw new HTTPException(400,{message:'Every recipient must currently have report viewing and data export permissions in this workspace'})
 if(b.teamId&&!await c.env.DB.prepare('SELECT 1 FROM ticket_groups WHERE project_id=? AND id=?').bind(actor.projectId,b.teamId).first())throw new HTTPException(400,{message:'Choose a team in this workspace'})
 if(b.brandId&&b.brandId!==actor.projectId&&!await c.env.DB.prepare('SELECT 1 FROM conversations WHERE project_id=? AND brand_id=? LIMIT 1').bind(actor.projectId,b.brandId).first())throw new HTTPException(400,{message:'Choose a brand in this workspace'})
 await c.env.DB.batch([
  c.env.DB.prepare('INSERT INTO report_schedules(id,project_id,created_by,name,frequency,hour,weekday,team_id,brand_id,include_imported,paused,timezone,window_date,next_run_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,actor.projectId,actor.id,b.name,b.frequency,b.hour,b.weekday,b.teamId,b.brandId,Number(b.includeImported),Number(b.paused),timezone,window.date,window.at,now,now),
  c.env.DB.prepare('INSERT INTO report_schedule_recipients(schedule_id,user_id) SELECT ?,value FROM json_each(?)').bind(id,JSON.stringify(b.recipients)),
  auditStatement(c.env.DB,{projectId:actor.projectId,category:'data',action:'reports.schedule.created',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'report_schedule',id},detail:{frequency:b.frequency,recipientCount:b.recipients.length,paused:b.paused}},now),
 ])
 return c.json({id,...b,timezone,nextRunAt:window.at,createdBy:actor.id},201)
})
scheduleRoutes.patch(`${path}/:scheduleId`,async c=>{
 const actor=await scheduleScope(c),id=c.req.param('scheduleId'),body=await c.req.json()
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>key!=='paused')||typeof body.paused!=='boolean')throw new HTTPException(400,{message:'Choose whether the schedule is paused'})
 if(!body.paused)await requireStepUp(c,actor,'reports.export')
 const row=await c.env.DB.prepare('SELECT * FROM report_schedules WHERE project_id=? AND id=?').bind(actor.projectId,id).first<ReportSchedule>();if(!row)throw new HTTPException(404)
 const now=Date.now(),timezone=await scheduleTimezone(c.env.DB,actor.projectId),window=nextScheduleWindow(row,timezone,now)
 await c.env.DB.batch([
  c.env.DB.prepare('UPDATE report_schedules SET paused=?,created_by=?,timezone=?,window_date=?,next_run_at=?,updated_at=? WHERE project_id=? AND id=?').bind(Number(body.paused),body.paused?row.created_by:actor.id,timezone,window.date,window.at,now,actor.projectId,id),
  auditStatement(c.env.DB,{projectId:actor.projectId,category:'data',action:body.paused?'reports.schedule.paused':'reports.schedule.resumed',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'report_schedule',id}},now),
 ])
 return c.json({id,paused:body.paused,nextRunAt:window.at})
})
scheduleRoutes.delete(`${path}/:scheduleId`,async c=>{
 const actor=await scheduleScope(c),id=c.req.param('scheduleId')
 if(!await c.env.DB.prepare('SELECT 1 FROM report_schedules WHERE project_id=? AND id=?').bind(actor.projectId,id).first())throw new HTTPException(404)
 await c.env.DB.batch([
  c.env.DB.prepare('DELETE FROM report_schedules WHERE project_id=? AND id=?').bind(actor.projectId,id),
  auditStatement(c.env.DB,{projectId:actor.projectId,category:'data',action:'reports.schedule.deleted',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'report_schedule',id}}),
 ])
 return c.json({deleted:true})
})
