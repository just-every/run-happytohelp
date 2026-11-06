import {readPart} from './package.mjs';

/** A delta package (`snapshot --since`) records the time its rows were selected from. */
export const isDelta=manifest=>typeof manifest.source.since==='string';

/** Plan a delta before its first write: read its messages, conversations and media, the
 * messages this same package already appended (an interrupted run resumes the same plan),
 * and the seed's state for them. */
export async function deltaPlan(root,manifest,target,{planDelta,context,chunks,chunkRun}){
  const messages=[],media=[],conversations=new Set(),ours=new Set();
  for(const {part} of chunks){
    if(!['messages','conversations','media'].includes(part.table))continue;
    const rows=await readPart(root,part);
    if(part.table==='conversations')for(const row of rows)conversations.add(String(row.id));
    else (part.table==='messages'?messages:media).push(...rows);
    if(part.table==='messages')for(const row of (await target.env.DB.prepare("SELECT source_id FROM legacy_import_rows WHERE run_id=? AND source_table='messages' AND status='mapped'").bind(await chunkRun(part,rows)).all()).results)ours.add(String(row.source_id));
    await target.renew?.();
  }
  return planDelta(target.env.DB,{projectId:String(manifest.source.projectId),context,conversations,messages,media,ours});
}

const counters=['sourceRows','replayed','mapped','updated','unchanged','conflict','kept','erased','skipped','archived_only'];
export const emptyDeltaTotals=()=>Object.fromEntries(counters.map(key=>[key,0]));
export function addDeltaTotals(total,result){for(const key of counters)total[key]+=result[key]||0;}
/** The delta's part of the command summary: per table and overall counts, and every conflict
 * by table, id and reason (no content). */
export function deltaSummary(manifest,tables,conflicts,withheld){
  const sum=key=>Object.values(tables).reduce((n,t)=>n+t[key],0);
  return {delta:{since:manifest.source.since,watermark:manifest.source.watermark},appended:sum('mapped'),updated:sum('updated'),unchanged:sum('unchanged'),kept:sum('kept'),erased:sum('erased'),skipped:sum('skipped'),archivedOnly:sum('archived_only'),withheldObjects:withheld,conflictCount:conflicts.length,conflicts};
}
