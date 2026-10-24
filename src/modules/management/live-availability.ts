import type {Env} from '../../platform/env'
import {availability,withPresence,presenceSettings,type Availability} from './availability'
import {modelReady} from './provisioning/index'
import {onlineTeammates} from '../collaboration/presence-store'
import {calendarData} from '../workflows/calendars'
import {businessWindow} from '../workflows/calendars-time'
import {policyData,policyMatches} from '../workflows/sla-policy'
import {workflowNow} from '../workflows/clock'

// Before the visitor has a ticket, select the first active SLA policy matching
// ordinary widget intake. Ticket-specific plan/form/field policies do not apply.
async function businessHours(env:Env,projectId:string,settings:any,at:number):Promise<Availability>{
 const fallback=availability(settings,new Date(at))
 if(settings.is_available===false)return fallback
 const policies=(await env.DB.prepare('SELECT p.* FROM sla_policies p JOIN workflow_calendars cal ON cal.project_id=p.project_id AND cal.id=p.calendar_id WHERE p.project_id=? AND p.active=1 AND cal.active=1 ORDER BY p.position,p.id').bind(projectId).all<any>()).results.map(policyData)
 const policy=policies.find(policy=>policyMatches(policy,{project_id:projectId,brand_id:projectId,channel:'widget',priority:'normal',fields:{}},{}))
 if(!policy)return fallback
 const row=await env.DB.prepare('SELECT * FROM workflow_calendars WHERE project_id=? AND id=? AND active=1').bind(projectId,policy.calendar_id).first<any>()
 if(!row)return fallback
 const calendar=calendarData(row)
 return {...fallback,...businessWindow(calendar,at),scheduled:true,timezone:calendar.timezone,live:false}
}

/** The workspace's default visitor assistant, when it is enabled. */
export function visitorAssistant(env:Env,projectId:string){
 return env.DB.prepare("SELECT a.id,a.name,a.model FROM project_settings s JOIN ai_profiles a ON a.id=COALESCE(json_extract(s.settings_json,'$.default_visitor_ai_id'),json_extract(s.settings_json,'$.default_responder')) AND a.project_id=s.project_id AND a.is_enabled=1 WHERE s.project_id=?").bind(projectId).first<{id:string;name:string;model:string}>()
}

/** Whether the team is available, from the schedule and switch (judged `at`), then live presence (judged now): while
 * they say open and presence-based away is on, the team is away when no teammate who may reply is online, unless the
 * workspace's visitor assistant answers visitors (enabled, its provider key installed). */
export async function teamAvailability(env:Env,projectId:string,settings:any,at=workflowNow(env)):Promise<Availability>{
 const base=await businessHours(env,projectId,settings,at),presence=presenceSettings(settings)
 if(!base.available||!presence.enabled)return base
 const assistant=await visitorAssistant(env,projectId)
 if(assistant&&modelReady(env,assistant.model))return base
 return withPresence(base,settings,{online:(await onlineTeammates(env,projectId,presence.idleMinutes)).length})
}
