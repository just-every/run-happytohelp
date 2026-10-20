import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {scope} from '../management/common'
import {reportRange,validTimezone} from './calendar'
import {teamReportFilters} from './team-scope'
import {readTeamReport} from './team-read'
import {teamReportCSV} from './team-csv'
import {requireReportPermission} from './permission'
import {requireStepUp} from '../identity/two-factor/step-up'
import {auditStatement,requestSource} from '../audit/record'

export const teamReports=new Hono<AppEnv>()
teamReports.get('/projects/:projectId/reports/team',async c=>{
 const actor=await scope(c),access=await requireReportPermission(c,actor,'reports.view')
 const settings=await c.env.DB.prepare('SELECT settings_json FROM project_settings WHERE project_id=?').bind(actor.projectId).first<{settings_json:string}>()
 const timezone=JSON.parse(settings?.settings_json||'{}').timezone||'UTC'
 if(!validTimezone(timezone))throw new HTTPException(422,{message:'Choose a valid workspace timezone in Project settings before opening Reports'})
 const query=c.req.query(),range=reportRange(query,timezone),filters=teamReportFilters(query)
 if(query.format){
  if(query.format!=='summary.csv')throw new HTTPException(400,{message:'Choose summary.csv for a team report export'})
  await requireReportPermission(c,actor,'data.export')
  await requireStepUp(c,actor,'reports.export')
 }
 const report=await readTeamReport(c.env,actor.projectId,range,filters,Date.now(),access.key)
 c.header('Cache-Control','no-store')
 if(query.format){
  await auditStatement(c.env.DB,{projectId:actor.projectId,category:'data',action:'reports.exported',actor:{type:'user',id:actor.id},source:requestSource(c),detail:{format:'team-summary.csv',start:range.start,end:range.end,timezone,...filters}}).run()
  return c.body(teamReportCSV(report),200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="team-summary.csv"'})
 }
 return c.json({...report,permissions:{view:true,export:access.permissions.has('data.export'),schedule:access.permissions.has('data.export')}})
})
