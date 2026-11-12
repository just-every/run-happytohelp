import type {Env} from '../../../platform/env'
import type {SqlGuard} from '../../../platform/integration-authority'
import type {AdoptionPrincipal} from './authority'
import {firstOwnerPredicate, expectedOwnerEmail} from './authority'
import type {HistoricalAdoptionProfile} from './profile'
import {dbNow} from '../lease'
import {stable,type MappedRow} from '../types'
import {refuse} from './errors'
import {legacyWorkspaceDefaults} from '../../management/provisioning/legacy-workspace'
import {readStates,stateKey,unchangedSinceImport} from '../state'
import {sqlName} from '../d1'

export interface AdoptionRecord {
 manifest_sha256:string; custody_project_id:string; source_project_id:string
 approver_id:string; session_hash:string; policy_version:2; approval_version:number
 state:'reserved'|'created'; approved_at:number; created_at:number|null
}
export const getAdoption=(db:D1Database,sha:string)=>db.prepare('SELECT * FROM legacy_workspace_adoptions WHERE manifest_sha256=?').bind(sha).first<AdoptionRecord>()
/** Caller must already authorize a native read of this exact workspace/target. */
export const readActorOrigins=(db:D1Database,projectId:string,table:string,targetId:string)=>db.prepare('SELECT field,source_user_id,display_name FROM legacy_actor_origins WHERE project_id=? AND target_table=? AND target_id=? ORDER BY field').bind(projectId,table,targetId).all<{field:string;source_user_id:string;display_name:string|null}>()
const assertion=(db:D1Database,g:SqlGuard)=>db.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT EXISTS(${g.sql})`).bind(...g.params)
const clear=(db:D1Database)=>db.prepare('DELETE FROM ik_d1_assertions')

/** Approval reserves only. The HTTP door never creates a canonical workspace.
 * UNIQUE(source_project_id) arbitrates competing packages without disclosing it. */
export async function approveAdoption(db:D1Database,p:AdoptionPrincipal,sha:string,sourceProjectId:string){
 const owner=firstOwnerPredicate(p),previous=await getAdoption(db,sha)
 if(previous&&(previous.custody_project_id!==p.setupProjectId||previous.source_project_id!==sourceProjectId||previous.approver_id!==p.actorId))refuse('adoption_conflict')
 const destination=await db.prepare('SELECT 1 FROM projects WHERE id=?').bind(sourceProjectId).first()
 if(destination&&previous?.state!=='created')refuse('destination_conflict')
 try{
  await db.batch([assertion(db,owner),
   db.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT NOT EXISTS(SELECT 1 FROM projects WHERE id=?) OR EXISTS(SELECT 1 FROM legacy_workspace_adoptions WHERE manifest_sha256=? AND source_project_id=? AND state='created')`).bind(sourceProjectId,sha,sourceProjectId),
   db.prepare(`INSERT INTO legacy_workspace_adoptions(manifest_sha256,custody_project_id,source_project_id,approver_id,session_hash,policy_version,approval_version,state,approved_at)
    VALUES(?,?,?,?,?,2,1,'reserved',${dbNow}) ON CONFLICT(manifest_sha256) DO UPDATE SET session_hash=excluded.session_hash,approval_version=legacy_workspace_adoptions.approval_version+1,approved_at=excluded.approved_at
    WHERE legacy_workspace_adoptions.approver_id=excluded.approver_id AND legacy_workspace_adoptions.custody_project_id=excluded.custody_project_id AND legacy_workspace_adoptions.source_project_id=excluded.source_project_id`).bind(sha,p.setupProjectId,sourceProjectId,p.actorId,p.sessionHash),
   assertion(db,owner),clear(db)])
 }catch{refuse('adoption_conflict')}
 return (await getAdoption(db,sha))!
}
export function mappingProfile(a:AdoptionRecord):HistoricalAdoptionProfile{return {kind:'historical-adoption',policyVersion:2,manifestSha256:a.manifest_sha256,custodyProjectId:a.custody_project_id,sourceProjectId:a.source_project_id,custodianId:a.approver_id}}

export interface AdoptionRunFence {runId:string;version:number;leaseToken:string;workspaceToken:string;approvalVersion:number}
export interface AdoptionApply {
 readonly profile:HistoricalAdoptionProfile
 assertion(db:D1Database):D1PreparedStatement
 creation(db:D1Database,targets:MappedRow[]):D1PreparedStatement[]
}
/** C calls this with its claimed v2 run and DESTINATION lease. The returned
 * assertion is repeated inside every core batch, before/after canonical writes.
 * C also composes B's custody-generation fence around scratch/object/checkpoints. */
