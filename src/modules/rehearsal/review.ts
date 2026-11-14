import type {Env} from '../../platform/env'
import {getAdoption} from '../legacy-import/adoption/store'
import {originProvenance} from './provenance'
import {getConnection} from '../move-in/zendesk-connection/store'
import {getPull} from '../move-in/zendesk-source/pull-store'
import {reject} from './types'
/** Approval consumes immutable verified origin provenance, never a caller's
 * substitute watermark or an equal-looking native destination. */
export async function acceptedOrigin(env:Env,setup:string,owner:string,sha:string){
 const a=await getAdoption(env.DB,sha)
 const run=await env.DB.prepare("SELECT verified_at FROM legacy_import_worker_runs WHERE manifest_sha256=? AND project_id=? AND contract_version=2 AND mode='full' AND state='complete' AND verified_at IS NOT NULL AND authority_mode='session'").bind(sha,setup).first<{verified_at:number}>()
 if(!a||a.state!=='created'||a.custody_project_id!==setup||a.approver_id!==owner||!run)reject('accepted_adoption_required')
 if(!await env.DB.prepare("SELECT 1 FROM projects p JOIN memberships m ON m.project_id=p.id AND m.user_id=? AND m.role='owner' WHERE p.id=? AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=p.id AND (json_extract(settings_json,'$.deleted_at') IS NOT NULL OR json_extract(settings_json,'$.suspended_at') IS NOT NULL))").bind(owner,a.source_project_id).first())reject('accepted_adoption_required')
 return {a,run,...await originProvenance(env,setup,owner,sha,a.source_project_id,run.verified_at)}
}
export async function acceptedZendesk(env:Env,owner:string,project:string,pullId:string){
 const c=await getConnection(env,project),p=await getPull(env,pullId)
 if(!c||c.state!=='connected'||!p||p.project_id!==project||p.subdomain!==c.subdomain||p.state!=='applied'||p.error||!p.resume_json||p.authority_mode==='rehearsal')reject('accepted_zendesk_pull_required')
 if(!await env.DB.prepare("SELECT 1 FROM projects p JOIN memberships m ON m.project_id=p.id AND m.user_id=? AND m.role='owner' WHERE p.id=? AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=p.id AND (json_extract(settings_json,'$.deleted_at') IS NOT NULL OR json_extract(settings_json,'$.suspended_at') IS NOT NULL))").bind(owner,project).first())reject('accepted_zendesk_pull_required')
 if(await env.DB.prepare("SELECT 1 FROM move_in_zendesk_pull_runs pr JOIN move_in_runs r ON r.id=pr.run_id WHERE pr.pull_id=? AND (r.error IS NOT NULL OR r.state NOT IN ('ready','completed')) LIMIT 1").bind(p.id).first())reject('accepted_zendesk_pull_required')
 return {connection:c,pull:p}
}
