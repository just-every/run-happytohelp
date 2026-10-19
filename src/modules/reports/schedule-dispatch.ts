import type {Env} from '../../platform/env'
import {cronRequire,cronRoom} from '../../platform/cron-budget'
import {sendEmail} from '../integrations/email'
import {memberAccess} from '../access/gate'
import {auditStatement} from '../audit/record'
import {readTeamReport} from './team-read'
import {teamReportCSV} from './team-csv'
import {nextScheduleWindow,scheduleRange} from './schedule-calendar'
import {reportMemberJoin,reportMemberSql,scheduleTimezone,type ReportSchedule} from './schedule-model'

const authorizedMember=`SELECT 1 ${reportMemberJoin} WHERE m.project_id=? AND m.user_id=? AND ${reportMemberSql()}`
function encodedCSV(csv:string){let binary='';for(const byte of new TextEncoder().encode(csv))binary+=String.fromCharCode(byte);return btoa(binary)}
async function advance(env:Env,row:ReportSchedule,now:number){
 const next=nextScheduleWindow(row,row.timezone,now)
 await env.DB.prepare('UPDATE report_schedules SET window_date=?,next_run_at=? WHERE id=? AND window_date=? AND next_run_at=?').bind(next.date,next.at,row.id,row.window_date,row.next_run_at).run()
}
/** A finite batch and durable last-considered cursor distribute room fairly, even
 * if a schedule has many recipients or a provider outcome stays unknown. Claimed
 * windows are terminal and are never retried, including after a Worker crash. */
