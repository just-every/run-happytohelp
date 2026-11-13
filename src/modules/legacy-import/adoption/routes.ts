import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv, Env} from '../../../platform/env'
import {requireStepUp} from '../../identity/two-factor/step-up'
import {LEGACY_LIMITS, LEGACY_ROUTE, type LegacyPackageManifest} from '../worker-contract'
import {readBody,parseJson} from '../package-in/body'
import {PackageError} from '../package-in/errors'
import {checksum} from '../worker/reader'
import {validateManifest,packageKey,hex256} from '../worker/manifest'
import {refuse} from './errors'
import {requireInstallationOwner} from './authority'
import {approveAdoption,getAdoption} from './store'
import {releasableReservation} from './reservation'

/** C supplies B's current custody read/fence here. The default reads immutable
 * v2 manifest bytes only; this router is deliberately NOT mounted in the app. */
export interface AdoptionReviewSource {manifest:LegacyPackageManifest;sourceRetentionDeadline:number|null}
export type AdoptionReviewReader=(env:Env,sha:string,custodyProjectId:string)=>Promise<AdoptionReviewSource>
export async function readAdoptionManifest(env:Env,sha:string,custodyProjectId:string):Promise<AdoptionReviewSource>{
 const object=await env.FILES.get(packageKey(sha,'manifest'))
 if(!object||object.customMetadata?.projectId!==custodyProjectId)refuse('package_not_found',404)
 if(object.customMetadata?.contractVersion!=='2')refuse('unsupported_contract_version',422)
 if(object.customMetadata?.manifestSha256!==sha)refuse('custody_conflict')
 if(object.size>LEGACY_LIMITS.manifestBytes)refuse('manifest_too_large',413)
 const {bytes,sha256}=await readBody(new Request('https://legacy.invalid/manifest',{method:'POST',body:object.body}),LEGACY_LIMITS.manifestBytes,'manifest_too_large',object.size)
 if(sha256!==sha||checksum(object)!==sha)refuse('digest_mismatch',422)
 const manifest=validateManifest(parseJson(bytes))
 if(manifest.source.rowCounts.projects!==1||manifest.chunks.filter(p=>p.table==='projects').reduce((n,p)=>n+p.count,0)!==1)refuse('invalid_scope',422)
 for(const [list,pattern] of [[manifest.chunks,/^rows-\d{6}\.json$/],[manifest.context,/^context-\d{6}\.json$/],[manifest.objects,/^object-\d{6}\.bin$/]] as const)if(list.some(p=>!pattern.test(p.file)))refuse('unsupported_package',422)
 return {manifest,sourceRetentionDeadline:null}
}
const publicApproval=(a:Awaited<ReturnType<typeof getAdoption>>)=>a?{policyVersion:a.policy_version,approvalVersion:a.approval_version,state:a.state,approvedAt:a.approved_at}:null
export function createLegacyAdoptionRoutes(readReview:AdoptionReviewReader=readAdoptionManifest){
 const routes=new Hono<AppEnv>(),root=LEGACY_ROUTE+'/:sha/adoption'
 routes.onError((error,c)=>{
  c.header('Cache-Control','no-store')
  if(error instanceof HTTPException)return error.getResponse()
  if(error instanceof PackageError)return c.json({error:error.message,code:error.code},error.status as 400)
  return c.json({error:'Adoption storage unavailable',code:'database_unavailable'},503)
 })
 routes.use(root+'*',async(c,next)=>{c.header('Cache-Control','no-store');if(!hex256(c.req.param('sha')))refuse('invalid_request',400);await next()})
 routes.get(root,async c=>{
  await requireInstallationOwner(c,c.req.param('projectId')!)
  const sha=c.req.param('sha')!,setup=c.req.param('projectId')!,{manifest,sourceRetentionDeadline}=await readReview(c.env,sha,setup)
  const adoption=await getAdoption(c.env.DB,sha),exists=!!await c.env.DB.prepare('SELECT 1 FROM projects WHERE id=?').bind(manifest.source.projectId).first()
  const reserved=!!await c.env.DB.prepare(`SELECT 1 FROM legacy_workspace_adoptions a WHERE source_project_id=? AND manifest_sha256<>? AND NOT (${releasableReservation})`).bind(manifest.source.projectId,sha).first()
  return c.json({data:{manifestSha256:sha,custodyProjectId:setup,sourceProjectId:manifest.source.projectId,destinationProjectId:manifest.source.projectId,policyVersion:2,canApprove:!reserved&&(!exists||adoption?.state==='created'),collision:reserved||exists&&adoption?.state!=='created'?'destination_conflict':null,staffRows:manifest.source.rowCounts.users??0,historicalMembershipRows:(manifest.source.rowCounts.project_users??0)+(manifest.source.rowCounts.memberships??0),membershipPolicy:'historical memberships; no access created',sourceRetentionDeadline,adoption:publicApproval(adoption),erasedScopePolicy:'Legacy intake is unavailable after an erasure in an involved workspace'}})
 })
 routes.post(root+'/approve',async c=>{
  if(c.req.header('Origin')!==new URL(c.req.url).origin||c.req.header('Sec-Fetch-Site')==='cross-site')refuse('origin_refused',403)
  const sha=c.req.param('sha')!,setup=c.req.param('projectId')!,{actor,principal}=await requireInstallationOwner(c,setup)
  await requireStepUp(c,actor,'legacy.adoption')
  const {bytes}=await readBody(c.req.raw,LEGACY_LIMITS.controlBytes,'control_too_large'),body=parseJson(bytes,'invalid_request') as Record<string,unknown>
  if(!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).some(k=>!['approvedManifestSha256','sourceProjectId','policyVersion'].includes(k))||body.policyVersion!==2)refuse('invalid_request',400)
  if(body.approvedManifestSha256!==sha)refuse('approval_mismatch')
  const {manifest}=await readReview(c.env,sha,setup)
  if(body.sourceProjectId!==manifest.source.projectId)refuse('approval_mismatch')
  const approval=await approveAdoption(c.env.DB,principal,sha,manifest.source.projectId)
  return c.json({data:{manifestSha256:sha,custodyProjectId:setup,destinationProjectId:manifest.source.projectId,adoption:publicApproval(approval),requiresPreflight:true}},202)
 })
 return routes
}
