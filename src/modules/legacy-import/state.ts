import { type Row,type MappedRow,stable,digest } from './types'
import { byteSlices,insertJson,jsonBytes } from './d1'
// legacy_import_state records, per canonical row the importer wrote or confirmed, the
// digest of the columns it wrote and of the legacy source row they came from. A delta
// compares them with the row as it is now: equal means the seed has not changed it since.
export interface ImportState {target_table:string;target_key:string;columns:string;digest:string;source_digest:string;run_id:string;source_table:string;source_id:string}
export const stateKey=(table:string,key:string)=>table+'\u0000'+key
/** The target key as the journal records it: key column values joined by ':'. */
export const targetKeyOf=(mapped:MappedRow)=>mapped.key.map(k=>mapped.row[k]).join(':')
/** Digest of `row` over `columns`, a missing column counting as NULL. */
export const columnsDigest=(row:Row,columns:string[])=>digest(stable(Object.fromEntries(columns.map(c=>[c,row[c]??null]))))
/** The state entry for a written or confirmed target, in legacy_import_state column order. */
export async function stateEntry(table:string,key:string,written:Row,sourceDigest:string,runId:string,sourceTable:string,sourceId:string){
 const columns=Object.keys(written).sort()
 return [table,key,JSON.stringify(columns),await columnsDigest(written,columns),sourceDigest,runId,sourceTable,sourceId]
}
export const stateStatement=(db:D1Database,entries:unknown[][])=>insertJson(db,'INSERT OR REPLACE INTO legacy_import_state(target_table,target_key,columns,digest,source_digest,run_id,source_table,source_id)',8,entries)
export async function readStates(db:D1Database,targets:[string,string][]){
 const states=new Map<string,ImportState>(),unique=[...new Map(targets.map(t=>[stateKey(...t),t])).values()]
 for(const part of byteSlices(unique,jsonBytes)){
  const found=await db.prepare("SELECT * FROM legacy_import_state WHERE (target_table,target_key) IN (SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]') FROM json_each(?))").bind(JSON.stringify(part)).all<ImportState>()
  for(const row of found.results)states.set(stateKey(row.target_table,row.target_key),row)
 }
 return states
}
/** Whether the canonical row still holds exactly what the importer last wrote or confirmed. */
export async function unchangedSinceImport(canonical:Row,state:ImportState|undefined){return !!state&&await columnsDigest(canonical,JSON.parse(state.columns))===state.digest}
