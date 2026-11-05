import type { D1Sql } from '../../d1/types.ts';
import type { ImportPlan, ParsedRecord, ReaderLimits, TargetRow } from '../../types.ts';
import type { ImportDoorPackageUpload } from '../types.ts';

export const BOUNDED_WAVES = 'rer-bounded-waves/1' as const;
/** Opaque Business identifiers. These never select the destination. */
export interface WaveRevision { migration: string; revision: string; policy: string }
export interface WaveTotals {
  source: number; native: number; aliases: number; objects: number; logicalBytes: number;
  storedBytes: number; nativeBytes: number; blobBytes: number; contextBytes: number;
}
/** Adapter's independently enumerated COMPLETE inventory, not its first page. */
export interface WaveCensus extends WaveTotals {
  children: number; byKind: Record<string, number>; nativeByTable: Record<string, number>;
  inventoryHash: string; relationshipsHash: string; baselineHash: string;
  sourceMode: 'complete'; highWater: string; accountingVersion: string;
}
export interface WaveFile {
  path: string; role: 'source' | 'object' | 'context'; logicalBytes: number;
}
export interface WaveNativeRow {
  table: string; key: string; valueHash: string; storedBytes: number; blobBytes: number;
}
/** The adapter coalesces cycles/publication closures BEFORE returning this unit.
 * All primary rows, aliases and media must occur in exactly one unit. */
export interface WaveAlias {
  kind: string; sourceId: string; role: 'context'|'archive'|'rejected'|'metadata'; files: string[];
}
export interface WaveUnit {
  id: string; dependsOn: string[]; records: ParsedRecord[]; files: WaveFile[]; aliases: WaveAlias[];
  /** Changes to relationship evidence must change this digest. */
  relationshipsHash: string;
}
export interface WaveBinding extends WaveRevision {
  protocol: typeof BOUNDED_WAVES;
  parentFingerprint?: string; childFingerprint?: string;
  parentApprovalRecordId?: string; parentApprovedAt?: string;
}
/** Edition-owned, server-only integration. No source arrays are read by the
 * ordinary package reader; one bounded native work unit is prepared per call. */
export interface ImportDoorBoundedSource {
  protocol: typeof BOUNDED_WAVES;
  batchSize?: number;
  describe(upload: ImportDoorPackageUpload): Promise<WaveCensus>;
  page(upload: ImportDoorPackageUpload, ordinal: number, limits: Readonly<Required<ReaderLimits>>): Promise<WaveUnit>;
  /** Full expansion into the actual installed schema, including joins, origin,
   * hold and native blob chunks. Kit journal rows are reported separately. */
  native(plan: ImportPlan): WaveNativeRow[];
  /** Current installation/owner/claim, migration revision, policy and active
   * exact parent/child approvals in the same database. Never return a cached
   * boolean. Business and the edition must install these typed approval rows. */
  authority(binding: Readonly<WaveBinding>, action: string): D1Sql;
}
export interface WaveDescriptor extends WaveTotals {
  ordinal: number; unitHash: string; dependsOn: string[]; membershipHash: string;
  planFingerprint: string; fingerprint: string; relationshipsHash: string;
  nativeByTable: Record<string, number>;
  baseline: {kind: string; id: string; row: TargetRow | null}[];
  projections: WaveNativeRow[];
}
export interface WaveRoot {
  id: string; installation_id: string; namespace: string; destination: string;
  owner: string; mapping_version: string; bundle_sha256: string; upload_id: string;
  previous_id: string | null; epoch: number; binding_json: string; census_json: string;
  fingerprint: string | null; state: string; pages: number; chain: string;
  catchup: number; content_revision?: number;
}
export interface WaveChild {
  parent_id: string; ordinal: number; plan_id: string; unit_hash: string;
  fingerprint: string; descriptor_hash: string; source: number; native: number; aliases: number;
  objects: number; logicalBytes: number; storedBytes: number; nativeBytes: number; blobBytes: number;
  contextBytes: number; job_id: string | null;
}
export type WaveMetadata = { descriptor: WaveDescriptor; unit: Omit<WaveUnit,'records'> };
export const totalKeys = ['source','native','aliases','objects','logicalBytes','storedBytes','nativeBytes','blobBytes','contextBytes'] as const;
export const zeroTotals = (): WaveTotals => ({source:0,native:0,aliases:0,objects:0,logicalBytes:0,storedBytes:0,nativeBytes:0,blobBytes:0,contextBytes:0});
