import type {Env} from '../../../platform/env'
import type {RehearsalGrant} from '../types'
import {rehearsalPredicate,assertRehearsal} from '../authority'
import {beginCopy,verifyCopy,copyDay} from '../copies'
import {getAdoption,mappingProfile} from '../../legacy-import/adoption/store'
import type {HistoricalAdoptionProfile} from '../../legacy-import/adoption/profile'
import type {LegacyPackageManifest} from '../../legacy-import/worker-contract'
import {refuse} from '../../legacy-import/worker/errors'

export {getLineage} from './lineage-record'
import {getLineage,lineagePredicate,type Lineage} from './lineage-record'
export const refOf=(g:RehearsalGrant)=>({rehearsal_id:g.id,rehearsal_generation:g.generation})
export async function packageProfile(db:D1Database,sha:string):Promise<HistoricalAdoptionProfile|null>{
 const a=await getAdoption(db,sha);if(a)return mappingProfile(a)
 const l=await getLineage(db,sha);if(!l)return null
 const proof=lineagePredicate(l)
 if(!await db.prepare(proof.sql).bind(...proof.params).first())refuse('lineage_conflict')
 // Every journal keeps its actual immutable package SHA. Origin is proven separately.
 return {kind:'historical-adoption',policyVersion:2,manifestSha256:sha,custodyProjectId:l.custody_project_id,sourceProjectId:l.source_project_id,custodianId:l.custodian_id}
}
const utc=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/
export function sourceTime(value:unknown){
 if(typeof value!=='string'||!utc.test(value))refuse('source_clock_required',422)
 const n=Date.parse(value)
 if(!Number.isFinite(n)||new Date(n).toISOString().slice(0,19)!==value.slice(0,19))refuse('source_clock_invalid',422)
 return n
}
const micros=(value:string)=>BigInt(Math.floor(sourceTime(value)/1000))*1000000n+BigInt((value.split('.')[1]?.slice(0,-1)??'').padEnd(6,'0'))
export function sourceBounds(m:LegacyPackageManifest){
 const since=sourceTime(m.source.since),cutoff=sourceTime(m.source.sourceCutoff),clock=sourceTime(m.source.snapshotClock),watermark=sourceTime(m.source.watermark)
 const overlap=m.source.watermarkOverlapSeconds
 if(typeof overlap!=='number'||!Number.isSafeInteger(overlap)||overlap<300||clock>Date.now())refuse('source_clock_invalid',422)
 const s=micros(m.source.since as string),c=micros(m.source.sourceCutoff as string),k=micros(m.source.snapshotClock as string),w=micros(m.source.watermark as string)
 if(c>k||w>(c<k?c:k)-BigInt(overlap)*1000000n||w<=s)refuse('source_clock_invalid',422)
 return {since,cutoff,clock,watermark}
}
export async function acceptLineage(env:Env,g:RehearsalGrant,sha:string,m:LegacyPackageManifest,requestedDay?:string){
 await assertRehearsal(env,refOf(g),g.legacy_project_id,'legacy')
 if(m.source.projectId!==g.legacy_project_id||m.source.since===undefined||m.source.delta===false)refuse('delta_only')
 const bounds=sourceBounds(m),day=copyDay(requestedDay??new Date().toISOString().slice(0,10)),prior=await getLineage(env.DB,sha)
 if(prior){
  if(prior.day!==day||prior.rehearsal_id!==g.id||prior.rehearsal_generation!==g.generation||prior.origin_sha256!==g.origin_sha||prior.source_project_id!==g.legacy_project_id||prior.custody_project_id!==g.setup_project_id||prior.custodian_id!==g.owner_id||prior.since!==bounds.since||prior.watermark!==bounds.watermark||prior.source_cutoff!==bounds.cutoff||prior.snapshot_clock!==bounds.clock||prior.since_iso!==m.source.since||prior.source_cutoff_iso!==m.source.sourceCutoff||prior.snapshot_clock_iso!==m.source.snapshotClock||prior.watermark_iso!==m.source.watermark)refuse('lineage_conflict')
  return prior
 }
 if(m.source.since!==g.legacy_watermark_iso||micros(m.source.sourceCutoff as string)<=micros(g.legacy_cutoff_iso)||bounds.since!==g.legacy_watermark)refuse('source_chain_conflict')
 await beginCopy(env,g,day,'legacy',sha)
 const a=rehearsalPredicate(refOf(g),g.legacy_project_id,'legacy'),pending=await env.DB.prepare('SELECT 1 FROM legacy_rehearsal_lineage l LEFT JOIN legacy_import_worker_runs r ON r.manifest_sha256=l.manifest_sha256 WHERE l.rehearsal_id=? AND (l.verified_at IS NULL OR r.state<>\'complete\')').bind(g.id).first()
 if(pending)refuse('previous_copy_unverified')
 const l:Lineage={manifest_sha256:sha,origin_sha256:g.origin_sha,rehearsal_id:g.id,rehearsal_generation:g.generation,custody_project_id:g.setup_project_id,source_project_id:g.legacy_project_id,custodian_id:g.owner_id,day,since:bounds.since,source_cutoff:bounds.cutoff,snapshot_clock:bounds.clock,watermark:bounds.watermark,since_iso:m.source.since as string,source_cutoff_iso:m.source.sourceCutoff as string,snapshot_clock_iso:m.source.snapshotClock as string,watermark_iso:m.source.watermark as string,verified_at:null,created_at:Date.now()}
 const proof=lineagePredicate(l)
 await env.DB.batch([
  env.DB.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT EXISTS(${a.sql}) AND NOT EXISTS(SELECT 1 FROM legacy_rehearsal_lineage l LEFT JOIN legacy_import_worker_runs r ON r.manifest_sha256=l.manifest_sha256 WHERE l.rehearsal_id=? AND (l.verified_at IS NULL OR r.state<>'complete'))`).bind(...a.params,g.id),
  env.DB.prepare('INSERT INTO legacy_rehearsal_lineage(manifest_sha256,origin_sha256,rehearsal_id,rehearsal_generation,custody_project_id,source_project_id,custodian_id,day,since,source_cutoff,snapshot_clock,watermark,since_iso,source_cutoff_iso,snapshot_clock_iso,watermark_iso,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(sha,g.origin_sha,g.id,g.generation,g.setup_project_id,g.legacy_project_id,g.owner_id,day,bounds.since,bounds.cutoff,bounds.clock,bounds.watermark,l.since_iso,l.source_cutoff_iso,l.snapshot_clock_iso,l.watermark_iso,l.created_at),
  env.DB.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT EXISTS(${proof.sql}) AND EXISTS(${a.sql})`).bind(...proof.params,...a.params),env.DB.prepare('DELETE FROM ik_d1_assertions')])
 return l
}
export async function settleLegacyCopy(env:Env,sha:string){
 const l=await getLineage(env.DB,sha);if(!l?.verified_at)return
 const g=await env.DB.prepare('SELECT * FROM rehearsal_grants WHERE id=? AND generation=?').bind(l.rehearsal_id,l.rehearsal_generation).first<RehearsalGrant>()
 if(!g)return
 await assertRehearsal(env,refOf(g),l.source_project_id,'legacy')
 const complete=await env.DB.prepare("SELECT 1 FROM legacy_import_worker_runs WHERE manifest_sha256=? AND state='complete' AND verified_at IS NOT NULL AND authority_mode='rehearsal' AND rehearsal_id=? AND rehearsal_generation=?").bind(sha,g.id,g.generation).first()
 if(complete)await verifyCopy(env,g,l.day,'legacy',sha,{watermark:l.watermark,cutoff:l.source_cutoff,watermarkIso:l.watermark_iso,cutoffIso:l.source_cutoff_iso})
}
