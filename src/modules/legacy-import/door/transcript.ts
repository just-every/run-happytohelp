import type {D1Database} from '../../import-kit/src/d1/types'
import {relationships,useRelationships} from '../relationships'
import type {LegacyBundle,Row} from '../types'

/** Gone source messages remain native history. Include their ordering metadata
 * when deriving the whole transcript, without adding source records or effects.
 * Keep source find/deletion lookups intact for archive-only/media decisions. */
export async function retainedTranscriptContext(db:D1Database,destination:string,bundle:LegacyBundle):Promise<LegacyBundle>{
 const active=(bundle.tables.messages??[]).filter(row=>!row.deleted_at),ids=new Set(active.map(row=>String(row.id)))
 const native=(await db.prepare(`SELECT m.id,m.project_id,m.conversation_id,m.local_id,m.created_at
  FROM legacy_door_targets origin JOIN messages m ON m.id=json_extract(origin.keys_json,'$[0]')
  WHERE origin.project_id=? AND origin.table_name='messages' AND m.project_id=?`).bind(destination,destination).all<Row>()).results
 const retained=native.filter(row=>!ids.has(String(row.id)))
 if(!retained.length)return bundle
 const source=relationships(bundle),history=relationships({...bundle,tables:{...bundle.tables,messages:[...active,...retained]}})
 return useRelationships(bundle,{...source,messages:history.messages,revisions:history.revisions,localIdOwner:history.localIdOwner})
}