export async function adoptionApply(env:Env,sha:string,fence:AdoptionRunFence):Promise<AdoptionApply>{
 const a=await getAdoption(env.DB,sha)
 if(!a||a.approval_version!==fence.approvalVersion)refuse('adoption_approval_required')
 // A journaled creation is still source-owned only while its mapped project
 // and settings remain unchanged. Check the recorded hashes, then retain exact
 // column predicates inside every later transaction (including resumed ticks).
 const equality:SqlGuard={sql:'1',params:[]}
 if(a.state==='created'){
  const states=await readStates(env.DB,[['projects',a.source_project_id],['project_settings',a.source_project_id]]),checks:string[]=[]
  for(const [table,key] of [['projects','id'],['project_settings','project_id']]){
   const row=await env.DB.prepare(`SELECT * FROM ${sqlName(table)} WHERE ${sqlName(key)}=?`).bind(a.source_project_id).first<Record<string,unknown>>()
   const state=states.get(stateKey(table,a.source_project_id))
   if(!row||!await unchangedSinceImport(row,state))refuse('canonical_target_conflict')
   const columns=JSON.parse(state!.columns) as string[]
   checks.push(`EXISTS(SELECT 1 FROM ${sqlName(table)} WHERE ${sqlName(key)}=? AND ${columns.map(column=>`${sqlName(column)} IS ?`).join(' AND ')})`)
   equality.params.push(a.source_project_id,...columns.map(column=>row[column] as string|number|null))
  }
  equality.sql=checks.join(' AND ')
 }
 const owner=firstOwnerPredicate({actorId:a.approver_id,sessionHash:a.session_hash,setupProjectId:a.custody_project_id,expectedEmail:expectedOwnerEmail(env)})
 const g:SqlGuard={sql:`SELECT 1 WHERE EXISTS(${owner.sql})
 AND EXISTS(SELECT 1 FROM legacy_workspace_adoptions a WHERE a.manifest_sha256=? AND a.approval_version=? AND a.session_hash=? AND a.approver_id=? AND a.custody_project_id=? AND a.source_project_id=? AND a.policy_version=2
  AND (a.state='reserved' AND NOT EXISTS(SELECT 1 FROM projects WHERE id=a.source_project_id)
   OR a.state='created' AND EXISTS(SELECT 1 FROM projects p JOIN memberships m ON m.project_id=p.id AND m.user_id=a.approver_id AND m.role='owner' WHERE p.id=a.source_project_id)
    AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=a.source_project_id AND (json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL OR json_extract(ps.settings_json,'$.suspended_at') IS NOT NULL))))
 AND EXISTS(SELECT 1 FROM legacy_import_worker_runs r WHERE r.id=? AND r.manifest_sha256=? AND r.project_id=? AND r.source_project_id=? AND r.contract_version=2 AND r.actor_id=? AND r.session_hash=? AND r.version=? AND r.state='running' AND r.lease_token=? AND r.lease_until>${dbNow})
 AND EXISTS(SELECT 1 FROM legacy_delta_leases WHERE project_id=? AND token=? AND expires_at>${dbNow})`,params:[...owner.params,sha,a.approval_version,a.session_hash,a.approver_id,a.custody_project_id,a.source_project_id,fence.runId,sha,a.custody_project_id,a.source_project_id,a.approver_id,a.session_hash,fence.version,fence.leaseToken,a.source_project_id,fence.workspaceToken]}
 const current=():SqlGuard=>({sql:`${g.sql} AND (NOT EXISTS(SELECT 1 FROM projects WHERE id=?) OR (${equality.sql}))`,params:[...g.params,a.source_project_id,...equality.params]})
 const admitted=current()
 if(!await env.DB.prepare(admitted.sql).bind(...admitted.params).first())refuse('import_authority_revoked')
 const profile=mappingProfile(a)
 return {profile,assertion:db=>assertion(db,current()),creation:(db,targets)=>{
  const projected=targets.filter(target=>['projects','project_settings'].includes(target.table))
  if(projected.length!==2)refuse('invalid_scope',422)
  equality.sql=projected.map(target=>`EXISTS(SELECT 1 FROM ${sqlName(target.table)} WHERE ${Object.keys(target.row).map(column=>`${sqlName(column)} IS ?`).join(' AND ')})`).join(' AND ')
  equality.params=projected.flatMap(target=>Object.values(target.row) as (string|number|null)[])
  return [
  // Called ONLY after the core inserted the mapped project/settings. Complete
  // provenance and native owner admission in that same indivisible transaction.
  db.prepare(`UPDATE legacy_workspace_adoptions SET state='created',created_at=${dbNow} WHERE manifest_sha256=? AND approval_version=? AND state='reserved'`).bind(sha,a.approval_version),
  db.prepare("INSERT INTO memberships(project_id,user_id,role) VALUES(?,?,'owner')").bind(a.source_project_id,a.approver_id),
  ...legacyWorkspaceDefaults({...env,DB:db},a.source_project_id,current()),
 ]}}
}

/** v1 journal identities are never reinterpreted. Called even for check-only
 * planning; binding is written atomically with the original journal run. */
export async function checkMappingProfile(db:D1Database,runId:string,profile?:HistoricalAdoptionProfile){
 const installed=await db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='legacy_import_mapping_profiles'").first()
 if(!installed){if(profile)refuse('adoption_schema_required',503);return null}
 const saved=await db.prepare('SELECT profile_json FROM legacy_import_mapping_profiles WHERE run_id=?').bind(runId).first<{profile_json:string}>()
 const value=stable(profile??{kind:'legacy-v1'})
 if(saved?saved.profile_json!==value:profile&&await db.prepare('SELECT 1 FROM legacy_import_runs WHERE id=?').bind(runId).first())refuse('mapping_profile_conflict')
 return (database:D1Database)=>database.prepare('INSERT INTO legacy_import_mapping_profiles(run_id,profile_json) VALUES(?,?) ON CONFLICT(run_id) DO UPDATE SET profile_json=CASE WHEN legacy_import_mapping_profiles.profile_json=excluded.profile_json THEN legacy_import_mapping_profiles.profile_json ELSE \'\' END').bind(runId,value)
}