export async function dispatchScheduledReports(env:Env,now=Date.now()){
 if(!cronRoom(env,2))return {processed:0}
 const due=await env.DB.prepare(`SELECT s.* FROM report_schedules s LEFT JOIN project_settings ps ON ps.project_id=s.project_id WHERE s.paused=0 AND json_extract(coalesce(ps.settings_json,'{}'),'$.deleted_at') IS NULL AND (s.next_run_at<=? OR s.timezone<>coalesce(json_extract(ps.settings_json,'$.timezone'),'UTC')) ORDER BY s.last_dispatched_at,s.id LIMIT 10`).bind(now).all<ReportSchedule>()
 let processed=0
 for(const row of due.results){
  // Includes complete SQL aggregates, final authorization, mail's own claim and
  // outcome writes. Never start an external effect without outcome room reserved.
  if(!cronRoom(env,40))break
  cronRequire(env,40)
  await env.DB.prepare('UPDATE report_schedules SET last_dispatched_at=max(?,coalesce((SELECT max(last_dispatched_at)+1 FROM report_schedules),?)) WHERE id=?').bind(now,now,row.id).run()
  const timezone=await scheduleTimezone(env.DB,row.project_id)
  if(timezone!==row.timezone){
   const next=nextScheduleWindow(row,timezone,now)
   await env.DB.prepare('UPDATE report_schedules SET timezone=?,window_date=?,next_run_at=? WHERE id=? AND timezone=?').bind(timezone,next.date,next.at,row.id,row.timezone).run()
   continue
  }
  if(!await env.DB.prepare(authorizedMember).bind(row.project_id,row.created_by).first()){
   await env.DB.batch([env.DB.prepare('UPDATE report_schedules SET paused=1 WHERE id=?').bind(row.id),auditStatement(env.DB,{projectId:row.project_id,category:'data',action:'reports.schedule.suspended',outcome:'refused',actor:{type:'system'},source:'system',target:{type:'report_schedule',id:row.id},detail:{reason:'sender_permission_changed'}})])
   continue
  }
  const recipient=await env.DB.prepare(`SELECT r.user_id FROM report_schedule_recipients r WHERE r.schedule_id=? AND NOT EXISTS(SELECT 1 FROM report_schedule_deliveries d WHERE d.schedule_id=r.schedule_id AND d.window_date=? AND d.recipient_id=r.user_id) ORDER BY r.user_id LIMIT 1`).bind(row.id,row.window_date).first<{user_id:string}>()
  if(!recipient){await advance(env,row,now);continue}
  const id=`report:${row.id}:${row.window_date}:${recipient.user_id}`
  // This insert is the only send admission. Permission loss makes a durable skip
  // instead of keeping a stale export queued for a future grant.
  const claim=await env.DB.prepare(`INSERT OR IGNORE INTO report_schedule_deliveries(id,schedule_id,project_id,window_date,recipient_id,state,claimed_at) SELECT ?,s.id,s.project_id,s.window_date,?,CASE WHEN EXISTS(${authorizedMember}) AND EXISTS(${authorizedMember}) THEN 'claimed' ELSE 'skipped' END,? FROM report_schedules s WHERE s.id=? AND s.paused=0 AND s.next_run_at=? AND s.window_date=? AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=s.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL)`).bind(id,recipient.user_id,row.project_id,row.created_by,row.project_id,recipient.user_id,now,row.id,row.next_run_at,row.window_date).run()
  if(!claim.meta.changes)continue
  processed++
  const delivery=await env.DB.prepare('SELECT state FROM report_schedule_deliveries WHERE id=?').bind(id).first<{state:string}>()
  if(delivery?.state!=='claimed')continue
  try{
   const access=await memberAccess(env.DB,row.project_id,recipient.user_id)
   if(!access||access.base==='collaborator'||!access.permissions.has('reports.view')||!access.permissions.has('data.export')){await env.DB.prepare("UPDATE report_schedule_deliveries SET state='skipped',finished_at=? WHERE id=? AND state='claimed'").bind(Date.now(),id).run();continue}
   const range=scheduleRange(row,row.window_date,row.timezone),report=await readTeamReport(env,row.project_id,range,{teamId:row.team_id,brandId:row.brand_id,includeImported:!!row.include_imported},now,access.key)
   // Read current address and roles after the potentially expensive report query.
   const current=await env.DB.prepare(`SELECT u.email ${reportMemberJoin} WHERE m.project_id=? AND m.user_id=? AND ${reportMemberSql()} AND EXISTS(${authorizedMember}) AND EXISTS(SELECT 1 FROM report_schedules s WHERE s.id=? AND s.paused=0 AND s.window_date=? AND s.next_run_at=?) AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=m.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL)`).bind(row.project_id,recipient.user_id,row.project_id,row.created_by,row.id,row.window_date,row.next_run_at).first<{email:string}>()
   const finalAccess=await memberAccess(env.DB,row.project_id,recipient.user_id)
   if(!current||!finalAccess||finalAccess.key!==access.key||finalAccess.base==='collaborator'||!finalAccess.permissions.has('reports.view')||!finalAccess.permissions.has('data.export')){await env.DB.prepare("UPDATE report_schedule_deliveries SET state='skipped',finished_at=? WHERE id=? AND state='claimed'").bind(Date.now(),id).run();continue}
   cronRequire(env,10)
   const result=await sendEmail(env,{projectId:row.project_id,to:current.email,subject:`${row.name}: ${range.start} to ${range.end}`,text:`Your scheduled team report is attached.\nRange: ${range.start} to ${range.end} (end exclusive), ${row.timezone}.\nOpen Reports with the same dates and filters to view these figures.`,attachments:[{filename:`team-report-${range.start}-${range.end}.csv`,content:encodedCSV(teamReportCSV(report)),contentType:'text/csv'}],idempotencyKey:id,headers:{'Auto-Submitted':'auto-generated','X-Auto-Response-Suppress':'All'}})
   await env.DB.prepare('UPDATE report_schedule_deliveries SET state=?,finished_at=? WHERE id=? AND state=\'claimed\'').bind(result.state==='sent'?'sent':result.state==='suppressed'?'suppressed':'unknown',Date.now(),id).run()
  }catch{
   // A thrown provider request may already have sent. Never replay this window.
   await env.DB.prepare("UPDATE report_schedule_deliveries SET state='unknown',finished_at=? WHERE id=? AND state='claimed'").bind(Date.now(),id).run()
  }
 }
 return {processed}
}
