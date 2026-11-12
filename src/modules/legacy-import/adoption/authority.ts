import type {Actor, AppEnv, Env} from '../../../platform/env'
import type {Context} from 'hono'
import type {SqlGuard} from '../../../platform/integration-authority'
import {requireActor} from '../../../platform/auth'
import {memberAccess} from '../../access/gate'
import {dbNow} from '../lease'
import {refuse} from './errors'

export interface AdoptionPrincipal {actorId:string; sessionHash:string; setupProjectId:string; expectedEmail:string}
export function expectedOwnerEmail(env:Env){const value=env.H2H_SETUP_OWNER_EMAIL||env.OWNER_EMAIL;return typeof value==='string'?value.trim().toLowerCase():''}

/** The native setup audit binds the original workspace to the durable first-user
 * claim. Neither an arbitrary owned workspace nor matching email selects it.
 * Missing/ambiguous original native evidence fails closed, including upgrades. */
export function firstOwnerPredicate(p:AdoptionPrincipal):SqlGuard {
 return {sql:`SELECT 1 FROM owner_setup o JOIN users u ON u.id=o.claim_id
 JOIN sessions s ON s.actor_id=u.id
 JOIN memberships m ON m.user_id=u.id AND m.project_id=s.project_id
 JOIN projects native ON native.id=m.project_id
 LEFT JOIN session_factors sf ON sf.token_hash=s.token_hash AND sf.user_id=u.id
 WHERE o.singleton=1 AND o.claim_id<>'existing-installation' AND u.id=?
 AND s.token_hash=? AND s.project_id=? AND s.role='owner' AND m.role='owner'
 AND s.revoked_at IS NULL AND s.expires_at>${dbNow}
 AND (?='' OR lower(trim(u.email))=?)
 AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=m.project_id AND
  (json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL OR json_extract(ps.settings_json,'$.suspended_at') IS NOT NULL))
 AND (NOT EXISTS(SELECT 1 FROM user_factors f WHERE f.user_id=u.id AND f.confirmed_at IS NOT NULL)
  AND NOT EXISTS(SELECT 1 FROM project_settings ps,json_each(json_extract(ps.settings_json,'$.two_factor_roles')) r WHERE ps.project_id=m.project_id AND r.value='owner')
  OR sf.method IN ('totp','webauthn','recovery','installation'))
 AND EXISTS(SELECT 1 FROM audit_events a WHERE a.actor_id=u.id AND a.action='owner.created'
  AND a.category='access' AND a.outcome='succeeded' AND a.source='dashboard' AND a.target_id=u.id AND a.project_id=m.project_id)
 AND 1=(SELECT count(DISTINCT a.project_id) FROM audit_events a WHERE a.actor_id=u.id AND a.action='owner.created'
  AND a.category='access' AND a.outcome='succeeded' AND a.source='dashboard' AND a.target_id=u.id)
 AND NOT EXISTS(SELECT 1 FROM h2h_business_project b WHERE b.singleton=1 AND (b.project_id<>m.project_id OR b.owner_user_id<>u.id))`,params:[p.actorId,p.sessionHash,p.setupProjectId,p.expectedEmail,p.expectedEmail]}
}
export async function requireInstallationOwner(c:Context<AppEnv>,setupProjectId:string):Promise<{actor:Actor;principal:AdoptionPrincipal}>{
 const actor=await requireActor(c)
 const claim=await c.env.DB.prepare("SELECT claim_id FROM owner_setup WHERE singleton=1").first<{claim_id:string}>()
 if(!claim||claim.claim_id==='existing-installation')refuse('installation_owner_binding_required')
 if(actor.role!=='owner'||claim.claim_id!==actor.id||actor.projectId!==setupProjectId)refuse('installation_owner_required',403)
 const access=await memberAccess(c.env.DB,setupProjectId,actor.id)
 if(!access?.permissions.has('data.import'))refuse('permission_denied',403)
 const principal={actorId:actor.id,sessionHash:c.get('sessionHash'),setupProjectId,expectedEmail:expectedOwnerEmail(c.env)}
 const guard=firstOwnerPredicate(principal)
 if(!await c.env.DB.prepare(guard.sql).bind(...guard.params).first())refuse('installation_owner_binding_required')
 return {actor,principal}
}
