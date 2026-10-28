import {ticketScopeSql} from '../access/ticket-scope'
import {workspaceAccountOptions} from './account-options'
import {batchRead} from './request-batch'
import {HTTPException} from 'hono/http-exception'
import type {Actor,Env} from '../../platform/env'
import {tokenGuard,type TokenAuthority} from '../../platform/integration-authority'
import {memberAccess,type MemberAccess} from '../access/gate'
import type {Permission} from '../access/catalogue'
import {audit,type AuditSource} from '../audit/record'
import {contactAvailableSql} from '../conversations/contact-privacy'
export type TicketAuthority={sessionHash?:string;tokenAuthority?:TokenAuthority;source?:AuditSource}
export const categories=['new','open','pending','on_hold','solved','closed'] as const
export const priorities=['low','normal','high','urgent'] as const
export function invalid(message:string):never{throw new HTTPException(400,{message})}
export function named(value:unknown,max=120){if(typeof value!=='string'||!value.trim()||value.length>max)invalid(`Enter text of 1–${max} characters`);return value.trim()}
export function object(value:unknown):Record<string,any>{if(!value||typeof value!=='object'||Array.isArray(value))invalid('Expected an object');return value as Record<string,any>}
export async function ticketAuthority(env:Env,actor:Actor,authority:TicketAuthority,permission:Permission='conversations.manage',conversationId?:string){
 if(authority.tokenAuthority){if(permission!=='conversations.manage')throw new HTTPException(403);const guard=tokenGuard(authority.tokenAuthority,actor.projectId,'conversations:write');return {...guard,access:null as MemberAccess|null}}
 if(actor.role==='contact'||!authority.sessionHash)throw new HTTPException(403)
 const role=await batchRead(env,`role:${actor.projectId}:${actor.id}`,()=>env.DB.prepare('SELECT mr.role_key,pr.updated_at FROM member_roles mr LEFT JOIN project_roles pr ON pr.project_id=mr.project_id AND pr.id=mr.role_key WHERE mr.project_id=? AND mr.user_id=?').bind(actor.projectId,actor.id).first<any>())
 const access=await batchRead(env,`access:${actor.projectId}:${actor.id}`,()=>memberAccess(env.DB,actor.projectId,actor.id))
 if(!access?.permissions.has(permission)){
  await audit(env,{projectId:actor.projectId,category:'access',action:'ticket.permission_denied',outcome:'refused',actor:{type:'user',id:actor.id},source:authority.source??'dashboard',detail:{permission}})
  throw new HTTPException(403,{message:`Your role does not allow ${permission}`})
 }
 // Pin both the role assignment and role definition at commit, including removals.
 const sql=`SELECT 1 FROM memberships m JOIN sessions s ON s.token_hash=? WHERE m.project_id=? AND m.user_id=? AND m.role=? AND s.actor_id=m.user_id AND s.role<>'contact' AND s.revoked_at IS NULL AND s.expires_at>max(?,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)) AND (s.project_id IS NULL AND s.role='operator' OR s.project_id=m.project_id AND s.role=m.role) AND (SELECT role_key FROM member_roles WHERE project_id=m.project_id AND user_id=m.user_id) IS ? AND (SELECT pr.updated_at FROM member_roles mr JOIN project_roles pr ON pr.project_id=mr.project_id AND pr.id=mr.role_key WHERE mr.project_id=m.project_id AND mr.user_id=m.user_id) IS ? AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=m.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL)`
 const scoped=conversationId?` AND EXISTS(SELECT 1 FROM conversations scope_ticket WHERE scope_ticket.id=? AND scope_ticket.project_id=m.project_id AND ${ticketScopeSql('m.user_id','scope_ticket')})`:''
 return {sql:sql+scoped,params:[authority.sessionHash,actor.projectId,actor.id,actor.role,Date.now(),role?.role_key??null,role?.updated_at??null,...(conversationId?[conversationId]:[])],access}
}
export async function ticketReadAccess(env:Env,actor:Actor){
 if(actor.role==='contact')throw new HTTPException(403)
 const access=await batchRead(env,`access:${actor.projectId}:${actor.id}`,()=>memberAccess(env.DB,actor.projectId,actor.id))
 if(!access)throw new HTTPException(403)
 return access
}
export const availableTicketSql=contactAvailableSql
export function fieldAllowed(field:any,access:MemberAccess|null,write=false){
 const roles:unknown=JSON.parse(write?field.write_roles_json:field.read_roles_json)
 // Tokens never inherit an owner's private field permissions.
 return Array.isArray(roles)&&(roles.length===0||roles.includes(access?.key??'api'))
}
export function fieldData(field:any,access:MemberAccess|null){const {options_json,validation_json,read_roles_json,write_roles_json,...rest}=field;return {...rest,required:!!field.required,options:JSON.parse(options_json),validation:JSON.parse(validation_json),read_roles:JSON.parse(read_roles_json),write_roles:JSON.parse(write_roles_json),writable:fieldAllowed(field,access,true)}}
export async function getTicket(env:Env,actor:Actor,id:string,tokenAuthority?:TokenAuthority){
 const access=tokenAuthority?null:await ticketReadAccess(env,actor)
 const token=tokenAuthority?tokenGuard(tokenAuthority,actor.projectId,tokenAuthority.scope):null
 const row=await env.DB.prepare(`SELECT c.* FROM conversations c WHERE c.project_id=? AND c.id=? ${token?`AND EXISTS(${token.sql})`:`AND ${ticketScopeSql('?')}`} AND ${contactAvailableSql()} AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=c.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL)`).bind(actor.projectId,id,...(token?.params??[actor.id])).first<any>();if(!row)throw new HTTPException(404)
 const [fields,history,status,tags,api]=await Promise.all([
  env.DB.prepare('SELECT f.*,v.value_json FROM ticket_fields f LEFT JOIN ticket_field_values v ON v.project_id=f.project_id AND v.field_id=f.id AND v.conversation_id=? WHERE f.project_id=?').bind(id,actor.projectId).all<any>(),
  env.DB.prepare('SELECT * FROM ticket_history WHERE project_id=? AND conversation_id=? ORDER BY at DESC,id DESC LIMIT 200').bind(actor.projectId,id).all<any>(),
  env.DB.prepare('SELECT id,name,category FROM ticket_statuses WHERE project_id=? AND id=?').bind(actor.projectId,row.status_id).first(),
  env.DB.prepare('SELECT t.id,t.name FROM conversation_tags ct JOIN workspace_tags t ON t.project_id=ct.project_id AND t.id=ct.tag_id WHERE ct.project_id=? AND ct.conversation_id=? ORDER BY t.name').bind(actor.projectId,id).all<any>(),
  env.DB.prepare('SELECT credential_name,source_product,source_ref,source_url FROM api_conversations WHERE project_id=? AND conversation_id=?').bind(actor.projectId,id).first(),
 ])
 const visible=new Set(fields.results.filter(f=>fieldAllowed(f,access)).map(f=>f.id))
 const historyRows=history.results.map(h=>{const changes=JSON.parse(h.changes_json);if(changes.fields)for(const key of Object.keys(changes.fields))if(!visible.has(key))delete changes.fields[key];const {changes_json,...rest}=h;return {...rest,changes}})
 const {ticket_actor_id,ticket_actor_type,ticket_source,...ticket}=row
 return {...ticket,status,api,tags:tags.results,fields:Object.fromEntries(fields.results.filter(f=>visible.has(f.id)&&f.value_json!=null).map(f=>[f.id,JSON.parse(f.value_json)])),history:historyRows}
}
export async function ticketSettings(env:Env,actor:Actor){
 const access=await ticketReadAccess(env,actor)
 const [statuses,fields,groups,members,brand,roles,accounts]=await Promise.all([
  env.DB.prepare('SELECT * FROM ticket_statuses WHERE project_id=? ORDER BY is_default DESC,category,name').bind(actor.projectId).all<any>(),
  env.DB.prepare('SELECT * FROM ticket_fields WHERE project_id=? ORDER BY name').bind(actor.projectId).all<any>(),
  env.DB.prepare('SELECT * FROM ticket_groups WHERE project_id=? ORDER BY name').bind(actor.projectId).all<any>(),
  env.DB.prepare('SELECT group_id,user_id FROM ticket_group_members WHERE project_id=?').bind(actor.projectId).all<any>(),
  env.DB.prepare('SELECT id,name FROM projects WHERE id=?').bind(actor.projectId).first(),
  env.DB.prepare('SELECT id,name FROM project_roles WHERE project_id=?').bind(actor.projectId).all<any>(),
  workspaceAccountOptions(env,actor.projectId,true),
 ])
 return {statuses:statuses.results,fields:fields.results.filter(f=>fieldAllowed(f,access)).map(f=>({...fieldData(f,access),...(f.type==='account'?{accountOptions:accounts}:{})})),groups:groups.results.map(g=>({...g,members:members.results.filter(m=>m.group_id===g.id).map(m=>m.user_id)})),brands:[brand],permissions:{manage:access.permissions.has('conversations.manage'),settings:['owner','admin'].includes(actor.role)&&access.permissions.has('settings.manage')},role:access.key,roles:[...['owner','admin','operator','collaborator'].map(id=>({id,name:id})),{id:'api',name:'Workspace API'},...roles.results]}
}
