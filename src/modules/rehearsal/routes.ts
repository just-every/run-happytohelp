import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {Context} from 'hono'
import type {AppEnv} from '../../platform/env'
import {requireActor} from '../../platform/auth'
import {requireInstallationOwner} from '../legacy-import/adoption/authority'
import {LEGACY_LIMITS} from '../legacy-import/worker-contract'
import {readBody,parseJson} from '../legacy-import/package-in/body'
import {PackageError} from '../legacy-import/package-in/errors'
import {getGrant,closeGrant} from './store'
import {createGrant} from './grant'
import {acceptedOrigin} from './review'
import {grantStatus} from './status'
import {machinePrincipal,assertRehearsal} from './authority'
import {cleanupRehearsal} from './lifecycle'
import {grantRef,RehearsalError,reject,type RehearsalGrant} from './types'
import {createLegacyCopyRoutes} from './legacy/routes'
import {createZendeskCopyRoutes} from './zendesk/routes'
import {recordRefusal} from './audit'
const root='/projects/:setupProjectId/rehearsals'
export const rehearsalRoutes=new Hono<AppEnv>()
rehearsalRoutes.onError((error,c)=>{c.header('Cache-Control','no-store');if(error instanceof RehearsalError)return c.json({code:error.code,error:error.code.replaceAll('_',' ')},error.status as 400);if(error instanceof PackageError)return c.json({code:error.code,error:error.message},error.status as 400);if(error instanceof HTTPException)return error.getResponse();return c.json({code:'rehearsal_unavailable',error:'Daily copy status is unavailable'},503)})
rehearsalRoutes.use(root+'*',async(c,next)=>{c.header('Cache-Control','no-store');await next();await recordRefusal(c)})
const sameOrigin=(c:Context<AppEnv>)=>{if(c.req.header('Origin')!==new URL(c.req.url).origin||c.req.header('Sec-Fetch-Site')==='cross-site')reject('origin_refused',403)}
async function body(c:Context<AppEnv>){const {bytes}=await readBody(c.req.raw,LEGACY_LIMITS.controlBytes,'control_too_large'),b=parseJson(bytes,'invalid_request');if(!b||typeof b!=='object'||Array.isArray(b))reject('invalid_request',400);return b as Record<string,unknown>}
/** Only reduction/status survives destination inactivity. The native original
 * owner anchor remains mandatory; this path grants no import capability. */
