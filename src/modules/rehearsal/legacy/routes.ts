import {expectedOwnerEmail} from '../../legacy-import/adoption/authority'
import {Hono,type Context} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../../platform/env'
import type {RehearsalGrant} from '../types'
import {RehearsalError} from '../types'
import {machinePrincipal} from '../authority'
import {uploadManifest,uploadFile,packageStatus} from '../../legacy-import/package-in/routes'
import {readCustodyManifest,requireV2Capability} from '../../legacy-import/package-in/v2'
import {readBody,parseJson} from '../../legacy-import/package-in/body'
import {PackageError} from '../../legacy-import/package-in/errors'
import {CustodyError,renewCustody,getCustody,type CustodyPrincipal} from '../../legacy-import/custody'
import {getRun,enqueue,view,runAuthority,type Run} from '../../legacy-import/worker/state'
import {result} from '../../legacy-import/worker/result'
import {refuse} from '../../legacy-import/worker/errors'
import {LEGACY_LIMITS} from '../../legacy-import/worker-contract'
import {acceptLineage,getLineage,settleLegacyCopy,sourceBounds} from './lineage'
import {dbNow} from '../../legacy-import/lease'

const root='/projects/:setupProjectId/rehearsals/:id/copy/legacy/:sha'
function principal(g:RehearsalGrant):CustodyPrincipal{return {projectId:g.setup_project_id,actorId:g.owner_id,sessionHash:'',authorityMode:'rehearsal',rehearsalId:g.id,rehearsalGeneration:g.generation,rehearsalProjectId:g.legacy_project_id}}
async function identity(c:Context<AppEnv>){
 const g=await machinePrincipal(c),sha=c.req.param('sha')!
 if(!/^[a-f0-9]{64}$/.test(sha))refuse('invalid_request',400)
 if(c.req.header('X-Legacy-Contract-Version')!==undefined&&c.req.header('X-Legacy-Contract-Version')!=='2')refuse('unsupported_contract_version',422)
 if(c.req.query('excludeTables')!==undefined&&c.req.query('excludeTables')!=='ai_usages')refuse('run_options_conflict')
 await requireV2Capability(c.env)
 return {g,sha,p:principal(g)}
}
async function admitted(c:Context<AppEnv>,source=true){
 const v=await identity(c),l=await getLineage(c.env.DB,v.sha)
 if(!l||l.rehearsal_id!==v.g.id||l.rehearsal_generation!==v.g.generation||l.origin_sha256!==v.g.origin_sha||l.custody_project_id!==v.g.setup_project_id||l.source_project_id!==v.g.legacy_project_id)refuse('run_not_found',404)
 const manifest=source?await readCustodyManifest(c.env,v.g.setup_project_id,v.sha,v.p):null
 if(manifest){const b=sourceBounds(manifest);if(b.since!==l.since||b.cutoff!==l.source_cutoff||b.clock!==l.snapshot_clock||b.watermark!==l.watermark||manifest.source.projectId!==l.source_project_id||manifest.source.since!==l.since_iso||manifest.source.sourceCutoff!==l.source_cutoff_iso||manifest.source.snapshotClock!==l.snapshot_clock_iso||manifest.source.watermark!==l.watermark_iso)refuse('lineage_conflict')}
 return {...v,l,manifest,id:`legacy-package:${v.sha}`}
}
async function control(c:Context<AppEnv>,sha:string){
 const {bytes}=await readBody(c.req.raw,LEGACY_LIMITS.controlBytes,'invalid_request'),input=parseJson(bytes)
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>k!=='approvedManifestSha256')||(input as any).approvedManifestSha256!==sha)refuse('approval_mismatch')
}
async function commit(c:Context<AppEnv>,run:Parameters<typeof runAuthority>[0],statements:D1PreparedStatement[],expected?:Run){
 const a=runAuthority(run,expectedOwnerEmail(c.env))
 await c.env.DB.batch([c.env.DB.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT (${a.sql})${expected?" AND EXISTS(SELECT 1 FROM legacy_import_worker_runs WHERE id=? AND version=? AND state=?)":''}`).bind(...a.params,...(expected?[expected.id,expected.version,expected.state]:[])),...statements,c.env.DB.prepare('DELETE FROM ik_d1_assertions')])
}
export function createLegacyCopyRoutes(){
 const routes=new Hono<AppEnv>()
 routes.use(`${root}/*`,async(c,next)=>{c.header('Cache-Control','no-store');await next()})
 routes.onError((error,c)=>{
  c.header('Cache-Control','no-store')
  if(error instanceof HTTPException)return error.getResponse()
  if(error instanceof CustodyError||error instanceof PackageError||error instanceof RehearsalError)return c.json({code:error.code,error:error.code.replaceAll('_',' ')},error.status as 400)
  return c.json({code:'copy_unavailable',error:'Copy temporarily unavailable'},503)
 })
 routes.put(`${root}/manifest`,async c=>{
  const {g,sha,p}=await identity(c)
  return uploadManifest(c,p,g.setup_project_id,manifest=>acceptLineage(c.env,g,sha,manifest,c.req.header('X-Rehearsal-Day')))
 })
 routes.put(`${root}/files/:file`,async c=>{const {g,p}=await admitted(c);return uploadFile(c,p,g.setup_project_id)})
 routes.get(`${root}/status`,async c=>{const {g,p}=await admitted(c);return packageStatus(c,p,g.setup_project_id)})
 routes.post(`${root}/start`,async c=>{
  const {g,sha,p,id}=await admitted(c);await control(c,sha)
  let run=await getRun(c.env,id)
  if(run){
   if(run.authority_mode!=='rehearsal'||run.rehearsal_id!==g.id||run.rehearsal_generation!==g.generation)refuse('run_not_found',404)
   if(run.state==='complete')await settleLegacyCopy(c.env,sha)
   return c.json({data:view(run)})
  }
  const now=Date.now(),candidate={id,manifest_sha256:sha,contract_version:2,project_id:g.setup_project_id,source_project_id:g.legacy_project_id,actor_id:g.owner_id,session_hash:'',mode:'delta' as const,authority_mode:'rehearsal' as const,rehearsal_id:g.id,rehearsal_generation:g.generation}
  await commit(c,candidate,[c.env.DB.prepare(`INSERT INTO legacy_import_worker_runs(id,contract_version,manifest_sha256,project_id,source_project_id,actor_id,session_hash,authority_mode,rehearsal_id,rehearsal_generation,mode,exclude_json,state,phase,created_at,updated_at,started_at) VALUES(?,2,?,?,?,?,'','rehearsal',?,?,'delta','["ai_usages"]','queued','verify_package',?,?,?)`).bind(id,sha,g.setup_project_id,g.legacy_project_id,g.owner_id,g.id,g.generation,now,now,now)])
  run=(await getRun(c.env,id))!
  const h=(await getCustody(c.env.DB,sha))!;await renewCustody(c.env,{sha,generation:h.generation},p,'resume');await enqueue(c.env,run)
  return c.json({data:view(run)},202)
 })
 routes.post(`${root}/resume`,async c=>{
  const {g,sha,p,id}=await admitted(c);await control(c,sha)
  const run=await getRun(c.env,id)
  if(!run||run.authority_mode!=='rehearsal'||run.rehearsal_id!==g.id||run.rehearsal_generation!==g.generation)refuse('run_not_found',404)
  if(run.state==='complete'){await settleLegacyCopy(c.env,sha);return c.json({data:view(run)})}
  if(['running','queued'].includes(run.state))return c.json({data:view(run)})
  // Reopening is only within this still-live consent generation. Stop/Pause of
  // the rehearsal closes that generation and fails admission above.
  await commit(c,run,[c.env.DB.prepare(`UPDATE legacy_import_worker_runs SET state='queued',version=version+1,lease_token=NULL,lease_until=NULL,error_code=NULL,next_at=0,updated_at=${dbNow} WHERE id=? AND version=?`).bind(id,run.version)],run)
  const h=(await getCustody(c.env.DB,sha))!;await renewCustody(c.env,{sha,generation:h.generation},p,'resume')
  const resumed=(await getRun(c.env,id))!;await enqueue(c.env,resumed);return c.json({data:view(resumed)},202)
 })
 routes.get(`${root}/result`,async c=>{
  const {g,sha,id}=await admitted(c,false),run=await getRun(c.env,id)
  if(!run||run.authority_mode!=='rehearsal'||run.rehearsal_id!==g.id||run.rehearsal_generation!==g.generation)refuse('run_not_found',404)
  if(run.state==='complete')await settleLegacyCopy(c.env,sha)
  const {diagnostics,work,...scoped}=await result(c.env,run)
  return c.json({data:{...scoped,work:{unchanged:work.unchanged}}})
 })
 return routes
}
