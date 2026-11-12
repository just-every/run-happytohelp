import type {Env} from '../../../platform/env'
import type {SqlGuard} from '../../../platform/integration-authority'
import {LEGACY_LIMITS} from '../worker-contract'
import {validateManifest,descriptors,storageKey} from '../package-in/manifest'
import {dbNow} from '../lease'
import {CustodyError,getCustody,validateSha,type Custody} from './types'
const prefix=(sha:string)=>`legacy-package/${sha}/`
/** v1 is read only to recover cleanup coordinates. No source row/account mapping. */
async function legacyManifest(env:Pick<Env,'FILES'>,sha:string){
 const object=await env.FILES.get(prefix(sha)+'manifest.json')
 if(!object||object.size>LEGACY_LIMITS.manifestBytes||object.customMetadata?.contractVersion!=='1')throw new CustodyError('unsupported_package',422)
 const bytes=await object.arrayBuffer(),digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('')
 if(digest!==sha||object.customMetadata.manifestSha256!==sha)throw new CustodyError('digest_mismatch',422)
 const manifest=validateManifest(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)))
 const project=object.customMetadata.projectId
 if(!project)throw new CustodyError('custody_conflict')
 return {manifest,project}
}
/** Atomic terminal closure comes BEFORE page one. Existing tombstones never reopen.
 * The manifest and every listed descriptor are retained until seeding completes. */
