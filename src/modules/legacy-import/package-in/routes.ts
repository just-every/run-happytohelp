import {Hono} from 'hono'
import {createMiddleware} from 'hono/factory'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../../platform/env'
import {importActor} from '../../move-in/routes'
import {enforceRole} from '../../access/gate'
// @ts-expect-error The shared exporter classifier is JavaScript; use its exact policy.
import {classifySnapshot} from '../../../../scripts/legacy-export/secrets.mjs'
import {LEGACY_CONTRACT_VERSION,LEGACY_LIMITS,LEGACY_ROUTE} from '../worker-contract'
import {CustodyError,admitCustody,putCustody,descriptorOrdinal,sourceReady,getCustody,assertCustody} from '../custody'
import {checksum} from '../worker/reader'
import {packageCustody,readCustodyManifest,uploadPrincipal,validateV2Manifest,requireV2Capability} from './v2'
import {PackageError,refuse} from './errors'
import {parseJson,readBody} from './body'
import {descriptors,exclusions,inventory,safeFile,storageKey,validateManifest} from './manifest'
import {requireSha} from './storage'

export const packageInRoutes=new Hono<AppEnv>()
const root=`${LEGACY_ROUTE}/:sha`
packageInRoutes.onError((error,c)=>{
 c.header('Cache-Control','no-store')
 if(error instanceof HTTPException)return error.res?error.getResponse():c.json({error:error.message},error.status)
 if(error instanceof CustodyError)return c.json({error:error.code.replaceAll('_',' '),code:error.code},error.status as 400)
 if(error instanceof PackageError)return c.json({error:error.message,code:error.code},error.status as 400)
 return c.json({error:'Package storage is temporarily unavailable',code:'storage_unavailable'},503)
})
// Intake owns uploads and inventory; runner controls retain their own admission.
const intake=createMiddleware<AppEnv>(async(c,next)=>{
 c.header('Cache-Control','no-store')
 try{await importActor(c);await enforceRole(c,c.get('actor'),'data.import')}catch(error){if(error instanceof HTTPException)throw error;refuse(503,'database_unavailable','Workspace authorization is temporarily unavailable')}
 const version=c.req.header('X-Legacy-Contract-Version')
 if(version!==undefined&&version!==String(LEGACY_CONTRACT_VERSION))refuse(422,'unsupported_package','Unsupported package contract version')
 await requireV2Capability(c.env)
 requireSha(c.req.param('sha')!)
 await next()
})
packageInRoutes.put(`${root}/manifest`,intake,async c=>{
 if(c.req.header('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')refuse(415,'unsupported_media_type','Manifest must be application/json')
 const sha=c.req.param('sha')!,projectId=c.req.param('projectId')!
 if(c.req.header('X-Manifest-SHA256')!==sha)refuse(409,'approval_mismatch','Approved manifest fingerprint differs')
 const {bytes,sha256}=await readBody(c.req.raw,LEGACY_LIMITS.manifestBytes,'manifest_too_large')
 if(sha256!==sha)refuse(422,'digest_mismatch','Manifest bytes differ from its fingerprint')
 const manifest=validateV2Manifest(validateManifest(parseJson(bytes))),principal=uploadPrincipal(c)
 const handle=await admitCustody(c.env,{...principal,sha,sourceProjectId:manifest.source.projectId,destinationProjectId:manifest.source.projectId,mappingPolicyVersion:2})
 const {alreadyPresent}=await putCustody(c.env,handle,principal,{kind:'manifest',body:bytes,sha256:sha,bytes:bytes.length,takeover:true})
 return c.json({data:{manifestSha256:sha,runId:`legacy-package:${sha}`,projectId,sourceProjectId:manifest.source.projectId,alreadyPresent}},alreadyPresent?200:201)
})
packageInRoutes.put(`${root}/files/:file`,intake,async c=>{
 if(c.req.header('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/octet-stream')refuse(415,'unsupported_media_type','Package files must be application/octet-stream')
 const sha=c.req.param('sha')!,projectId=c.req.param('projectId')!,file=c.req.param('file')!
 if(!safeFile(file))refuse(400,'invalid_filename','Invalid package filename')
 const manifest=await readCustodyManifest(c.env,projectId,sha,uploadPrincipal(c)),part=descriptors(manifest).find(p=>p.file===file)
 if(!part)refuse(400,'invalid_filename','File is not listed in the manifest')
 if(part.kind==='chunk'&&exclusions(c.req.query('excludeTables')).includes(part.table!))refuse(409,'excluded_file','AI usage history is omitted from this upload')
 const {bytes,sha256}=await readBody(c.req.raw,part.kind==='object'?LEGACY_LIMITS.objectBytes:LEGACY_LIMITS.partBytes,part.kind==='object'?'object_too_large':'part_too_large',part.bytes)
 if(sha256!==part.sha256)refuse(422,'digest_mismatch','File bytes differ from its manifest')
 if(part.kind!=='object'){
  const rows=parseJson(bytes,'invalid_request')
  if(!Array.isArray(rows)||rows.length!==part.count)refuse(422,'row_count_mismatch','File row count differs from its manifest')
  if(rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)))refuse(422,'invalid_scope','Expected source rows')
  try{classifySnapshot({tables:{[part.table!]:rows}})}catch{refuse(422,'source_policy_refused','File refused by the source secret policy. Re-export with credentials omitted.')}
 }
 const handle=await packageCustody(c.env,projectId,sha,uploadPrincipal(c))
 const {alreadyPresent}=await putCustody(c.env,handle,uploadPrincipal(c),{kind:part.kind,ordinal:descriptorOrdinal(part.kind,file),body:bytes,sha256,bytes:bytes.length,takeover:true})
 return c.json({data:{file,kind:part.kind,bytes:bytes.length,sha256,alreadyPresent}},alreadyPresent?200:201)
})
packageInRoutes.get(`${root}/status`,intake,async c=>{
 const sha=c.req.param('sha')!,projectId=c.req.param('projectId')!,exclude=exclusions(c.req.query('excludeTables'))
 const manifest=await readCustodyManifest(c.env,projectId,sha,uploadPrincipal(c)),{files,excluded}=inventory(manifest,exclude)
 const rawLimit=c.req.query('limit'),limit=rawLimit===undefined?100:Number(rawLimit)
 if(!Number.isInteger(limit)||limit<1||limit>LEGACY_LIMITS.statusPage)refuse(400,'invalid_request','Invalid status page size')
 const binding=`${sha}:${exclude.join(',')}:`,raw=c.req.query('cursor');let offset=0
 if(raw){try{const decoded=atob(raw);if(!decoded.startsWith(binding)||!/^\d+$/.test(decoded.slice(binding.length)))throw Error();offset=Number(decoded.slice(binding.length));if(!Number.isSafeInteger(offset)||offset>files.length)throw Error()}catch{refuse(400,'invalid_cursor','Invalid package status cursor')}}
 const handle=await packageCustody(c.env,projectId,sha,uploadPrincipal(c)),slice=files.slice(offset,offset+limit)
 const keys=await c.env.DB.prepare('SELECT key FROM legacy_package_keys WHERE manifest_sha256=? AND generation=? AND cleanup_state=0 AND key IN (SELECT value FROM json_each(?))').bind(sha,handle.generation,JSON.stringify(slice.map(part=>storageKey(sha,part)))).all<{key:string}>(),registered=new Set(keys.results.map(row=>row.key))
 const page={checkedFiles:0,presentFiles:0,presentBytes:0},missing=[]
 for(const part of slice){
  const object=await c.env.FILES.head(storageKey(sha,part));page.checkedFiles++
  if(object&&registered.has(object.key)&&object.customMetadata?.custodyBody==='accepted'&&object.customMetadata?.manifestSha256===sha&&object.customMetadata?.custodyProjectId===projectId&&object.customMetadata?.custodyGeneration===String(handle.generation)&&object.size===part.bytes&&checksum(object)===part.sha256){page.presentFiles++;page.presentBytes+=part.bytes}
  else missing.push({kind:part.kind,file:part.file,bytes:part.bytes,sha256:part.sha256,reason:!object||object.customMetadata?.custodyBody!=='accepted'?'missing':object.size!==part.bytes?'size_mismatch':'checksum_mismatch'})
 }
 await assertCustody(c.env,handle,uploadPrincipal(c))
 const next=offset+limit
 return c.json({data:{manifestSha256:sha,runId:`legacy-package:${sha}`,projectId,sourceProjectId:manifest.source.projectId,expectedFiles:files.length,expectedBytes:files.reduce((n,p)=>n+p.bytes,0),excluded,page,missing,nextCursor:next<files.length?btoa(binding+next):null}})
})
