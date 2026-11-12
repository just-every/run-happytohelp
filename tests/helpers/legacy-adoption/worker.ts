import {Hono} from 'hono'
import type {AppEnv,Env} from '../../../src/platform/env'
import common from '../../journeys/kit/app-worker'
export {ConversationSocket} from '../../journeys/kit/app-worker'
import {createLegacyAdoptionRoutes,readAdoptionManifest} from '../../../src/modules/legacy-import/adoption/routes'
import {getAdoption,adoptionApply} from '../../../src/modules/legacy-import/adoption/store'
import {planImport,importLegacy,type PreparedSlice} from '../../../src/modules/legacy-import/importer'
import {stable,digest,type LegacyBundle,type Row} from '../../../src/modules/legacy-import/types'
import {takeDeltaLease} from '../../../src/modules/legacy-import/lease'
import {tableOrder} from '../../../src/modules/legacy-import/mapping'
import {chunkBundle,originalIdentity} from '../../../src/modules/legacy-import/worker/reader'
import {packageKey} from '../../../src/modules/legacy-import/worker/manifest'
import {countWork} from '../../../src/modules/legacy-import/worker/result'
import {knowledgeWriteEnvironment,planLegacyKnowledgeTargets} from '../../../src/modules/knowledge/write-boundary'
const router=new Hono<AppEnv>().route('/api/move-in',createLegacyAdoptionRoutes())

// Harness-only orchestration: the REAL approval router above is mounted with
// real native auth; this driver invokes the actual core and stored v2 hooks.
// C owns product worker control, bounded hydration and application registration.
export default {...common,async fetch(request:Request,env:Env,ctx:ExecutionContext){
 const path=new URL(request.url).pathname
 if(path.endsWith('/adoption')||path.endsWith('/adoption/approve'))return router.fetch(request,env,ctx)
 if(path==='/_test/adoption/drive'){
  let stage='manifest'
  try{
   const {sha,limit=1000,stopAfterApproval=false,revokeBeforeBatch=false,changeRunBeforeBatch=false,swapProfile=false}=await request.json<any>()
   const a=(await getAdoption(env.DB,sha))!,{manifest}=await readAdoptionManifest(env,sha,a.custody_project_id)
   const load=async(part:any,kind:'chunk'|'context')=>{
    const file=await env.FILES.get(packageKey(sha,kind,part.file));if(!file)throw new Error('missing test source')
    const bytes=new Uint8Array(await file.arrayBuffer());if(await digest(bytes)!==part.sha256||bytes.length!==part.bytes)throw new Error('invalid test source')
    return JSON.parse(new TextDecoder().decode(bytes)) as Row[]
   }
   const context:LegacyBundle={format:'happytohelp-legacy-v1',source:{...manifest.source,package:sha},tables:{}}
   for(const part of manifest.context)(context.tables[part.table]??=[]).push(...await load(part,'context'))
   // The stock exporter context omits project_users. The v2 worker must hydrate
   // staff role provenance from original rows too (C integration requirement).
   for(const part of manifest.chunks.filter(p=>['project_users','events'].includes(p.table)))(context.tables[part.table]??=[]).push(...await load(part,'chunk'))
   const wrapped=knowledgeWriteEnvironment(env,()=>({projectId:a.source_project_id})),lease=await takeDeltaLease(()=>env.DB,a.source_project_id)
   try{
    const workspace=await env.DB.prepare('SELECT token FROM legacy_delta_leases WHERE project_id=?').bind(a.source_project_id).first<{token:string}>()
    const run='legacy-package:'+sha,token=crypto.randomUUID()
    await env.DB.prepare(`INSERT INTO legacy_import_worker_runs(id,manifest_sha256,project_id,source_project_id,actor_id,session_hash,contract_version,mode,exclude_json,state,phase,version,lease_token,lease_until,created_at,updated_at) VALUES(?,?,?,?,?,?,2,'full','[]','running','rows',1,?,?,1,1) ON CONFLICT(id) DO UPDATE SET session_hash=excluded.session_hash,state='running',version=version+1,lease_token=excluded.lease_token,lease_until=excluded.lease_until`).bind(run,sha,a.custody_project_id,a.source_project_id,a.approver_id,a.session_hash,token,Date.now()+60000).run()
    const row=await env.DB.prepare('SELECT version FROM legacy_import_worker_runs WHERE id=?').bind(run).first<{version:number}>()
    const adoption=await adoptionApply(env,sha,{runId:run,version:row!.version,leaseToken:token,workspaceToken:workspace!.token,approvalVersion:a.approval_version})
    const keys=new Set(manifest.objects.map(o=>o.key)),parts=[...manifest.chunks].sort((a,b)=>(tableOrder.includes(a.table)?tableOrder.indexOf(a.table):1000)-(tableOrder.includes(b.table)?tableOrder.indexOf(b.table):1000))
    const plans=[];stage='preflight'
    for(const part of parts){stage='preflight:'+part.table;const rows=await load(part,'chunk'),bundle=chunkBundle(manifest,sha,part,rows),identity=await originalIdentity(manifest,sha,part,rows),prepared:PreparedSlice={identity,finalize:false,normalize:targets=>planLegacyKnowledgeTargets(wrapped,a.source_project_id,targets)};await importLegacy(wrapped,bundle,{context,adoption,lease,prepared,objectKeys:keys,checkOnly:true});plans.push({bundle,prepared})}
    const before=await countWork(env);let applied=0,replayed=0,partsApplied=0
    if(stopAfterApproval)return Response.json({preflight:true,before})
    if(revokeBeforeBatch)await env.DB.prepare('UPDATE sessions SET revoked_at=1 WHERE token_hash=?').bind(a.session_hash).run()
    if(changeRunBeforeBatch)await env.DB.prepare('UPDATE legacy_import_worker_runs SET version=version+1 WHERE id=?').bind(run).run()
    for(const planned of plans.slice(0,limit)){
     const {prepared}=planned;let bundle=planned.bundle
     if(bundle.tables.media){const objects=[];for(const object of manifest.objects){const file=await env.FILES.get(packageKey(sha,'object',object.file));if(!file)throw new Error('missing test attachment');const bytes=new Uint8Array(await file.arrayBuffer());if(await digest(bytes)!==object.sha256)throw new Error('invalid test attachment');let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);objects.push({key:object.key,dataBase64:btoa(binary),sha256:object.sha256})}bundle={...bundle,objects}}
     stage='apply:'+Object.keys(bundle.tables)[0];const result=await importLegacy(wrapped,bundle,{context,adoption:swapProfile?undefined:adoption,lease,prepared,objectKeys:bundle.objects?undefined:keys})
     applied+=result.applied;replayed+=result.replayed;partsApplied++
    }
    return Response.json({applied,replayed,partsApplied,before,after:await countWork(env)})
   }finally{await lease.release()}
  }catch(error){return Response.json({stage,code:error instanceof Error?error.message:'drive_refused'},{status:409})}
 }
 return common.fetch(request,env,ctx)
}}
