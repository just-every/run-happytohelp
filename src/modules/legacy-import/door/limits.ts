/** Parsing allowances for one eager legacy snapshot. Transport is still the
 * grant's 2 MiB / 32 chunks, independently admitted for every request. */
export const LEGACY_LIMITS={bytes:16*1024*1024,fileBytes:16*1024*1024,recordBytes:1024*1024,records:100_000,segments:8,eagerBytes:32*1024*1024,blobChunkBytes:64*1024} as const
export const LEGACY_NAMESPACE='happytohelp-legacy'
export const LEGACY_MAPPING='happytohelp-legacy-door-1'
