import type {Env} from '../../../platform/env'
import {dbNow} from '../lease'
import {activeCustody,custodyPrincipal,scopeAllowed,custodyBatch,assertCustody} from './authority'
import {CustodyError,DAY,getCustody,validateSha,validateScope,type CustodyPrincipal,type CustodyHandle} from './types'
export interface Admission extends CustodyPrincipal {sha:string;sourceProjectId:string;destinationProjectId?:string;mappingPolicyVersion:2}
/** Called only after the bounded manifest has been hashed/validated in memory; stores no manifest content. */
export async function admitCustody(env:Pick<Env,'DB'>,input:Admission):Promise<CustodyHandle>{
 validateSha(input.sha);for(const id of [input.projectId,input.sourceProjectId,...(input.destinationProjectId?[input.destinationProjectId]:[])])validateScope(id)
 if(input.mappingPolicyVersion!==2)throw new CustodyError('unsupported_package',422)
 const a=custodyPrincipal(input),scopes=[...new Set([input.projectId,input.sourceProjectId,...(input.destinationProjectId?[input.destinationProjectId]:[])])]
 const scopePredicate=scopes.map((_,i)=>scopeAllowed(`?${i+1}`)).join(' AND ')
 const prior=await getCustody(env.DB,input.sha)
 if(prior){
  if(prior.custody_project_id!==input.projectId)throw new CustodyError('custody_conflict',404)
  if(prior.authority_mode!==(input.authorityMode??'session')||prior.rehearsal_id!==(input.rehearsalId??null)||prior.rehearsal_generation!==(input.rehearsalGeneration??null))throw new CustodyError('custody_conflict')
  if(prior.source_project_id!==input.sourceProjectId||prior.destination_project_id!==(input.destinationProjectId??null))throw new CustodyError('custody_conflict')
  const h={sha:input.sha,generation:prior.generation};await assertCustody(env,h,input);return h
 }
 const allowed=await env.DB.prepare(`SELECT (${a.sql}) ok`).bind(...a.params).first<{ok:number}>()
 if(!allowed?.ok)throw new CustodyError('import_authority_revoked',403)
 if(!(await env.DB.prepare(`SELECT (${scopePredicate}) ok`).bind(...scopes).first<{ok:number}>())?.ok)throw new CustodyError('source_invalidated')
 await env.DB.batch([
  env.DB.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT (${a.sql})`).bind(...a.params),
  env.DB.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT (${scopePredicate})`).bind(...scopes),
  env.DB.prepare(`INSERT OR IGNORE INTO legacy_package_custody(manifest_sha256,custody_project_id,source_project_id,destination_project_id,authority_mode,rehearsal_id,rehearsal_generation,status,mapping_policy_version,created_at,last_explicit_activity_at,expires_at,absolute_expires_at) VALUES(?,?,?,?,?,?,?,'admitting',2,${dbNow},${dbNow},${dbNow}+?,${dbNow}+?)`).bind(input.sha,input.projectId,input.sourceProjectId,input.destinationProjectId??null,input.authorityMode??'session',input.rehearsalId??null,input.rehearsalGeneration??null,DAY,7*DAY),
  env.DB.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT EXISTS(SELECT 1 FROM legacy_package_custody c WHERE manifest_sha256=? AND custody_project_id=? AND source_project_id=? AND destination_project_id IS ? AND c.authority_mode=? AND c.rehearsal_id IS ? AND c.rehearsal_generation IS ? AND ${activeCustody})`).bind(input.sha,input.projectId,input.sourceProjectId,input.destinationProjectId??null,input.authorityMode??'session',input.rehearsalId??null,input.rehearsalGeneration??null),
  env.DB.prepare("INSERT OR IGNORE INTO legacy_package_keys(manifest_sha256,key,kind,ordinal,generation) VALUES(?,?,'manifest',0,1)").bind(input.sha,`legacy-package/${input.sha}/manifest.json`),
  env.DB.prepare('DELETE FROM ik_d1_assertions'),
 ])
 return {sha:input.sha,generation:1}
}
export type KeyKind='manifest'|'chunk'|'context'|'object'
export function custodyKey(sha:string,kind:KeyKind,ordinal=0){
 validateSha(sha)
 if(!Number.isSafeInteger(ordinal)||ordinal<0||ordinal>999999)throw new CustodyError('invalid_request',400)
 const n=String(ordinal).padStart(6,'0'),file=kind==='chunk'?`rows-${n}.json`:kind==='context'?`context-${n}.json`:`object-${n}.bin`
 if(!['manifest','chunk','context','object'].includes(kind))throw new CustodyError('invalid_request',400)
 return kind==='manifest'?`legacy-package/${sha}/manifest.json`:`legacy-package/${sha}/${kind==='chunk'?'chunks':kind==='object'?'objects':'context'}/${file}`
}
/** Reject broad v1 filenames rather than renaming immutable package bytes. */
export function descriptorOrdinal(kind:Exclude<KeyKind,'manifest'>,file:string){
 const match=(kind==='chunk'?/^rows-(\d{6})\.json$/:kind==='context'?/^context-(\d{6})\.json$/:/^object-(\d{6})\.bin$/).exec(file)
 if(!match)throw new CustodyError('unsupported_package',422)
 return Number(match[1])
}
export async function registerKey(env:Pick<Env,'DB'>,h:CustodyHandle,p:CustodyPrincipal,kind:KeyKind,ordinal=0){
 const key=custodyKey(h.sha,kind,ordinal)
 await custodyBatch(env,h,p,[env.DB.prepare('INSERT OR IGNORE INTO legacy_package_keys(manifest_sha256,key,kind,ordinal,generation) VALUES(?,?,?,?,?)').bind(h.sha,key,kind,ordinal,h.generation)])
 return key
}
/** Adoption binds its destination under A's approval batch, using these statements plus custodyAssertion. */
export function destinationStatements(db:D1Database,h:CustodyHandle,destination:string){
 validateScope(destination)
 return [db.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT (${scopeAllowed('?1')})`).bind(destination),
 db.prepare('UPDATE legacy_package_custody SET destination_project_id=? WHERE manifest_sha256=? AND generation=? AND (destination_project_id IS NULL OR destination_project_id=?)').bind(destination,h.sha,h.generation,destination),
 db.prepare('INSERT INTO ik_d1_assertions(ok) SELECT EXISTS(SELECT 1 FROM legacy_package_custody WHERE manifest_sha256=? AND generation=? AND destination_project_id=?)').bind(h.sha,h.generation,destination)]
}
/** Explicit valid upload or committed progress only. Reads never renew retention. Complete follows scratch readiness. */
export async function renewCustody(env:Pick<Env,'DB'>,h:CustodyHandle,p:CustodyPrincipal,state:'upload'|'progress'|'paused'|'stopped'|'resume'|'complete'){
 const current=await assertCustody(env,h,p)
 // Valid repeated PUTs cannot turn a stopped/completed package back into partial upload,
 // nor extend its terminal replay window. Only an explicit resume starts new activity.
 if(!['upload','progress','paused','stopped','resume','complete'].includes(state))throw new CustodyError('invalid_request',400)
 if(state==='upload'&&current.retention_state!=='upload'||state!=='upload'&&state!=='progress'&&current.retention_state===state)return
 if(state==='resume'&&['upload','progress'].includes(current.retention_state))return
 if(state==='progress'&&['paused','stopped','complete'].includes(current.retention_state))throw new CustodyError('custody_conflict')
 const transition=env.DB.prepare(`UPDATE legacy_package_custody SET last_explicit_activity_at=${dbNow},expires_at=min(absolute_expires_at,${dbNow}+?),status='ready',retention_state=? WHERE manifest_sha256=? AND generation=? AND retention_state=?`).bind(state==='progress'?7*DAY:DAY,state,h.sha,h.generation,current.retention_state)
 await custodyBatch(env,h,p,[
  env.DB.prepare('INSERT INTO ik_d1_assertions(ok) SELECT EXISTS(SELECT 1 FROM legacy_package_custody WHERE manifest_sha256=? AND generation=? AND retention_state=?)').bind(h.sha,h.generation,current.retention_state),
  ...(state==='complete'?[env.DB.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT ${['legacy_import_context','legacy_import_context_messages','legacy_import_context_media','legacy_import_context_identities'].map(table=>`NOT EXISTS(SELECT 1 FROM ${table} WHERE run_id=?1)`).join(' AND ')}`).bind(`legacy-package:${h.sha}`)]:[]),transition,
 ])
}
