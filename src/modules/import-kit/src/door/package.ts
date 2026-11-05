import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { sha256 } from '../provenance/identity.ts';
import { DEFAULT_LIMITS, limitsFor, RecordCollector, safeValue } from '../readers/records.ts';
import type { ParsedRecord, SourceBundle } from '../types.ts';
import type { DoorPackageFile, DoorPackageManifest, DoorRequest, ImportDoorPackageUpload } from './types.ts';
import { DoorError } from './protocol.ts';
import { bundleBytes, CHUNK_BYTES, type UploadRow } from './uploads.ts';

const positive = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) > 0;
const count = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0;
const digest = (s: unknown): s is string => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
const filename = (s: unknown): s is string => typeof s === 'string' && /^[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(s) && !s.split('/').some(p=>!p || p==='.' || p==='..');
const invalid = (): never => { throw new DoorError('invalid_package',422); };
const missing = (segments: {bytes: number; sha256: string}[]): never => { throw new DoorError('package_segment_missing',409,{missing:segments}); };
const json = (bytes: Uint8Array): any => { try { return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)); } catch { return invalid(); } };

/** Resolve only verified complete segments in this installation AND namespace. No schema or grant changes. */
export async function packageUpload(request: DoorRequest, upload: UploadRow, resolved?: (rows: readonly UploadRow[]) => void): Promise<ImportDoorPackageUpload> {
  const declaration = request.options.package;
  if (!declaration) throw new DoorError('seed_package_unsupported',415);
  const raw = await bundleBytes(request,upload), value = json(raw);
  safeValue(value);
  if (value?.format!=='rer-door-package/1' || !declaration.formats.includes(value.source?.format) || typeof value.mode!=='string'
    || !positive(value.stream?.bytes) || value.stream.bytes > declaration.maxBytes || !digest(value.stream.sha256)
    || !Array.isArray(value.segments) || !value.segments.length || value.segments.length > declaration.maxSegments
    || value.index?.path!=='index.ndjson' || !positive(value.index.bytes) || value.index.bytes > request.access.maxBytes || !digest(value.index.sha256)
    || !value.records || !(value.records.total===null || count(value.records.total)) || !value.records.byKind || typeof value.records.byKind!=='object' || Array.isArray(value.records.byKind)
    || Object.values(value.records.byKind).some(n=>!count(n))) invalid();
  const manifest = value as DoorPackageManifest;
  let total = 0;
  for (const [i,segment] of manifest.segments.entries()) {
    if (!positive(segment?.bytes) || segment.bytes > request.access.maxBytes || Math.ceil(segment.bytes / CHUNK_BYTES) > request.access.maxChunks
      || i < manifest.segments.length - 1 && segment.bytes !== request.access.maxBytes || !digest(segment.sha256)) invalid();
    total += segment.bytes;
  }
  if (!Number.isSafeInteger(total) || total!==manifest.stream.bytes || manifest.index.bytes > total) invalid();
  const rows: UploadRow[] = [], absent: {bytes:number;sha256:string}[] = [];
  const streamHash = createHash('sha256');
  for (const segment of manifest.segments) {
    const candidates = await request.options.database.prepare(`SELECT * FROM ik_door_uploads WHERE installation_id=? AND namespace=? AND name='rer-segment' AND bundle_sha256=? AND total_bytes=? ORDER BY id`)
      .bind(request.access.installationId,request.access.namespace,segment.sha256,segment.bytes).all<UploadRow>();
    let complete: UploadRow | undefined, bytes: Uint8Array | undefined;
    for (const row of candidates.results) {
      if (row.total_chunks!==Math.ceil(segment.bytes / CHUNK_BYTES) || row.intake_json) continue;
      try { bytes = await bundleBytes(request,row); complete = row; break; }
      catch (error) { if (!(error instanceof DoorError) || !['upload_incomplete','upload_custody_mismatch','bundle_hash_mismatch'].includes(error.code)) throw error; }
    }
    if (!complete || !bytes) absent.push(segment);
    else { rows.push(complete); streamHash.update(bytes); }
  }
  if (absent.length) missing(absent);
  if (streamHash.digest('hex')!==manifest.stream.sha256) invalid();
  // Planning owns these verified custody identities even if the index or reader refuses.
  resolved?.(rows);
  // Range reads materialize at most one segment plus the bounded requested file.
  async function range(start: number, size: number): Promise<Uint8Array> {
    const result = new Uint8Array(size); let offset = 0, written = 0;
    for (let i = 0; i < rows.length && written < size; i++) {
      const end = offset + manifest.segments[i].bytes;
      if (end > start && offset < start + size) {
        let bytes: Uint8Array;
        try { bytes = await bundleBytes(request,rows[i]); } catch (error) { if (error instanceof DoorError && ['upload_incomplete','upload_custody_mismatch','bundle_hash_mismatch'].includes(error.code)) missing([manifest.segments[i]]); throw error; }
        const from = Math.max(start,offset), to = Math.min(start+size,end);
        result.set(bytes.subarray(from-offset,to-offset),from-start); written += to-from;
      }
      offset = end;
    }
    if (written!==size) invalid();
    return result;
  }
  const indexBytes = await range(0,manifest.index.bytes);
  if (sha256(indexBytes)!==manifest.index.sha256) invalid();
  let indexText: string;
  try { indexText = new TextDecoder('utf-8',{fatal:true}).decode(indexBytes); } catch { return invalid(); }
  if (!indexText.endsWith('\n')) invalid();
  const files: DoorPackageFile[] = [], names = new Set<string>(); let offset = 0;
  for (const line of indexText.slice(0,-1).split('\n')) {
    const row = json(Buffer.from(line));
    if (!filename(row?.path) || row.path==='index.ndjson' || names.has(row.path) || !count(row.bytes) || !digest(row.sha256) || row.offset!==offset) invalid();
    offset += row.bytes;
    if (!Number.isSafeInteger(offset) || offset > total - manifest.index.bytes) invalid();
    names.add(row.path); files.push(Object.freeze({path:row.path,bytes:row.bytes,sha256:row.sha256,offset:row.offset}));
  }
  if (!files.length || offset + manifest.index.bytes!==total) invalid();
  // Detach the accessor's custody data from callback-owned metadata.
  const exposed = JSON.parse(JSON.stringify(manifest)) as DoorPackageManifest;
  const fileLimit = Math.min(declaration.maxBytes,request.options.limits?.maxBytes ?? DEFAULT_LIMITS.maxBytes);
  return {manifest:exposed,files:Object.freeze(files),async read(path, maxBytes = fileLimit) {
    const file = files.find(f=>f.path===path);
    if (!file) throw new DoorError('package_file_missing',422);
    if (!count(maxBytes) || file.bytes > Math.min(maxBytes,fileLimit)) throw new DoorError('package_file_exceeds_limit',413);
    const bytes = await range(manifest.index.bytes+file.offset,file.bytes);
    if (sha256(bytes)!==file.sha256) throw new DoorError('package_file_hash_mismatch',409);
    return bytes;
  }};
}

