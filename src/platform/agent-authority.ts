import type {Actor,Env} from './env'
import type {ToolContext} from '../vendor/agent-base/modules/agent-door/index.ts'
import {ToolRefusal} from '../vendor/agent-base/modules/agent-door/index.ts'
import {memberAccess} from '../modules/access/gate'
import type {Permission} from '../modules/access/catalogue'
/** A server-only capability; no JSON/header/cookie can create this symbol. */
export const nativeAgentAuthority=Symbol('native agent authority')
export interface NativeAgentAuthority {
 [nativeAgentAuthority]:{sql:string;params:unknown[];ctx:ToolContext;tool:string;projectId:string;operationId:string}
}
export function agentOperation(env:Env,authority:NativeAgentAuthority,type:string,id:string,guard:{sql:string;params:unknown[]},nativeReceipt:Record<string,string>={}){
 const {ctx,tool,operationId,projectId}=authority[nativeAgentAuthority]
 return env.DB.prepare(`INSERT INTO h2h_agent_operations(id,project_id,tool,target_type,target_id,agent_id,agent_name,sponsor_id,sponsor_name,approvers_json,at,result_json) SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE ${guard.sql}`).bind(operationId,projectId,tool,type,id,ctx.agent.id,ctx.agent.name,ctx.person.id,ctx.person.name,JSON.stringify(ctx.approvers),Date.now(),JSON.stringify(nativeReceipt),...guard.params)
}
/** Preserve membership/role/policy snapshots in the native write transaction. */
export async function agentAuthority(env:Env,actor:Actor,ctx:ToolContext,tool:string,permission:Permission):Promise<NativeAgentAuthority>{
 const access=await memberAccess(env.DB,actor.projectId,actor.id)
 if(!access?.permissions.has(permission))throw new ToolRefusal('permission_denied')
 const role=await env.DB.prepare('SELECT mr.role_key,pr.updated_at FROM member_roles mr LEFT JOIN project_roles pr ON pr.project_id=mr.project_id AND pr.id=mr.role_key WHERE mr.project_id=? AND mr.user_id=?').bind(actor.projectId,actor.id).first<any>()
 const state=await env.DB.prepare('SELECT envelope,local_document,local_revision FROM agent_door_state WHERE id=1 AND local_paused=0').first<any>()
 if(!state)throw new ToolRefusal('agents_paused')
 const envelope=state.envelope?JSON.parse(state.envelope):null
 if(envelope?.paused)throw new ToolRefusal('agents_paused')
 if(envelope?.exp&&envelope.exp*1000<=Date.now())throw new ToolRefusal('policy_unavailable')
 if(envelope?.revoked?.agents?.includes(ctx.agent.id)||ctx.consent&&envelope?.revoked?.consents?.includes(ctx.consent))throw new ToolRefusal('consent_revoked')
 const projectSettings=await env.DB.prepare('SELECT settings_json FROM project_settings WHERE project_id=?').bind(actor.projectId).first<{settings_json:string}>()
 const sql=`SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id JOIN projects p ON p.id=m.project_id WHERE m.project_id=? AND m.user_id=? AND m.role=?
 AND (SELECT role_key FROM member_roles WHERE project_id=m.project_id AND user_id=m.user_id) IS ?
 AND (SELECT pr.updated_at FROM member_roles mr JOIN project_roles pr ON pr.project_id=mr.project_id AND pr.id=mr.role_key WHERE mr.project_id=m.project_id AND mr.user_id=m.user_id) IS ?
 AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=m.project_id AND (json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL OR json_extract(ps.settings_json,'$.suspended_at') IS NOT NULL))
 AND (SELECT settings_json FROM project_settings WHERE project_id=m.project_id) IS ?
 AND EXISTS(SELECT 1 FROM agent_door_state WHERE id=1 AND local_paused=0 AND envelope IS ? AND local_document IS ? AND local_revision=?)
 AND NOT EXISTS(SELECT 1 FROM agent_door_agents WHERE id=? AND revoked=1)`
 return {[nativeAgentAuthority]:{sql,operationId:crypto.randomUUID(),projectId:actor.projectId,params:[actor.projectId,actor.id,actor.role,role?.role_key??null,role?.updated_at??null,projectSettings?.settings_json??null,state.envelope,state.local_document,state.local_revision,ctx.agent.id],ctx,tool}}
}
