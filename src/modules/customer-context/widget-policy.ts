import type {Env} from '../../platform/env'
import {modelReadiness} from '../management/provisioning/index'
import {replyMode} from '../ai-support/reply-mode'

/** Workspace policy enables an offer; only the visitor may grant their consent. Proactive help writes to
 * the visitor, so it is offered only while AI replies are automatic. */
export async function widgetMonitoringPolicy(env:Env,projectId:string){
 const row=await env.DB.prepare('SELECT settings_json FROM project_settings WHERE project_id=?').bind(projectId).first<{settings_json:string}>()
 const settings=JSON.parse(row?.settings_json||'{}')
 const enabled=settings.is_contact_tracking_enabled===true&&settings.proactive_help_enabled===true&&!settings.deleted_at&&replyMode(settings)==='auto'
 const assistant=await env.DB.prepare('SELECT id,name,role,model FROM ai_profiles WHERE project_id=? AND id=? AND is_enabled=1').bind(projectId,settings.default_visitor_ai_id||settings.default_responder||'').first<{id:string;name:string;role:string;model:string}>()
 const model=typeof env.CONTEXT_MODEL==='string'&&env.CONTEXT_MODEL.trim()?env.CONTEXT_MODEL:assistant?.model
 const ready=!!assistant&&!!model&&modelReadiness(env,model).ready&&modelReadiness(env,assistant.model).ready
 return {enabled,ready,model,assistant,helpTypes:enabled&&assistant?['support']:[]}
}

export async function visitorMonitoring(env:Env,projectId:string,subjectId:string){
 const policy=await widgetMonitoringPolicy(env,projectId)
 const subject=await env.DB.prepare('SELECT consent,bot_enabled FROM context_subjects WHERE project_id=? AND subject_id=?').bind(projectId,subjectId).first<{consent:number;bot_enabled:number}>()
 return {available:policy.enabled,ready:policy.ready,consent:subject?!!subject.consent:null,enabled:policy.enabled&&!!subject?.consent&&!!subject?.bot_enabled}
}