export async function readPackageSource(request: DoorRequest, upload: UploadRow, namespace: string): Promise<SourceBundle> {
  const pkg = await packageUpload(request,upload), declaration = request.options.package!;
  const limits = limitsFor({...request.options.limits,maxBytes:Math.min(declaration.maxBytes,request.options.limits?.maxBytes ?? DEFAULT_LIMITS.maxBytes),
    maxRecords:Math.min(request.options.limits?.maxRecords ?? request.access.maxRecords,request.access.maxRecords)});
  const expectedTotal = pkg.manifest.records.total, expectedKinds = {...pkg.manifest.records.byKind};
  let records: ParsedRecord[];
  try { records = await declaration.read(pkg,Object.freeze({...limits})); }
  catch (error) { if (error instanceof DoorError) throw error; throw new DoorError('package_reader_failed',422); }
  if (!Array.isArray(records)) invalid();
  // Count the reader's aggregate before mapping or saving ANY plan, including when total is null (legacy).
  if (records.length > request.access.maxRecords) throw new DoorError('plan_exceeds_grant_quota');
  if (expectedTotal!==null && records.length!==expectedTotal) throw new DoorError('package_record_count_mismatch',422);
  if (expectedTotal!==null) {
    const actual: Record<string,number> = Object.create(null);
    for (const record of records) actual[record.kind] = (actual[record.kind] ?? 0) + 1;
    if (Object.keys(actual).length!==Object.keys(expectedKinds).length || Object.entries(actual).some(([kind,n])=>expectedKinds[kind]!==n)) throw new DoorError('package_record_count_mismatch',422);
  }
  const collector = new RecordCollector(namespace,limits);
  collector.add(records,{artifact:upload.name},upload.bundle_sha256);
  collector.bundle.artifacts.push({name:upload.name,sha256:upload.bundle_sha256,size:upload.total_bytes},
    ...pkg.files.map(f=>({name:f.path,sha256:f.sha256,size:f.bytes})));
  return collector.bundle;
}
