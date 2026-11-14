import type {Context} from 'hono'
import type {AppEnv,Env} from '../../platform/env'
import type {SqlGuard} from '../../platform/integration-authority'
import {hashToken} from '../../platform/auth'
import {expectedOwnerEmail} from '../legacy-import/adoption/authority'
import {dbNow} from '../legacy-import/lease'
import {scopeAllowed} from '../legacy-import/custody/scope'
import {getGrant,closeGrant} from './store'
import {grantRef,reject,type RehearsalGrant,type RehearsalRef} from './types'

/** Detached consent uses the same durable native anchor as adoption. It never
 * substitutes a fabricated session for the interactive firstOwnerPredicate. */
interface StoredRef {idSql:string;generationSql:string;projectSql:string}
export function rehearsalPredicate(ref:RehearsalRef,projectId:string,component:'legacy'|'zendesk',expectedEmail?:string,stored?:StoredRef):SqlGuard {
 const destination=component==='legacy'?'g.legacy_project_id':'g.zendesk_project_id'
 const sql=`SELECT 1 FROM rehearsal_grants g JOIN owner_setup o ON o.singleton=1 AND o.claim_id=g.owner_id
 JOIN users u ON u.id=o.claim_id JOIN projects native ON native.id=g.setup_project_id
 JOIN memberships m ON m.project_id=native.id AND m.user_id=u.id AND m.role='owner'
 JOIN projects destination ON destination.id=${destination}
 JOIN memberships dm ON dm.project_id=destination.id AND dm.user_id=u.id AND dm.role='owner'
 JOIN legacy_workspace_adoptions a ON a.manifest_sha256=g.origin_sha AND a.custody_project_id=g.setup_project_id
  AND a.source_project_id=g.legacy_project_id AND a.approver_id=g.owner_id AND a.state='created' AND a.policy_version=2
 WHERE g.id=${stored?.idSql??'?'} AND g.generation=${stored?.generationSql??'?'} AND g.state='active' AND g.credential_hash IS NOT NULL
 AND g.expiry_at>${dbNow} AND g.started_at<=${dbNow} AND g.${component}_enabled=1 AND ${destination}=${stored?.projectSql??'?'}
 AND o.claim_id<>'existing-installation' AND lower(trim(u.email))=g.owner_email
 AND (? IS NULL OR g.configured_owner_email=?) AND (g.configured_owner_email='' OR g.owner_email=g.configured_owner_email)
 AND coalesce((SELECT epoch FROM identity_recovery_epochs WHERE user_id=g.owner_id),0)=g.owner_epoch
 AND coalesce((SELECT json_extract(settings_json,'$.two_factor_roles') FROM project_settings WHERE project_id=g.setup_project_id),'[]')=g.factor_policy
 AND NOT EXISTS(SELECT 1 FROM sessions WHERE token_hash=g.issuing_session_hash AND (revoked_at IS NOT NULL OR actor_id<>g.owner_id OR project_id<>g.setup_project_id OR role<>'owner'))
 AND EXISTS(SELECT 1 FROM audit_events e WHERE e.actor_id=u.id AND e.action='owner.created' AND e.category='access' AND e.outcome='succeeded' AND e.source='dashboard' AND e.target_id=u.id AND e.project_id=native.id)
 AND 1=(SELECT count(DISTINCT e.project_id) FROM audit_events e WHERE e.actor_id=u.id AND e.action='owner.created' AND e.category='access' AND e.outcome='succeeded' AND e.source='dashboard' AND e.target_id=u.id)
 AND NOT EXISTS(SELECT 1 FROM h2h_business_project b WHERE b.singleton=1 AND (b.project_id<>native.id OR b.owner_user_id<>u.id))
 AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id IN (g.setup_project_id,g.legacy_project_id,g.zendesk_project_id) AND (json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL OR json_extract(ps.settings_json,'$.suspended_at') IS NOT NULL))
 AND NOT EXISTS(SELECT 1 FROM agent_door_state s WHERE s.id=1 AND (s.local_paused=1 OR (s.envelope IS NOT NULL AND (NOT json_valid(s.envelope) OR coalesce(json_extract(s.envelope,'$.paused'),0)=1 OR coalesce(json_extract(s.envelope,'$.exp'),0)*1000<=${dbNow} OR EXISTS(SELECT 1 FROM json_each(s.envelope,'$.revoked.agents') WHERE value=g.copier_id) OR EXISTS(SELECT 1 FROM json_each(s.envelope,'$.revoked.consents') WHERE value=g.id)))))
 AND NOT EXISTS(SELECT 1 FROM bs_settings WHERE singleton=1 AND stopped=1)
 AND NOT EXISTS(SELECT 1 FROM agent_door_agents WHERE id=g.copier_id AND revoked=1)
 ${component==='legacy'?`AND ${scopeAllowed('g.setup_project_id')} AND ${scopeAllowed('g.legacy_project_id')}`:`AND EXISTS(SELECT 1 FROM move_in_zendesk_connections c WHERE c.project_id=g.zendesk_project_id AND c.subdomain=g.zendesk_subdomain AND c.generation=g.zendesk_connection_generation AND c.client_id=g.zendesk_client_id AND c.connected_at=g.zendesk_connected_at AND c.state='connected')`}`
 // D1 caps expression depth. Balance these fixed top-level conjunctions so
 // composing custody/run fences preserves every check within that bound.
 const at=sql.indexOf('\n WHERE '),parts=sql.slice(at+8).split('\n AND ')
 const join=(items:string[]):string=>items.length===1?`(${items[0]})`:`(${join(items.slice(0,Math.ceil(items.length/2)))} AND ${join(items.slice(Math.ceil(items.length/2)))})`
 return {sql:sql.slice(0,at)+' WHERE '+join(parts),params:[...(stored?[]:[ref.rehearsal_id,ref.rehearsal_generation,projectId]),expectedEmail??null,expectedEmail??null]}
}
/** Correlated references are fixed server SQL coordinates, never request input. */
export function rehearsalStoredPredicate(ref:StoredRef,component:'legacy'|'zendesk',expectedEmail?:string){return rehearsalPredicate({rehearsal_id:'',rehearsal_generation:0},'',component,expectedEmail,ref)}
export async function assertRehearsal(env:Env,ref:RehearsalRef,projectId:string,component:'legacy'|'zendesk'){
 const g=await getGrant(env,ref.rehearsal_id)
 if(!g||g.generation!==ref.rehearsal_generation||g.state!=='active')reject('rehearsal_closed',403)
 const a=rehearsalPredicate(ref,projectId,component,expectedOwnerEmail(env))
 const origin=typeof env.APP_ORIGIN==='string'?new URL(env.APP_ORIGIN).origin:g.app_origin
 if(g.app_origin!==origin||g.installation_id!==installationId(env)||!await env.DB.prepare(a.sql).bind(...a.params).first()){
  await closeGrant(env,g,g.expiry_at<=Date.now()?'expired':'authority_changed');reject('rehearsal_closed',403)
 }
 return g
}
export function installationId(env:Env){return String(env.RER_INSTALLATION_ID||env.RER_OWNER_CLAIM_INSTALLATION_ID||'local')}
/** This bearer is admitted only here, never by requireActor or the MCP door. */
export async function machinePrincipal(c:Context<AppEnv>):Promise<RehearsalGrant>{
 const token=c.req.header('Authorization')?.match(/^Bearer (hhr_[a-f0-9]{64})$/)?.[1]
 if(!token)reject('copy_credential_required',401)
 const g=await getGrant(c.env,c.req.param('id')!)
 if(!g||g.setup_project_id!==c.req.param('setupProjectId')||g.app_origin!==new URL(c.req.url).origin||g.credential_hash!==await hashToken(token))reject('copy_credential_required',401)
 // Component-specific routes repeat their own component assertion. Stop is
 // reduction-only and can still authenticate an expired but not-yet-closed row.
 if(!c.req.path.endsWith('/stop'))await assertRehearsal(c.env,grantRef(g),c.req.path.includes('/copy/zendesk')?g.zendesk_project_id:g.legacy_project_id,c.req.path.includes('/copy/zendesk')?'zendesk':'legacy')
 return g
}
