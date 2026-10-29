import {HTTPException} from 'hono/http-exception'
import type {Context} from 'hono'
import type {Actor,AppEnv,Env} from '../../platform/env'
import {hashToken} from '../../platform/auth'
import {memberAccess} from '../access/gate'
import type {Permission} from '../access/catalogue'
import {pendingFactor,policyRoles,type FactorMethod} from '../identity/two-factor/state'

export const scopePermissions={read:null,notes:'conversations.notes',reply:'conversations.reply',assign:'conversations.manage',attachments:null,knowledge:'knowledge.edit',approval:'conversations.reply',push:null} as const
export type MobileScope=keyof typeof scopePermissions
export const clockSql="CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)"
// Changes to membership, role definition, factor enrolment or factor policy retire a
// device's authority. A later role restoration must not revive an offline session.
export const authoritySnapshotSql=(s='s')=>`json_object('role',${s}.role,
 'roleKey',(SELECT role_key FROM member_roles WHERE project_id=${s}.project_id AND user_id=${s}.actor_id),
 'roleVersion',(SELECT pr.updated_at FROM member_roles mr JOIN project_roles pr ON pr.id=mr.role_key AND pr.project_id=mr.project_id WHERE mr.project_id=${s}.project_id AND mr.user_id=${s}.actor_id),
 'policy',(SELECT json_extract(settings_json,'$.two_factor_roles') FROM project_settings WHERE project_id=${s}.project_id),
 'factor',EXISTS(SELECT 1 FROM user_factors WHERE user_id=${s}.actor_id AND confirmed_at IS NOT NULL),
 'method',(SELECT method FROM session_factors WHERE token_hash=${s}.token_hash))`
export const liveDeviceSql=`SELECT d.*,s.role FROM mobile_devices d JOIN sessions s ON s.token_hash=d.parent_session_hash
 JOIN memberships m ON m.project_id=d.project_id AND m.user_id=d.user_id AND m.role=s.role
 WHERE d.revoked_at IS NULL AND d.expires_at>${clockSql} AND s.revoked_at IS NULL AND s.expires_at>${clockSql}
 AND s.actor_id=d.user_id AND s.project_id=d.project_id AND s.role<>'contact'
 AND d.authority_json=${authoritySnapshotSql()}
 AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=d.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL)`
export interface Device {id:string;token_hash:string;parent_session_hash:string;project_id:string;user_id:string;role:Actor['role'];platform:'ios'|'android';scopes_json:string;expires_at:number;authority_json:string;push_enabled:number}
export interface MobileAuthority {device:Device;actor:Actor;guard:{sql:string;params:unknown[]}}
export function invalidDevice():never{throw new HTTPException(401,{res:Response.json({error:'Device access ended. Sign in again.',code:'mobile_session_invalid',purge:true},{status:401,headers:{'Cache-Control':'no-store','Mobile-Cache-Action':'purge'}})})}
export async function retireDevice(env:Env,id:string){await env.DB.batch([
 env.DB.prepare('UPDATE mobile_devices SET revoked_at=coalesce(revoked_at,?),push_enabled=0 WHERE id=?').bind(Date.now(),id),
 env.DB.prepare('DELETE FROM mobile_frontiers WHERE device_id=?').bind(id),
 env.DB.prepare('DELETE FROM mobile_links WHERE device_id=?').bind(id),
])}
export async function deviceAuthority(env:Env,device:Device,scope:MobileScope='read'):Promise<MobileAuthority>{
 const row=await env.DB.prepare(`${liveDeviceSql} AND d.id=?`).bind(device.id).first<Device>()
 if(!row){await retireDevice(env,device.id);invalidDevice()}
 const snapshot=JSON.parse(row.authority_json),access=await memberAccess(env.DB,row.project_id,row.user_id)
 if(!access||pendingFactor({factorAt:null,factorMethod:snapshot.method as FactorMethod|null,hasFactor:!!snapshot.factor,required:policyRoles(snapshot.policy).includes(access.base),installation:false})){
  await retireDevice(env,row.id);invalidDevice()
 }
 const scopes:MobileScope[]=JSON.parse(row.scopes_json),permission=scopePermissions[scope]
 if(!scopes.includes(scope)||permission&&!access.permissions.has(permission)||scope==='attachments'&&!['conversations.notes','conversations.reply'].some(p=>access.permissions.has(p as Permission)))throw new HTTPException(403,{message:'This device does not have permission for this operation'})
 const actor:Actor={id:row.user_id,projectId:row.project_id,role:row.role}
 return {device:row,actor,guard:{sql:`EXISTS(${liveDeviceSql} AND d.id=? AND d.authority_json=? AND d.scopes_json=?)`,params:[row.id,row.authority_json,row.scopes_json]}}
}
export async function mobileActor(c:Context<AppEnv>,scope:MobileScope='read'){
 // No cookie, query token, native-session or API-token fallback on this surface.
 const authorization=c.req.header('Authorization')||''
 if(!/^Bearer mob_[a-f0-9]{64}$/.test(authorization))invalidDevice()
 const row=await c.env.DB.prepare('SELECT * FROM mobile_devices WHERE token_hash=?').bind(await hashToken(authorization.slice(7))).first<Device>()
 if(!row)invalidDevice()
 return deviceAuthority(c.env,row,scope)
}
export async function stillAuthorized(env:Env,authority:MobileAuthority){if(!await env.DB.prepare(`SELECT 1 WHERE ${authority.guard.sql}`).bind(...authority.guard.params).first())invalidDevice()}
