import {recordOrigin} from './provenance'
import type {Context} from 'hono'
import type {AppEnv} from '../../platform/env'
import {hashToken} from '../../platform/auth'
import {firstOwnerPredicate,requireInstallationOwner} from '../legacy-import/adoption/authority'
import {requireStepUp} from '../identity/two-factor/step-up'
import {acceptedOrigin,acceptedZendesk} from './review'
import {installationId,rehearsalPredicate} from './authority'
import {rehearsalAudit} from './audit'
import {getGrant} from './store'
import {grantRef,reject,type RehearsalGrant} from './types'
export async function createGrant(c:Context<AppEnv>,input:Record<string,unknown>){
 const setup=c.req.param('setupProjectId')!,{actor,principal}=await requireInstallationOwner(c,setup)
 if(!actor.security?.hasFactor)reject('two_factor_setup_required',403)
 await requireStepUp(c,actor,'rehearsal.grant',{factor:true})
 if(Object.keys(input).some(k=>!['originManifestSha256','zendeskProjectId','zendeskPullId','copierId','expiresAt'].includes(k))||typeof input.originManifestSha256!=='string'||!/^[a-f0-9]{64}$/.test(input.originManifestSha256)||typeof input.zendeskProjectId!=='string'||typeof input.zendeskPullId!=='string'||typeof input.copierId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(input.copierId))reject('invalid_request',400)
 const now=Date.now(),expiry=Number(input.expiresAt)
 if(!Number.isSafeInteger(expiry)||expiry<=now||expiry>now+14*86400000)reject('finite_expiry_required',400)
 const origin=await acceptedOrigin(c.env,setup,actor.id,input.originManifestSha256),z=await acceptedZendesk(c.env,actor.id,input.zendeskProjectId,input.zendeskPullId)
 const identity=await c.env.DB.prepare("SELECT lower(trim(u.email)) email,coalesce(e.epoch,0) epoch,coalesce((SELECT json_extract(settings_json,'$.two_factor_roles') FROM project_settings WHERE project_id=?),'[]') factor_policy FROM users u LEFT JOIN identity_recovery_epochs e ON e.user_id=u.id WHERE u.id=?").bind(setup,actor.id).first<{email:string;epoch:number;factor_policy:string}>()
 if(!identity)reject('installation_owner_binding_required')
 const bytes=crypto.getRandomValues(new Uint8Array(32)),credential='hhr_'+Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join(''),id=crypto.randomUUID()
 const g:RehearsalGrant={id,generation:1,setup_project_id:setup,owner_id:actor.id,issuing_session_hash:principal.sessionHash,installation_id:installationId(c.env),app_origin:new URL(c.req.url).origin,owner_epoch:identity.epoch,owner_proof_at:actor.security.factorAt!,owner_proof_method:actor.security.factorMethod!,owner_email:identity.email,configured_owner_email:principal.expectedEmail,factor_policy:identity.factor_policy,origin_sha:origin.a.manifest_sha256,legacy_project_id:origin.a.source_project_id,legacy_watermark:origin.watermark,legacy_cutoff:origin.cutoff,legacy_watermark_iso:String(origin.source.watermark),legacy_cutoff_iso:String(origin.source.sourceCutoff),legacy_enabled:1,zendesk_project_id:z.connection.project_id,zendesk_subdomain:z.connection.subdomain,zendesk_connection_generation:z.connection.generation,zendesk_client_id:z.connection.client_id,zendesk_connected_at:z.connection.connected_at,zendesk_base_pull_id:z.pull.id,zendesk_cursor_json:z.pull.resume_json!,zendesk_enabled:1,copier_id:input.copierId,credential_hash:await hashToken(credential),expiry_at:expiry,started_at:now,created_at:now,state:'active',closed_at:null,closure_reason:null,active_day:null,cleanup_state:'pending',cleanup_at:null}
 const owner=firstOwnerPredicate(principal),live=rehearsalPredicate(grantRef(g),g.legacy_project_id,'legacy',principal.expectedEmail),zendesk=rehearsalPredicate(grantRef(g),g.zendesk_project_id,'zendesk',principal.expectedEmail)
 try{await c.env.DB.batch([
  c.env.DB.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT EXISTS(${owner.sql})`).bind(...owner.params),
  recordOrigin(c.env.DB,origin.provenance),
  c.env.DB.prepare(`INSERT INTO rehearsal_grants(${Object.keys(g).join(',')}) VALUES(${Object.keys(g).map(()=>'?').join(',')})`).bind(...Object.values(g)),
  c.env.DB.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT EXISTS(${live.sql}) AND EXISTS(${zendesk.sql}) AND EXISTS(SELECT 1 FROM legacy_import_worker_runs WHERE manifest_sha256=? AND state='complete' AND verified_at IS NOT NULL) AND EXISTS(SELECT 1 FROM move_in_zendesk_pulls WHERE id=? AND state='applied' AND resume_json=? AND error IS NULL)`).bind(...live.params,...zendesk.params,g.origin_sha,g.zendesk_base_pull_id,g.zendesk_cursor_json),
  rehearsalAudit(c.env.DB,g,'granted',{copier:g.copier_id,origin:g.origin_sha,expiry:expiry,ownerEpoch:g.owner_epoch,proofAt:g.owner_proof_at,proofMethod:g.owner_proof_method}),c.env.DB.prepare('DELETE FROM ik_d1_assertions')])
 }catch{reject('consent_scope_conflict')}
 return {grant:(await getGrant(c.env,id))!,credential}
}
