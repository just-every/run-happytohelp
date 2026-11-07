import type {PublicationCategory} from './category-publication'
import type { SourceBundle, SourceRecord, TargetEffect } from '../import-kit/src/types'
export type Vendor = 'zendesk' | 'intercom' | 'helpscout' | 'freshdesk'
export const MAPPING_VERSION = 'happytohelp-move-in-1'
/** The mapping's revision within MAPPING_VERSION. A revision only maps records an earlier
 * one refused (2: staff requesters as inert contacts, customers with no usable email,
 * Zendesk system-authored comments); every record an earlier revision mapped keeps the
 * same effects, so imports and source claims made under it stay valid and still undo.
 * Each review records the revision it was built under (none before 2). A pulled batch
 * reviewed under an earlier revision and not yet approved is planned again on Resume,
 * so its review reflects what this revision imports. */
export const MAPPING_REVISION = 2
export const reviewedRevision = (planJson:string|null):number => {try{const revision=JSON.parse(planJson||'{}').mappingRevision;return Number.isSafeInteger(revision)?revision:1}catch{return 1}}
export const LIMITS = { inputBytes: 2 * 1024 * 1024, expandedBytes: 2 * 1024 * 1024, recordBytes: 128 * 1024, records: 5000, opaqueNodes:4096, opaqueUploadNodes:200000, identityNodes:200000, identityLinks:20000, identityHashes:40000, archiveEntries: 64, parseBatch: 100, planBatch: 10, planChildren:500, nativeStatements:750, planContentBytes:512*1024, planBytes:1024*1024, applyBatch: 20 } as const
/** A Zendesk pull reads complete tickets from the connected account inside this
 * Worker; nothing is uploaded. One pulled record may be larger than an uploaded
 * record, and is then alone in its reviewed child plan. The record bound keeps the
 * parsed row (record and its serialized copy) inside D1's 2,000,000-byte statement
 * limit. Uploads keep LIMITS unchanged, including the 2 MiB file and 128 KiB record. */
export const PULL_LIMITS = { recordBytes: 960 * 1024, shapeNodes: 32768, planContentBytes: 4 * 1024 * 1024, planBytes: 4 * 1024 * 1024 } as const
export type RunSource = 'upload' | 'zendesk-pull'
export type RecordLimits = { recordBytes:number; shapeNodes?:number; planContentBytes:number; planBytes:number }
export const runLimits = (run:{source?:string|null}):RecordLimits => run.source==='zendesk-pull' ? PULL_LIMITS : LIMITS
export interface Run { id:string; source?:RunSource; identity_audited:number; project_id:string; actor_id:string; session_hash:string; vendor:Vendor; filename:string; artifact_hash:string; object_key:string; bytes:number; state:string; cursor:number; file_index:number; files_json:string; diagnostics_json:string; parsed_total:number; kit_job_id:string|null; review_fingerprint:string|null; total:number; plan_json:string|null; report_json:string|null; error:string|null; created_at:number; updated_at:number }
export interface MappingInput { projectId:string; actorId:string; vendor:Vendor; source:SourceBundle; tagIds:Map<string,string> }
export interface SourceClaim {identity:string;source_hash:string;mapping_version:string;effects_hash:string;job_id:string}
/** known: records an earlier import already holds without native effects; they stay out of new kit plans. */
export interface PreparedMapping { known:Set<string>; heldBack?:Map<string,string>; retained?:Map<string,SourceClaim>; retainedCategories?:PublicationCategory[]; effects:Map<string,TargetEffect[]>; rejections:Map<string,string>; omissions:Map<string,string[]> }
export const recordKey = (record:SourceRecord) => `${record.kind}/${record.sourceId}`
