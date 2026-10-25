import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {scope} from './common'
import {issuerGuard} from '../../platform/integration-authority'
import {requireStepUp} from '../identity/two-factor/step-up'
import {auditStatement,requestSource} from '../audit/record'
import {endHandleTimers} from '../reports/timers'

export const memberErasure=new Hono<AppEnv>()
/** Erase an installation account only when this workspace owns its sole membership.
 * Owners must transfer ownership first. Cross-workspace accounts require separate
 * installation review; a workspace owner cannot erase another workspace's member.
 */
memberErasure.post('/projects/:projectId/agents/:userId/erase',async c=>{
 const actor=await scope(c,true),userId=c.req.param('userId')
 if(actor.role!=='owner'||actor.id===userId)throw new HTTPException(403)
 await requireStepUp(c,actor,'member.erase')
 const guard=await issuerGuard(c.env,{actor:{...actor,role:'owner'},sessionHash:c.get('sessionHash')}),now=Date.now()
 const eligible="EXISTS(SELECT 1 FROM memberships WHERE user_id=? AND project_id=? AND role<>'owner') AND (SELECT count(*) FROM memberships WHERE user_id=?)=1 AND NOT EXISTS(SELECT 1 FROM platform_admins WHERE user_id=?)"
 const args=[userId,actor.projectId,userId,userId]
 if(!await c.env.DB.prepare('SELECT 1 WHERE '+eligible).bind(...args).first())throw new HTTPException(409,{message:'Transfer ownership first; accounts shared with other workspaces or installation administrators require installation review'})
 await c.env.DB.batch([
  c.env.DB.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT CASE WHEN EXISTS(${guard.sql}) AND ${eligible} THEN 1 ELSE 0 END`).bind(...guard.params,...args),
  c.env.DB.prepare('DELETE FROM registrations WHERE lower(email)=(SELECT lower(email) FROM users WHERE id=?)').bind(userId),
  c.env.DB.prepare('DELETE FROM identity_tokens WHERE user_id=? OR lower(email)=(SELECT lower(email) FROM users WHERE id=?)').bind(userId,userId),
  // Retain opaque ids for referential integrity and machine names for ticket history.
  c.env.DB.prepare("UPDATE users SET name='Former teammate',email='erased:'||id WHERE id=?").bind(userId),
  c.env.DB.prepare("INSERT INTO integration_token_events(namespace,id,token_id,at,action,feature) SELECT namespace,lower(hex(randomblob(16))),id,?,'revoked','integrations.tokens' FROM integration_tokens WHERE issuer_id=? AND namespace=? AND revoked_at IS NULL").bind(now,userId,actor.projectId),
  c.env.DB.prepare("INSERT INTO native_integration_audit(id,project_id,actor_id,action,resource_id,created_at) SELECT lower(hex(randomblob(16))),namespace,?,'token.revoke',id,? FROM integration_tokens WHERE issuer_id=? AND namespace=? AND revoked_at IS NULL").bind(actor.id,now,userId,actor.projectId),
  c.env.DB.prepare("UPDATE integration_tokens SET issuer_id=NULL,revoked_at=coalesce(revoked_at,?),token_hash='erased:'||id WHERE issuer_id=? AND namespace=?").bind(now,userId,actor.projectId),
  ...['credentials','user_settings','user_factors','recovery_codes','session_factors','webauthn_challenges','identity_tokens','magic_signins','user_project_preferences','member_roles','operator_presence'].map(table=>c.env.DB.prepare(`DELETE FROM ${table} WHERE user_id=?`).bind(userId)),
  c.env.DB.prepare('DELETE FROM sessions WHERE actor_id=? AND role<>\'contact\'').bind(userId),
  c.env.DB.prepare('DELETE FROM conversation_followers WHERE user_id=?').bind(userId),
  endHandleTimers(c.env.DB,actor.projectId,userId,now),
  c.env.DB.prepare('DELETE FROM memberships WHERE user_id=?').bind(userId),
  auditStatement(c.env.DB,{projectId:actor.projectId,category:'erasure',action:'member.erased',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'member',id:userId}},now),
  c.env.DB.prepare('DELETE FROM ik_d1_assertions')
 ])
 return c.json({erased:true,credentialsRevoked:true,eventsRetained:true})
})
