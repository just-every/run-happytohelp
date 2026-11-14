import type {Env} from '../../platform/env'
import type {LegacyPackageManifest} from '../legacy-import/worker-contract'
import {readCustodyManifest} from '../legacy-import/package-in/v2'
import {reject} from './types'
export interface OriginProvenance {manifest_sha256:string;custody_project_id:string;source_project_id:string;custodian_id:string;source_cutoff_iso:string;snapshot_clock_iso:string;watermark_iso:string;overlap_seconds:number;verified_at:number}
export function utcBound(value:unknown){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(value))reject('source_cutoff_required')
 const time=Date.parse(value)
 if(!Number.isFinite(time)||new Date(time).toISOString().slice(0,19)!==value.slice(0,19))reject('source_cutoff_required')
 return time
}
const micros=(value:string)=>BigInt(Math.floor(utcBound(value)/1000))*1000000n+BigInt((value.split('.')[1]?.slice(0,-1)??'').padEnd(6,'0'))
/** First consent records a verified immutable clock, without retaining the raw
 * source as continuing authority. Later consent uses only this exact provenance
 * plus the latest completed, verified delta lineage. */
export async function originProvenance(env:Env,setup:string,owner:string,sha:string,sourceProject:string,verifiedAt:number){
 let saved=await env.DB.prepare('SELECT * FROM rehearsal_origins WHERE manifest_sha256=?').bind(sha).first<OriginProvenance>()
 if(saved&&(saved.custody_project_id!==setup||saved.custodian_id!==owner||saved.source_project_id!==sourceProject))reject('origin_provenance_conflict')
 if(!saved){
  const manifest:LegacyPackageManifest=await readCustodyManifest(env,setup,sha),s=manifest.source
  const cutoff=micros(String(s.sourceCutoff)),clock=micros(String(s.snapshotClock)),watermark=micros(String(s.watermark)),overlap=s.watermarkOverlapSeconds
  if(s.projectId!==sourceProject||s.since!==undefined||s.delta!==undefined||typeof overlap!=='number'||!Number.isSafeInteger(overlap)||overlap<300||cutoff>clock||clock>BigInt(Date.now())*1000n||watermark>(clock<cutoff?clock:cutoff)-BigInt(overlap)*1000000n)reject('source_clock_chain_invalid')
  saved={manifest_sha256:sha,custody_project_id:setup,source_project_id:sourceProject,custodian_id:owner,source_cutoff_iso:String(s.sourceCutoff),snapshot_clock_iso:String(s.snapshotClock),watermark_iso:String(s.watermark),overlap_seconds:overlap,verified_at:verifiedAt}
 }
 const latest=await env.DB.prepare("SELECT l.watermark_iso,l.source_cutoff_iso FROM legacy_rehearsal_lineage l JOIN legacy_import_worker_runs r ON r.manifest_sha256=l.manifest_sha256 WHERE l.origin_sha256=? AND l.custody_project_id=? AND l.source_project_id=? AND l.custodian_id=? AND l.verified_at IS NOT NULL AND r.verified_at IS NOT NULL AND r.state='complete' ORDER BY l.source_cutoff DESC LIMIT 1").bind(sha,setup,sourceProject,owner).first<{watermark_iso:string;source_cutoff_iso:string}>()
 const source={watermark:latest?.watermark_iso??saved.watermark_iso,sourceCutoff:latest?.source_cutoff_iso??saved.source_cutoff_iso}
 return {provenance:saved,source,watermark:utcBound(source.watermark),cutoff:utcBound(source.sourceCutoff)}
}
export function recordOrigin(db:D1Database,p:OriginProvenance){return db.prepare(`INSERT OR IGNORE INTO rehearsal_origins(${Object.keys(p).join(',')}) VALUES(${Object.keys(p).map(()=>'?').join(',')})`).bind(...Object.values(p))}
