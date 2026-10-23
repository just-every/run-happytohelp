import type {PublicationCategory} from './category-publication'
import type { SourceBundle, SourceRecord, TargetEffect } from '../import-kit/src/types'
export type Vendor = 'zendesk' | 'intercom' | 'helpscout' | 'freshdesk'
export const MAPPING_VERSION = 'happytohelp-move-in-1'
export const LIMITS = { inputBytes: 2 * 1024 * 1024, expandedBytes: 2 * 1024 * 1024, recordBytes: 128 * 1024, records: 5000, opaqueNodes:4096, opaqueUploadNodes:200000, identityNodes:200000, identityLinks:20000, identityHashes:40000, archiveEntries: 64, parseBatch: 100, planBatch: 10, planChildren:500, nativeStatements:750, planContentBytes:512*1024, planBytes:1024*1024, applyBatch: 20 } as const
export interface Run { id:string; identity_audited:number; project_id:string; actor_id:string; session_hash:string; vendor:Vendor; filename:string; artifact_hash:string; object_key:string; bytes:number; state:string; cursor:number; file_index:number; files_json:string; diagnostics_json:string; parsed_total:number; kit_job_id:string|null; review_fingerprint:string|null; total:number; plan_json:string|null; report_json:string|null; error:string|null; created_at:number; updated_at:number }
export interface MappingInput { projectId:string; actorId:string; importedAt:number; vendor:Vendor; source:SourceBundle; tagIds:Map<string,string> }
export interface SourceClaim {identity:string;source_hash:string;mapping_version:string;effects_hash:string;job_id:string}
/** known: records an earlier import already holds without native effects; they stay out of new kit plans. */
export interface PreparedMapping { known:Set<string>; retained?:Map<string,SourceClaim>; retainedCategories?:PublicationCategory[]; effects:Map<string,TargetEffect[]>; rejections:Map<string,string>; omissions:Map<string,string[]> }
export const recordKey = (record:SourceRecord) => `${record.kind}/${record.sourceId}`
