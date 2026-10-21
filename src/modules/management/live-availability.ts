import type {Env} from '../../platform/env'
import {availability,presenceSettings,type Availability} from './availability'
import {modelReady} from './provisioning/index'
import {onlineTeammates} from '../collaboration/presence-store'

/** The workspace's default visitor assistant, when it is enabled. */
export function visitorAssistant(env:Env,projectId:string){
 return env.DB.prepare("SELECT a.id,a.name,a.model FROM project_settings s JOIN ai_profiles a ON a.id=COALESCE(json_extract(s.settings_json,'$.default_visitor_ai_id'),json_extract(s.settings_json,'$.default_responder')) AND a.project_id=s.project_id AND a.is_enabled=1 WHERE s.project_id=?").bind(projectId).first<{id:string;name:string;model:string}>()
}

/** Whether the team is available, from the schedule and switch (judged `at`), then live presence (judged now): while
 * they say open and presence-based away is on, the team is away when no teammate who may reply is online, unless the
 * workspace's visitor assistant answers visitors (enabled, its provider key installed). */
export async function teamAvailability(env:Env,projectId:string,settings:any,at=Date.now()):Promise<Availability>{
 const base=availability(settings,new Date(at)),presence=presenceSettings(settings)
 if(!base.available||!presence.enabled)return base
 const assistant=await visitorAssistant(env,projectId)
 if(assistant&&modelReady(env,assistant.model))return base
 return availability(settings,new Date(at),{online:(await onlineTeammates(env,projectId,presence.idleMinutes)).length})
}
