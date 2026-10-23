import type {Context} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../../platform/env'
import {scope} from '../../management/common'
import {requireStepUp} from '../two-factor/step-up'
import {auditStatement} from '../../audit/record'
import {hashToken} from '../../../platform/auth'
import {base64url} from '../../integrations/mailboxes/http'

export type Connection={id:string;project_id:string;protocol:'oidc'|'saml';issuer:string;config_json:string;secret_cipher:string|null;scim_hash:string|null;enabled:number;version:number}
export type Principal={id:string;connection_id:string;project_id:string;external_id:string;user_id:string;user_name:string;display_name:string;active:number}
export const random=()=>base64url(crypto.getRandomValues(new Uint8Array(32)))
export const text=(v:unknown,max=300)=>{if(typeof v!=='string'||!v.trim()||v.length>max||/[\x00-\x1f]/.test(v))throw new HTTPException(400,{message:'Invalid identity setting'});return v.trim()}
export const email=(v:unknown)=>{const value=text(v,320).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))throw new HTTPException(400,{message:'A valid userName email is required'});return value}
export async function owner(c:Context<AppEnv>,purpose?:string){const actor=await scope(c,true);if(actor.role!=='owner')throw new HTTPException(403,{message:'Only the native workspace owner manages enterprise identity'});if(purpose)await requireStepUp(c,actor,purpose);return actor}
export async function connection(c:Context<AppEnv>,id=c.req.param('connectionId')){const row=await c.env.DB.prepare("SELECT ec.* FROM enterprise_connections ec WHERE ec.id=? AND ec.enabled=1 AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=ec.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL)").bind(id).first<Connection>();if(!row)throw new HTTPException(404,{message:'Identity connection unavailable'});return row}
export function audit(c:Context<AppEnv>,row:Connection,action:string,userId?:string,outcome:'succeeded'|'refused'='succeeded'){return auditStatement(c.env.DB,{projectId:row.project_id,category:'access',action,outcome,actor:{type:userId?'user':'system',...(userId?{id:userId}:{})},source:'api',target:{type:'identity_connection',id:row.id}})}
export async function scimConnection(c:Context<AppEnv>){const row=await connection(c),token=c.req.header('Authorization')?.match(/^Bearer ([^\s]+)$/)?.[1];if(!token||!row.scim_hash||await hashToken(token)!==row.scim_hash)throw new HTTPException(401,{message:'SCIM credential required'});return row}
// Deactivation removes workspace authority in the same transaction. Reactivation
// does not restore an old role, session, approval or grant.
export function revoke(db:D1Database,row:Connection,userId?:string){const where=userId?' AND user_id=?':'',args=userId?[row.id,userId]:[row.id],users=`SELECT user_id FROM enterprise_principals WHERE connection_id=?${where}`;return [
 db.prepare(`UPDATE sessions SET revoked_at=? WHERE project_id=? AND actor_id IN (${users})`).bind(Date.now(),row.project_id,...args),
 db.prepare(`UPDATE edition_grants SET revoked_at=?,token_hash=NULL WHERE project_id=? AND principal_id IN (${users})`).bind(Date.now(),row.project_id,...args),
 db.prepare(`DELETE FROM member_roles WHERE project_id=? AND user_id IN (${users})`).bind(row.project_id,...args),
 db.prepare(`DELETE FROM memberships WHERE project_id=? AND role<>'owner' AND user_id IN (${users})`).bind(row.project_id,...args),
 db.prepare(`UPDATE enterprise_principals SET active=0,updated_at=? WHERE connection_id=?${where}`).bind(Date.now(),...args),
 ]}
