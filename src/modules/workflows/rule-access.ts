import type {Env} from '../../platform/env'
import {HTTPException} from 'hono/http-exception'
import {memberAccess,type MemberAccess} from '../access/gate'
import {fieldAllowed} from '../tickets/model'
import type {WorkflowGuard} from './actions'
import type {RuleDefinition} from './rule-model'
/** A background grant belongs to the real publishing member. Pin role assignment
 * and custom role revision without pretending the worker has a login session. */
export async function workflowMemberGuard(env:Env,projectId:string,userId:string){
 const access=await memberAccess(env.DB,projectId,userId)
 if(!access?.permissions.has('settings.manage'))throw new HTTPException(403,{message:'Workflow publisher no longer has permission to manage workflows'})
 const row=await env.DB.prepare('SELECT m.role,mr.role_key,pr.updated_at FROM memberships m LEFT JOIN member_roles mr ON mr.project_id=m.project_id AND mr.user_id=m.user_id LEFT JOIN project_roles pr ON pr.project_id=mr.project_id AND pr.id=mr.role_key WHERE m.project_id=? AND m.user_id=?').bind(projectId,userId).first<any>()
 if(!row)throw new HTTPException(403)
 const guard:WorkflowGuard={sql:'EXISTS(SELECT 1 FROM memberships m LEFT JOIN member_roles mr ON mr.project_id=m.project_id AND mr.user_id=m.user_id LEFT JOIN project_roles pr ON pr.project_id=mr.project_id AND pr.id=mr.role_key WHERE m.project_id=? AND m.user_id=? AND m.role=? AND mr.role_key IS ? AND pr.updated_at IS ?)',params:[projectId,userId,row.role,row.role_key??null,row.updated_at??null]}
 return {access,guard}
}
export function definitionVisible(d:RuleDefinition,fields:any[],access:MemberAccess|null){
 const allowed=(id:string)=>{const f=fields.find(f=>f.id===id);return !!f&&fieldAllowed(f,access)}
 return [...d.conditions.all,...d.conditions.any].every(c=>!c.field.startsWith('field:')||allowed(c.field.slice(6)))&&d.actions.every(a=>a.type!=='fields'||Object.keys(a.values).every(allowed))
}
export async function workflowVisibleFields(env:Env,projectId:string,userId:string){const [access,fields]=await Promise.all([memberAccess(env.DB,projectId,userId),env.DB.prepare('SELECT * FROM ticket_fields WHERE project_id=?').bind(projectId).all<any>()]);return {access,fields:fields.results}}
