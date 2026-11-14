import {expectedOwnerEmail} from '../../legacy-import/adoption/authority'
import type {Env} from '../../../platform/env'
import type {SqlGuard} from '../../../platform/integration-authority'
import {rehearsalPredicate,assertRehearsal} from '../authority'
import {activeCustody} from '../../legacy-import/custody/authority'
import {dbNow} from '../../legacy-import/lease'
import type {Run} from '../../legacy-import/worker/state'
import {getLineage,lineagePredicate} from './lineage-record'
import {packageProfile} from './lineage'
import type {AdoptionApply} from '../../legacy-import/adoption/store'
import {refuse} from '../../legacy-import/worker/errors'

export function delegatedRunAuthority(run:Pick<Run,'manifest_sha256'|'project_id'|'source_project_id'|'actor_id'|'rehearsal_id'|'rehearsal_generation'>,expectedEmail=''):SqlGuard {
 if(!run.rehearsal_id||!run.rehearsal_generation)return {sql:'0',params:[]}
 const a=rehearsalPredicate({rehearsal_id:run.rehearsal_id,rehearsal_generation:run.rehearsal_generation},run.source_project_id,'legacy',expectedEmail)
 return {sql:`EXISTS(${a.sql}) AND EXISTS(SELECT 1 FROM legacy_rehearsal_lineage l JOIN legacy_workspace_adoptions o ON o.manifest_sha256=l.origin_sha256
 WHERE l.manifest_sha256=? AND l.rehearsal_id=? AND l.rehearsal_generation=? AND l.custody_project_id=? AND l.source_project_id=? AND l.custodian_id=?
 AND o.state='created' AND o.policy_version=2 AND o.custody_project_id=l.custody_project_id AND o.source_project_id=l.source_project_id AND o.approver_id=l.custodian_id
 AND EXISTS(SELECT 1 FROM projects WHERE id=l.source_project_id) AND EXISTS(SELECT 1 FROM project_settings WHERE project_id=l.source_project_id))
 AND EXISTS(SELECT 1 FROM legacy_package_custody c WHERE c.manifest_sha256=? AND c.custody_project_id=? AND c.source_project_id=? AND c.destination_project_id=c.source_project_id AND c.authority_mode='rehearsal' AND c.rehearsal_id=? AND c.rehearsal_generation=? AND c.generation=1 AND ${activeCustody})`,params:[...a.params,run.manifest_sha256,run.rehearsal_id,run.rehearsal_generation,run.project_id,run.source_project_id,run.actor_id,run.manifest_sha256,run.project_id,run.source_project_id,run.rehearsal_id,run.rehearsal_generation]}
}
export async function rehearsalApply(env:Env,run:Run,workspaceToken:string):Promise<AdoptionApply>{
 if(run.authority_mode!=='rehearsal'||run.mode!=='delta'||!run.rehearsal_id||!run.rehearsal_generation)refuse('delta_only')
 await assertRehearsal(env,{rehearsal_id:run.rehearsal_id,rehearsal_generation:run.rehearsal_generation},run.source_project_id,'legacy')
 const l=await getLineage(env.DB,run.manifest_sha256),profile=await packageProfile(env.DB,run.manifest_sha256)
 if(!l||!profile)refuse('lineage_conflict')
 const a=delegatedRunAuthority(run,expectedOwnerEmail(env)),proof=lineagePredicate(l)
 const sql=`SELECT EXISTS(${proof.sql}) AND (${a.sql}) AND EXISTS(SELECT 1 FROM legacy_import_worker_runs WHERE id=? AND version=? AND authority_mode='rehearsal' AND rehearsal_id=? AND rehearsal_generation=? AND mode='delta' AND state='running' AND lease_token=? AND lease_until>${dbNow}) AND EXISTS(SELECT 1 FROM legacy_delta_leases WHERE project_id=? AND token=? AND expires_at>${dbNow})`
 const params=[...proof.params,...a.params,run.id,run.version,run.rehearsal_id,run.rehearsal_generation,run.lease_token,run.source_project_id,workspaceToken]
 const ok=await env.DB.prepare(sql).bind(...params).first<Record<string,number>>()
 if(!ok||!Object.values(ok)[0])refuse('import_authority_revoked')
 return {profile,assertion:db=>db.prepare(`INSERT INTO ik_d1_assertions(ok) ${sql}`).bind(...params),creation:()=>refuse('delta_only')}
}
