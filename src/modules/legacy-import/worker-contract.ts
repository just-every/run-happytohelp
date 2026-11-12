export const LEGACY_CONTRACT_VERSION = 2 as const
export const LEGACY_JOB = 'legacy-import.step' as const
export const LEGACY_ROUTE = '/projects/:projectId/legacy-import' as const
export const LEGACY_LIMITS = {
  manifestBytes: 2097152, partBytes: 4194304, objectBytes: 16777216,
  descriptors: 20000, statusPage: 200, controlBytes: 4096,
} as const
export type LegacyFileKind = 'chunk' | 'context' | 'object'
export interface LegacyPart {
  table: string; count: number; file: string; bytes: number; sha256: string
}
export interface LegacyObject {
  key: string; mediaId: string | number; file: string; size: number; sha256: string
}
export interface LegacyPackageManifest {
  format: 'happytohelp-legacy-chunks-v1'
  source: {repository: string; revision: string; exportedAt: string; projectId: string;
    rowCounts: Record<string, number>; attachments: Array<{key: string; mediaId: string | number}>;
    [key: string]: unknown}
  chunks: LegacyPart[]; context: LegacyPart[]; objects: LegacyObject[]
  attachmentsComplete: true; mediaBytes?: number
}
export interface LegacyWorkerWake {
  type: typeof LEGACY_JOB; id: string; projectId: string
  manifestSha256: string; contractVersion: 1 | typeof LEGACY_CONTRACT_VERSION
}
export interface LegacyStart {
  approvedManifestSha256: string; excludeTables?: string[]; replay?: boolean
}