export async function beginLegacyCleanup(env:Pick<Env,'DB'|'FILES'>,sha:string,projectId?:string,authority?:SqlGuard){
 validateSha(sha)
 const prior=await getCustody(env.DB,sha)
 if(prior){if(projectId&&prior.custody_project_id!==projectId)throw new CustodyError('custody_conflict',404);if(!prior.cleanup_only)throw new CustodyError('custody_conflict');return prior}
 const {manifest,project}=await legacyManifest(env,sha)
 if(projectId&&project!==projectId)throw new CustodyError('custody_conflict',404)
 await env.DB.batch([
  ...(authority?[env.DB.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT EXISTS(${authority.sql})`).bind(...authority.params!)]:[]),
  env.DB.prepare(`INSERT OR IGNORE INTO legacy_package_custody(manifest_sha256,custody_project_id,source_project_id,status,mapping_policy_version,created_at,last_explicit_activity_at,expires_at,absolute_expires_at,purge_reason,closed_at,cleanup_only,seeding_complete) VALUES(?,?,?,'invalidated',2,${dbNow},${dbNow},${dbNow},${dbNow},'discarded',${dbNow},1,0)`).bind(sha,project,manifest.source.projectId),
  env.DB.prepare('INSERT INTO ik_d1_assertions(ok) SELECT EXISTS(SELECT 1 FROM legacy_package_custody WHERE manifest_sha256=? AND cleanup_only=1 AND custody_project_id=? AND source_project_id=?)').bind(sha,project,manifest.source.projectId),
  env.DB.prepare('INSERT OR IGNORE INTO legacy_package_v1_seeds(manifest_sha256) VALUES(?)').bind(sha),
  env.DB.prepare(`UPDATE legacy_import_worker_runs SET version=version+1,state=CASE WHEN state='complete' THEN state ELSE 'stopped' END,error_code='source_invalidated',session_hash='',lease_token=NULL,lease_until=NULL,cursor_json='{}',metrics_json='{}',objects_json='{}' WHERE manifest_sha256=?`).bind(sha),
  env.DB.prepare('DELETE FROM ik_d1_assertions'),
 ])
 return (await getCustody(env.DB,sha))!
}
/** One bounded old-prefix discovery. New uploads cannot create v1 prefixes.
 * A malformed/orphaned old prefix keeps inventory pending, never erasure success. */
export async function seedLegacyInventory(env:Pick<Env,'DB'|'FILES'>){
 const state=await env.DB.prepare('SELECT * FROM legacy_package_v1_inventory WHERE singleton=1').first<{list_cursor:string;complete:number}>()
 if(!state||state.complete)return
 const page=await env.FILES.list({prefix:'legacy-package/',delimiter:'/',limit:1,...(state.list_cursor?{cursor:state.list_cursor}:{})})
 for(const directory of page.delimitedPrefixes){
  const sha=directory.slice('legacy-package/'.length,-1);validateSha(sha)
  if(!await getCustody(env.DB,sha)&&!await env.DB.prepare('SELECT 1 FROM legacy_import_worker_runs WHERE manifest_sha256=?').bind(sha).first())await beginLegacyCleanup(env,sha)
 }
 // Unexpected keys outside a SHA directory cannot be silently skipped.
 if(page.objects.length)throw new CustodyError('source_cleanup_pending')
 await env.DB.prepare('UPDATE legacy_package_v1_inventory SET list_cursor=?,complete=? WHERE singleton=1 AND list_cursor=? AND complete=0').bind(page.truncated?page.cursor:'',page.truncated?0:1,state.list_cursor).run()
}
/** Called under the same cleanup claim. <=100 coordinates registered per page.
 * Cursor + coordinates commit together; duplicate/lost wakes only repeat a page. */
export async function seedLegacyPage(env:Pick<Env,'DB'|'FILES'>,c:Custody,token:string){
 const seed=await env.DB.prepare('SELECT * FROM legacy_package_v1_seeds WHERE manifest_sha256=?').bind(c.manifest_sha256).first<{phase:string;manifest_offset:number;list_cursor:string}>()
 if(!seed)throw new CustodyError('source_cleanup_pending')
 const sha=c.manifest_sha256,keys:Array<{key:string;kind:string;ordinal:number}>=[]
 let phase=seed.phase,offset=seed.manifest_offset,cursor=seed.list_cursor
 if(phase==='manifest'){
  const {manifest,project}=await legacyManifest(env,sha)
  if(project!==c.custody_project_id||manifest.source.projectId!==c.source_project_id)throw new CustodyError('custody_conflict')
  const all=[{key:prefix(sha)+'manifest.json',kind:'manifest',ordinal:0},...descriptors(manifest).map((p,i)=>({key:storageKey(sha,p),kind:p.kind,ordinal:i}))]
  keys.push(...all.slice(offset,offset+100));offset+=keys.length
  if(offset>=all.length)phase='listing'
 }else if(phase==='listing'){
  const page=await env.FILES.list({prefix:prefix(sha),limit:100,...(cursor?{cursor}:{})})
  keys.push(...page.objects.map((o,i)=>({key:o.key,kind:o.key.endsWith('/manifest.json')?'manifest':'object',ordinal:i})))
  cursor=page.truncated?page.cursor:'';if(!page.truncated)phase='complete'
 }
 await env.DB.batch([
  env.DB.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT EXISTS(SELECT 1 FROM legacy_package_custody WHERE manifest_sha256=? AND cleanup_only=1 AND generation=? AND cleanup_token=? AND cleanup_until>${dbNow} AND seeding_complete=0)`).bind(sha,c.generation,token),
  env.DB.prepare('INSERT OR IGNORE INTO legacy_package_keys(manifest_sha256,key,kind,ordinal,generation) SELECT ?,json_extract(value,\'$.key\'),json_extract(value,\'$.kind\'),json_extract(value,\'$.ordinal\'),? FROM json_each(?)').bind(sha,c.generation,JSON.stringify(keys)),
  env.DB.prepare('UPDATE legacy_package_v1_seeds SET phase=?,manifest_offset=?,list_cursor=? WHERE manifest_sha256=?').bind(phase,offset,cursor,sha),
  env.DB.prepare('UPDATE legacy_package_custody SET seeding_complete=? WHERE manifest_sha256=?').bind(phase==='complete'?1:0,sha),
  env.DB.prepare('DELETE FROM ik_d1_assertions'),
 ])
 return {keys:0,rows:keys.length,pending:true}
}

/** Existing synthetic v1 runs keep their interpretation until explicit erasure.
 * Discover their known indexed scope before final completion, one run per call. */
export async function seedLegacyScopeRun(env:Pick<Env,'DB'|'FILES'>,projectId:string){
 const row=await env.DB.prepare(`SELECT manifest_sha256 FROM legacy_import_worker_runs r WHERE r.manifest_sha256 IN (
 SELECT manifest_sha256 FROM legacy_import_worker_runs WHERE project_id=?1 AND contract_version=1
 UNION SELECT manifest_sha256 FROM legacy_import_worker_runs WHERE source_project_id=?1 AND contract_version=1)
 AND NOT EXISTS(SELECT 1 FROM legacy_package_custody c WHERE c.manifest_sha256=r.manifest_sha256) ORDER BY manifest_sha256 LIMIT 1`).bind(projectId).first<{manifest_sha256:string}>()
 if(row)await beginLegacyCleanup(env,row.manifest_sha256)
}