async function owned(c:Context<AppEnv>){
 const actor=await requireActor(c),setup=c.req.param('setupProjectId')!,g=await getGrant(c.env,c.req.param('id')!)
 if(!g||g.setup_project_id!==setup||g.owner_id!==actor.id||!await c.env.DB.prepare("SELECT 1 FROM owner_setup o WHERE o.singleton=1 AND o.claim_id=? AND o.claim_id<>'existing-installation' AND EXISTS(SELECT 1 FROM audit_events WHERE actor_id=o.claim_id AND target_id=o.claim_id AND action='owner.created' AND category='access' AND outcome='succeeded' AND source='dashboard' AND project_id=?) AND 1=(SELECT count(DISTINCT project_id) FROM audit_events WHERE actor_id=o.claim_id AND target_id=o.claim_id AND action='owner.created' AND category='access' AND outcome='succeeded' AND source='dashboard')").bind(actor.id,setup).first())reject('installation_owner_required',403)
 return g
}
async function reconcile(c:Context<AppEnv>,g:RehearsalGrant){if(g.state==='active')try{if(g.legacy_enabled)await assertRehearsal(c.env,grantRef(g),g.legacy_project_id,'legacy');if(g.zendesk_enabled)await assertRehearsal(c.env,grantRef(g),g.zendesk_project_id,'zendesk')}catch{/* Status shows the durable closure reason. */}return (await getGrant(c.env,g.id))!}
rehearsalRoutes.get(root,async c=>{
 const setup=c.req.param('setupProjectId')!,{actor}=await requireInstallationOwner(c,setup)
 const owner=await c.env.DB.prepare('SELECT email FROM users WHERE id=?').bind(actor.id).first<{email:string}>()
 const adoptions=(await c.env.DB.prepare("SELECT a.manifest_sha256,a.source_project_id,r.verified_at FROM legacy_workspace_adoptions a JOIN legacy_import_worker_runs r ON r.manifest_sha256=a.manifest_sha256 WHERE a.custody_project_id=? AND a.approver_id=? AND a.state='created' AND r.state='complete' AND r.mode='full' AND r.verified_at IS NOT NULL ORDER BY a.created_at DESC LIMIT 20").bind(setup,actor.id).all<{manifest_sha256:string;source_project_id:string;verified_at:number}>()).results
 const adoptionViews=[]
 for(const a of adoptions){let provenance=null;try{provenance=await acceptedOrigin(c.env,setup,actor.id,a.manifest_sha256)}catch{/* Purged or unqualified source is shown as unavailable, never guessed. */}adoptionViews.push({manifestSha256:a.manifest_sha256,destinationProjectId:a.source_project_id,verifiedAt:a.verified_at,sourceClockReady:!!provenance,legacyWatermark:provenance?.source.watermark??null,legacyCutoff:provenance?.source.sourceCutoff??null})}
 const connections=(await c.env.DB.prepare("SELECT c.project_id projectId,c.subdomain,c.generation connectionGeneration,p.id pullId,p.resume_json acceptedCursor FROM move_in_zendesk_connections c JOIN memberships m ON m.project_id=c.project_id AND m.user_id=? AND m.role='owner' JOIN move_in_zendesk_pulls p ON p.project_id=c.project_id AND p.subdomain=c.subdomain AND p.state='applied' AND p.error IS NULL AND p.resume_json IS NOT NULL WHERE c.state='connected' AND p.authority_mode='session' ORDER BY p.created_at DESC LIMIT 20").bind(actor.id).all<any>()).results.map(row=>({...row,acceptedCursor:JSON.parse(row.acceptedCursor)}))
 const grants=(await c.env.DB.prepare('SELECT * FROM rehearsal_grants WHERE setup_project_id=? AND owner_id=? ORDER BY created_at DESC LIMIT 20').bind(setup,actor.id).all<RehearsalGrant>()).results
 return c.json({data:{setupProjectId:setup,installationId:String(c.env.RER_INSTALLATION_ID||c.env.RER_OWNER_CLAIM_INSTALLATION_ID||'local'),appOrigin:new URL(c.req.url).origin,owner:{id:actor.id,email:owner?.email},adoptions:adoptionViews,connections,grants:await Promise.all(grants.map(async g=>grantStatus(c.env,await reconcile(c,g))))}})
})
rehearsalRoutes.post(root,async c=>{sameOrigin(c);const created=await createGrant(c,await body(c));return c.json({data:{grant:await grantStatus(c.env,created.grant),credential:created.credential}},201)})
rehearsalRoutes.get(root+'/:id',async c=>c.json({data:await grantStatus(c.env,await reconcile(c,await owned(c)))}))
rehearsalRoutes.post(root+'/:id/stop',async c=>{sameOrigin(c);const g=await owned(c);await body(c);await closeGrant(c.env,g,'owner_stopped');return c.json({data:await grantStatus(c.env,(await getGrant(c.env,g.id))!)},202)})
rehearsalRoutes.post(root+'/:id/cleanup',async c=>{sameOrigin(c);const g=await owned(c);await body(c);if(g.state!=='closed')reject('rehearsal_still_active');await cleanupRehearsal(c.env,g.id);return c.json({data:await grantStatus(c.env,(await getGrant(c.env,g.id))!)})})
rehearsalRoutes.post(root+'/:id/copy/stop',async c=>{const g=await machinePrincipal(c);await body(c);await closeGrant(c.env,g,'copier_stopped');return c.json({data:{id:g.id,state:'closed'}},202)})
rehearsalRoutes.route('/',createLegacyCopyRoutes())
rehearsalRoutes.route('/',createZendeskCopyRoutes())
