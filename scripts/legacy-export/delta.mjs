import {identifier} from './mysql.mjs';

// A delta export (`snapshot --since`) reads the same whole project scope inside the same
// consistent snapshot as a full export, so mapping context, credential pre-scan and count
// guards are unchanged. Only rows created, updated or deleted at or after `since` go to
// its row chunks, plus the rows the importer needs to apply them (below).

/** Margin subtracted from the source time bound when recording a watermark. Rows a request
 * timestamped before the snapshot began but committed after it carry a time slightly
 * before the clock read; the next delta re-includes them instead of missing them. */
export const watermarkOverlapSeconds=300;
const timeColumns=['created_at','updated_at','deleted_at'];
const conversationChildren=['messages','events','conversation_participants','buckets'];
const iso=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

function utcTime(value,label){
  const ms=typeof value==='string'&&iso.test(value)?Date.parse(value):NaN;
  // Date.parse normalizes dates such as February 30; source bounds must never do so.
  if(!Number.isFinite(ms)||new Date(ms).toISOString().slice(0,19)!==value.slice(0,19))throw Error(`${label} needs a valid ISO-8601 UTC time such as 2026-11-08T09:30:00Z`);
  const fraction=(value.split('.')[1]?.slice(0,-1)||'').padEnd(6,'0');
  return {iso:value,ms,sql:value.slice(0,-1).replace('T',' '),micros:BigInt(Math.floor(ms/1000))*1000000n+BigInt(fraction)};
}
function isoMicros(micros){
  const seconds=micros>=0n?micros/1000000n:(micros-999999n)/1000000n;
  return new Date(Number(seconds)*1000).toISOString().replace(/\.\d{3}Z$/,`.${String(micros-seconds*1000000n).padStart(6,'0')}Z`);
}

/** An explicit ISO-8601 UTC time (`2026-11-08T09:30:00Z`), as MySQL text and epoch ms. */
export function parseSince(value){
  return utcTime(value,'--since (a previous export\'s source.watermark)');
}
export const parseSourceCutoff=value=>utcTime(value,'--source-cutoff');

/** The database clock inside the open snapshot: the raw read and the watermark the next
 * delta passes as --since. A restored clone's wall clock does not describe its recovery
 * point: an externally established cutoff bounds that clock before overlap is subtracted. */
export async function readWatermark(connection,{sourceCutoff,since}={}){
  const format="'%Y-%m-%dT%H:%i:%s.%fZ'";
  const [[row]]=await connection.query(`SELECT DATE_FORMAT(UTC_TIMESTAMP(6),${format}) AS clock`);
  const clock=utcTime(String(row.clock),'Snapshot clock');
  if(sourceCutoff&&sourceCutoff.micros>clock.micros)throw Error('--source-cutoff is later than the snapshot clock');
  const bound=sourceCutoff&&sourceCutoff.micros<clock.micros?sourceCutoff.micros:clock.micros;
  const watermark=utcTime(isoMicros(bound-BigInt(watermarkOverlapSeconds)*1000000n),'Source watermark');
  if(sourceCutoff&&since&&watermark.micros<=since.micros)throw Error('--source-cutoff does not advance the watermark beyond --since after overlap');
  return {clock:clock.iso,watermark:watermark.iso,watermarkOverlapSeconds,...(sourceCutoff?{sourceCutoff:sourceCutoff.iso}:{})};
}

/** Attachment and text-policy passes preserve the source clock provenance of their input;
 * refuse a broken bounded chain rather than publish another artifact with it. Old ordinary
 * CLI exports without an externally established cutoff keep their existing behavior. */
export function validateSourceClock(source){
  if(!source||!Object.hasOwn(source,'sourceCutoff'))return;
  const cutoff=utcTime(source.sourceCutoff,'source.sourceCutoff'),clock=utcTime(source.snapshotClock,'source.snapshotClock'),watermark=utcTime(source.watermark,'source.watermark');
  if(source.watermarkOverlapSeconds!==watermarkOverlapSeconds)throw Error('Invalid source watermark overlap');
  if(cutoff.micros>clock.micros)throw Error('Source cutoff is later than the snapshot clock');
  const bound=cutoff.micros<clock.micros?cutoff.micros:clock.micros;
  if(watermark.micros>bound-BigInt(watermarkOverlapSeconds)*1000000n)throw Error('Source watermark exceeds the cutoff less overlap');
  if(source.since!==undefined&&watermark.micros<=utcTime(source.since,'source.since').micros)throw Error('Source cutoff does not advance the watermark beyond source.since');
}

const touchedSql=(info,since)=>{const present=timeColumns.filter(col=>info.columns.some(c=>c.col===col));return present.length?{sql:present.map(col=>`${identifier(col)}>=?`).join(' OR '),args:present.map(()=>since.sql)}:null;};

/** Read, inside the snapshot, the ids a delta must carry beyond its touched rows: the media
 * changed since `since` (their pivots and attachment bytes travel with them) and the parent
 * conversation of every changed message, event, participant, bucket and message file, so
 * the importer refreshes the conversation's revision and last message. */
export async function deltaScope(connection,schema,scopes,since){
  const ids=async(sql,args)=>new Set((await connection.query({sql,values:args}))[0].map(row=>String(row.id)));
  const media=new Set(),parents=new Set();
  if(scopes.has('media')){const t=touchedSql(schema.get('media'),since),s=scopes.get('media');if(t)for(const id of await ids(`SELECT id FROM \`media\` WHERE (${s.where}) AND (${t.sql})`,[...s.args,...t.args]))media.add(id);}
  for(const table of conversationChildren){
    if(!scopes.has(table))continue;const t=touchedSql(schema.get(table),since),s=scopes.get(table);if(!t)continue;
    for(const id of await ids(`SELECT DISTINCT conversation_id AS id FROM ${identifier(table)} WHERE (${s.where}) AND (${t.sql})`,[...s.args,...t.args]))parents.add(id);
  }
  if(media.size&&scopes.has('mediables')&&scopes.has('messages')){
    const list=[...media];
    for(let i=0;i<list.length;i+=1000){const part=list.slice(i,i+1000);
      for(const id of await ids(`SELECT DISTINCT conversation_id AS id FROM \`messages\` WHERE id IN (SELECT mediable_id FROM \`mediables\` WHERE mediable_type=? AND media_id IN (${part.map(()=>'?').join(',')}))`,['App\\Models\\Message',...part]))parents.add(id);}
  }
  parents.delete('null');
  return {media,parents};
}

/** Whether a streamed row belongs in a delta's row chunks. A row with no timestamp at all
 * cannot be shown untouched, so it is carried (the import makes it a no-op). */
export function inDelta(table,row,{since,scope,authors}){
  if(table==='mediables')return scope.media.has(String(row.media_id));
  if(table==='media')return scope.media.has(String(row.id));
  if(table==='conversations'&&scope.parents.has(String(row.id)))return true;
  // A user a changed row refers to must exist in the seed before that row is applied.
  if(table==='users'&&authors.has(String(row.id)))return true;
  const times=timeColumns.filter(col=>row[col]!==undefined&&row[col]!==null);
  return !times.length||times.some(col=>Date.parse(row[col])>=since.ms);
}
