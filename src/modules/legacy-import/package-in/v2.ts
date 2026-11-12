import type {Env} from '../../../platform/env'
import {assertCustody,getCustody,sourceReady,descriptorOrdinal,CustodyError,type CustodyPrincipal} from '../custody'
import type {LegacyPackageManifest} from '../worker-contract'
import {readManifest} from '../worker/reader'
import {refuse} from './errors'
export function uploadPrincipal(c:any):CustodyPrincipal {const a=c.get('actor');return {projectId:c.req.param('projectId'),actorId:a.id,sessionHash:c.get('sessionHash')}}
export function validateV2Manifest(m:LegacyPackageManifest){
 if(m.source.rowCounts.projects!==1||m.chunks.filter(p=>p.table==='projects').reduce((n,p)=>n+p.count,0)!==1)refuse(422,'invalid_scope','Expected exactly one source workspace')
 for(const [kind,parts] of [['chunk',m.chunks],['context',m.context],['object',m.objects]] as const)for(const p of parts)descriptorOrdinal(kind,p.file)
 return m
}
export async function packageCustody(env:Env,projectId:string,sha:string,p:CustodyPrincipal){
 const c=await getCustody(env.DB,sha)
 if(!c||c.custody_project_id!==projectId)throw new CustodyError('custody_conflict',404)
 const h={sha,generation:c.generation};await assertCustody(env,h,p);return h
}
export async function readCustodyManifest(env:Env,projectId:string,sha:string,p?:CustodyPrincipal){
 const c=await getCustody(env.DB,sha)
 if(!c||c.custody_project_id!==projectId)throw new CustodyError('custody_conflict',404)
 // Mounted readers supply the current principal; the adoption reader is called
 // only after A's first-owner door has authenticated that same setup session.
 if(p){const h=await packageCustody(env,projectId,sha,p),o=await env.FILES.head(`legacy-package/${sha}/manifest.json`);if(!o||!await sourceReady(env,h,p,'manifest',0,sha,o.size))throw new CustodyError('custody_conflict')}
 else if(!await env.DB.prepare(`SELECT 1 FROM legacy_package_custody c WHERE manifest_sha256=? AND ${activeCustody}`).bind(sha).first())throw new CustodyError('source_invalidated')
 return validateV2Manifest(await readManifest(env.FILES,sha,projectId,2))
}
import {activeCustody} from '../custody'
export async function readAdoptionReview(env:Env,sha:string,setup:string){try{const manifest=await readCustodyManifest(env,setup,sha);return {manifest,sourceRetentionDeadline:(await getCustody(env.DB,sha))!.expires_at}}catch(error){if(error instanceof CustodyError)refuse(error.status,error.code,error.code.replaceAll('_',' '));throw error}}

/** Schema is a capability boundary, checked before retaining any new source. */
export async function requireV2Capability(env:Env){
 try{await env.DB.prepare('SELECT c.generation,c.mapping_policy_version,c.retention_state,a.approval_version,p.profile_json,r.contract_version,k.cleanup_state,f.cleanup_done FROM legacy_package_custody c LEFT JOIN legacy_workspace_adoptions a ON a.manifest_sha256=c.manifest_sha256 LEFT JOIN legacy_import_mapping_profiles p ON 0 LEFT JOIN legacy_import_worker_runs r ON r.manifest_sha256=c.manifest_sha256 LEFT JOIN legacy_package_keys k ON k.manifest_sha256=c.manifest_sha256 LEFT JOIN legacy_package_scope_fences f ON f.project_id=c.custody_project_id WHERE 0').first()}catch{refuse(503,'database_unavailable','Legacy adoption and custody migrations must be installed before package intake')}
}
