import {HTTPException} from 'hono/http-exception'
import type {Context} from 'hono'
import type {AppEnv} from '../../platform/env'
import {scope} from '../management/common'
import {memberAccess} from '../access/gate'
import {named,object} from '../tickets/model'
import {validTimezone} from './calendar'
import type {ScheduleClock} from './schedule-calendar'

export interface ReportSchedule extends ScheduleClock {
 id:string;project_id:string;created_by:string;name:string;team_id:string|null;brand_id:string|null;include_imported:number;paused:number;timezone:string;window_date:string;next_run_at:number;last_dispatched_at:number;created_at:number;updated_at:number
}
/** Mirrors memberAccess's effective permissions. Only owner/admin bases can have
 * data.export; a custom role still needs both grants explicitly. Never customers. */
export function reportMemberSql(member='m',assignment='mr',role='pr'){
 return `(${member}.role='owner' OR (coalesce(${assignment}.role_key,'')<>'collaborator' AND CASE WHEN ${role}.base IS NOT NULL AND ${role}.name IS NOT NULL THEN ${role}.base='admin' AND EXISTS(SELECT 1 FROM json_each(${role}.permissions_json) WHERE value='reports.view') AND EXISTS(SELECT 1 FROM json_each(${role}.permissions_json) WHERE value='data.export') ELSE ${member}.role='admin' END))`
}
export const reportMemberJoin='FROM memberships m JOIN users u ON u.id=m.user_id LEFT JOIN member_roles mr ON mr.project_id=m.project_id AND mr.user_id=m.user_id LEFT JOIN project_roles pr ON pr.project_id=mr.project_id AND pr.id=mr.role_key'
export async function scheduleScope(c:Context<AppEnv>){
 const actor=await scope(c),access=await memberAccess(c.env.DB,actor.projectId,actor.id)
 if(!access||access.base==='collaborator'||!access.permissions.has('reports.view')||!access.permissions.has('data.export'))throw new HTTPException(403,{message:'Report viewing and data export permissions are required for scheduled reports'})
 return actor
}
export async function scheduleTimezone(db:D1Database,projectId:string){
 const row=await db.prepare('SELECT settings_json FROM project_settings WHERE project_id=?').bind(projectId).first<{settings_json:string}>(),timezone=JSON.parse(row?.settings_json||'{}').timezone||'UTC'
 if(!validTimezone(timezone))throw new HTTPException(422,{message:'Choose a valid workspace timezone in Project settings before scheduling reports'})
 return timezone
}
export function scheduleDefinition(value:unknown){
 const b=object(value),name=named(b.name,120)
 if(/[\r\n]/.test(name))throw new HTTPException(400,{message:'Use a single line for the schedule name'})
 if(!['daily','weekly'].includes(b.frequency)||!Number.isInteger(b.hour)||b.hour<0||b.hour>23)throw new HTTPException(400,{message:'Choose daily or weekly and a local hour from 0 to 23'})
 const weekday=b.weekday??0
 if(!Number.isInteger(weekday)||weekday<0||weekday>6)throw new HTTPException(400,{message:'Choose a weekday from 0 (Sunday) to 6 (Saturday)'})
 if(!Array.isArray(b.recipients)||!b.recipients.length||b.recipients.length>20||b.recipients.some((id:unknown)=>typeof id!=='string'||!id||id.length>200))throw new HTTPException(400,{message:'Choose 1 to 20 workspace teammates'})
 for(const key of ['teamId','brandId'])if(b[key]!=null&&(typeof b[key]!=='string'||!b[key]||b[key].length>200))throw new HTTPException(400,{message:'Invalid report filter'})
 if(b.paused!==undefined&&typeof b.paused!=='boolean'||b.includeImported!==undefined&&typeof b.includeImported!=='boolean')throw new HTTPException(400,{message:'Invalid schedule option'})
 return {name,frequency:b.frequency as 'daily'|'weekly',hour:b.hour as number,weekday,recipients:[...new Set(b.recipients)] as string[],teamId:b.teamId??null as string|null,brandId:b.brandId??null as string|null,includeImported:b.includeImported===true,paused:b.paused===true}
}
export const scheduleData=(row:ReportSchedule,recipients:string[])=>({id:row.id,name:row.name,frequency:row.frequency,hour:row.hour,weekday:row.weekday,teamId:row.team_id,brandId:row.brand_id,includeImported:!!row.include_imported,paused:!!row.paused,timezone:row.timezone,nextRunAt:row.next_run_at,createdBy:row.created_by,recipients})
