import {cleanupZendeskReservations,pendingZendeskReservations} from './zendesk/cleanup'
import type {Env} from '../../platform/env'
import {cleanupStep} from '../legacy-import/custody'
import {rehearsalAudit} from './audit'
import {assertRehearsal} from './authority'
import {getGrant} from './store'
import {grantRef,type RehearsalGrant} from './types'
export const REHEARSAL_CLEANUP='rehearsal.cleanup'
export async function cleanupStatus(env:Pick<Env,'DB'>,g:RehearsalGrant){
 const row=await env.DB.prepare("SELECT (SELECT count(*) FROM legacy_package_custody WHERE rehearsal_id=?1 AND status<>'purged') pendingSources,(SELECT count(*) FROM move_in_zendesk_staged WHERE pull_id IN (SELECT id FROM move_in_zendesk_pulls WHERE rehearsal_id=?1)) stagedRows").bind(g.id).first<{pendingSources:number;stagedRows:number}>()
 return {state:g.cleanup_state,pendingSources:row?.pendingSources??0,stagedRows:row?.stagedRows??0,pendingAttachments:await pendingZendeskReservations(env,g.id),drafts:'not_implemented' as const}
}
/** Reduction-only closure work stays available with an inactive project, expired
 * source authorization and no copier credential. Draft cleanup belongs to D5. */
export async function cleanupRehearsal(env:Env,id:string){
 const g=await getGrant(env,id);if(!g||g.state!=='closed')return
 const custody=await env.DB.prepare("SELECT manifest_sha256,generation FROM legacy_package_custody WHERE rehearsal_id=? AND status IN ('invalidated','purging') ORDER BY manifest_sha256 LIMIT 1").bind(id).first<{manifest_sha256:string;generation:number}>()
 if(custody)await cleanupStep(env,custody.manifest_sha256,custody.generation)
 await env.DB.prepare("DELETE FROM move_in_zendesk_staged WHERE rowid IN (SELECT s.rowid FROM move_in_zendesk_staged s JOIN move_in_zendesk_pulls p ON p.id=s.pull_id WHERE p.rehearsal_id=? LIMIT 100)").bind(id).run()
 await cleanupZendeskReservations(env,id)
 const status=await cleanupStatus(env,g)
 if(!status.pendingSources&&!status.stagedRows&&!status.pendingAttachments&&g.cleanup_state!=='complete')await env.DB.batch([
  env.DB.prepare("UPDATE rehearsal_grants SET cleanup_state='complete',cleanup_at=? WHERE id=? AND state='closed'").bind(Date.now(),id),rehearsalAudit(env.DB,g,'source_cleanup_complete')])
}
export async function discoverRehearsals(env:Env){
 const rows=await env.DB.prepare("SELECT * FROM rehearsal_grants WHERE state='active' OR cleanup_state='pending' ORDER BY created_at,id LIMIT 1").all<RehearsalGrant>()
 for(const g of rows.results){
  if(g.state==='active'){
   try{if(g.legacy_enabled)await assertRehearsal(env,grantRef(g),g.legacy_project_id,'legacy');if(g.zendesk_enabled)await assertRehearsal(env,grantRef(g),g.zendesk_project_id,'zendesk')}catch{/* Closure is durable; no continuation may reopen it. */}
  }else try{await env.JOBS.send({type:REHEARSAL_CLEANUP,id:g.id,projectId:g.setup_project_id})}catch{/* Next discovery retries the durable cleanup state. */}
 }
}
