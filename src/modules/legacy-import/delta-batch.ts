import { type Row,type MappedRow,stable } from './types'
import {insertJson,sqlName,parameterBytes,jsonBytes} from './d1'
import {stateStatement} from './state'
import {batchRemovedTables} from './delta-scope'
import type {Decision} from './delta'
import type {DeltaLease} from './lease'

/** One D1 batch (one transaction) for a group of delta decisions: canonical appends and updates,
 * their holds, reporting rows and import state, conflicts and journal entries commit together.
 * Every conversation the batch writes to is fenced from the workflow journal's triggers, as Move
 * in does, and any row a trigger adds to the app's work tables or resolutions is removed before it
 * commits, so applying a delta sends, notifies, dispatches, schedules and offers nothing. The batch
 * removes only the fences it inserted itself: a fence another writer (a Move in on the same
 * conversation) held before the batch stays. The batch starts by asserting the run still holds its
 * workspace's delta lease (lease.ts) and ends by clearing that assertion, so a delta whose lease lapsed
 * while an erasure took the workspace commits nothing more. */
export function deltaBatch(db:D1Database,projectId:string,runId:string,group:Decision[],columnsOf:(m:MappedRow)=>Row,lease:DeltaLease){
 const statements:D1PreparedStatement[]=[lease.assertion(db)],inserts=new Map<string,Map<string,unknown[][]>>(),updates:D1PreparedStatement[]=[]
 const holds:unknown[][]=[],reporting:unknown[][]=[],state:unknown[][]=[],conflicts:unknown[][]=[],journal:unknown[][]=[],fenced=new Set<string>(),appended=new Set<string>()
 const fence=(m:MappedRow)=>{const id=m.table==='conversations'?m.row.id:m.row.conversation_id;if(id!=null&&['conversations','messages','media','conversation_notes','conversation_participants','conversation_buckets','conversation_ai'].includes(m.table))fenced.add(String(id))}
 for(const d of group){
  for(const m of d.appends){
   const row=columnsOf(m),names=Object.keys(row),byColumns=inserts.get(m.table)??new Map<string,unknown[][]>()
   inserts.set(m.table,byColumns);const values=byColumns.get(names.join(','))??[];byColumns.set(names.join(','),values);values.push(names.map(k=>row[k]));fence(m)
   if(m.table==='conversations'){reporting.push([m.row.project_id,m.row.id,runId]);appended.add(String(m.row.id))}
  }
  for(const {mapped,changed} of d.updates){
   // Only the columns that differ are set, so no trigger on an unchanged column fires.
   const row=columnsOf(mapped),json=JSON.stringify([...changed.map(c=>row[c]),...mapped.key.map(k=>row[k])])
   if(jsonBytes(json)>parameterBytes)throw new Error('Legacy delta row exceeds the D1 bound value limit')
   updates.push(db.prepare(`UPDATE ${sqlName(mapped.table)} SET ${changed.map((c,i)=>`${sqlName(c)}=json_extract(?1,'$[${i}]')`).join(',')} WHERE ${mapped.key.map((k,i)=>`${sqlName(k)}=json_extract(?1,'$[${changed.length+i}]')`).join(' AND ')}`).bind(json));fence(mapped)
  }
  if(d.status==='mapped'||d.status==='updated')for(const m of d.mapped)if(m.hold)holds.push([`${runId}:${d.source.table}:${d.source.sourceId}`,runId,d.source.table,d.source.sourceId,m.hold])
  state.push(...d.state)
  for(const c of [...d.conflicts,...d.listed])conflicts.push([runId,c.sourceTable,c.sourceId,c.targetTable,c.targetKey,c.reason])
  // An erased contact's rows are journaled as erasure leaves them: digest kept, verbatim copy cleared. Skipped rows are
  // legacy's copies of mail the seed's reader already holds: replay reads only the digest, so they keep no copy either.
  journal.push([runId,d.source.table,d.source.sourceId,d.source.rowDigest,d.status==='erased'||d.status==='skipped'?'{}':stable(d.source.row),d.target.table,d.target.key,d.status])
 }
 // Each fence the batch inserts is marked first, only where no fence exists yet; cleanup deletes the marked ones alone.
 const fenceStatements=(ids:string[])=>[
  db.prepare("INSERT OR IGNORE INTO legacy_import_marks(name,high) SELECT 'fence:'||value,0 FROM json_each(?2) WHERE NOT EXISTS(SELECT 1 FROM move_in_native_fences f WHERE f.project_id=?1 AND f.conversation_id=value)").bind(projectId,JSON.stringify(ids)),
  db.prepare("INSERT OR IGNORE INTO move_in_native_fences(project_id,conversation_id) SELECT ?1,value FROM json_each(?2)").bind(projectId,JSON.stringify(ids))]
 for(const t of batchRemovedTables)statements.push(db.prepare(`INSERT INTO legacy_import_marks(name,high) SELECT '${t}',COALESCE(MAX(rowid),0) FROM ${sqlName(t)}`))
 // A conversation the delta appends is fenced only after its own INSERT, so the insert trigger
 // derives its lifecycle status from resolved_at exactly as a full import does.
 const existing=[...fenced].filter(id=>!appended.has(id)),late=[...fenced].filter(id=>appended.has(id))
 if(existing.length)statements.push(...fenceStatements(existing))
 // Tables keep their first-mapped order, so a parent row precedes the rows that reference it.
 for(const [table,byColumns] of inserts){
  for(const [names,values] of byColumns)statements.push(insertJson(db,`INSERT INTO ${sqlName(table)} (${names.split(',').map(sqlName).join(',')})`,names.split(',').length,values))
  if(table==='conversations'&&late.length)statements.push(...fenceStatements(late))
 }
 statements.push(...updates)
 if(holds.length)statements.push(insertJson(db,'INSERT OR IGNORE INTO legacy_import_holds(id,run_id,source_table,source_id,reason)',5,holds))
 if(reporting.length)statements.push(insertJson(db,'INSERT OR IGNORE INTO reporting_legacy_conversations(project_id,conversation_id,run_id)',3,reporting))
 if(state.length)statements.push(stateStatement(db,state))
 if(conflicts.length)statements.push(insertJson(db,'INSERT OR IGNORE INTO legacy_import_conflicts(run_id,source_table,source_id,target_table,target_key,reason)',6,conflicts))
 statements.push(insertJson(db,'INSERT INTO legacy_import_rows(run_id,source_table,source_id,row_digest,source_json,target_table,target_key,status)',8,journal))
 if(fenced.size)statements.push(db.prepare("DELETE FROM move_in_native_fences WHERE project_id=? AND 'fence:'||conversation_id IN (SELECT name FROM legacy_import_marks WHERE name LIKE 'fence:%')").bind(projectId))
 for(const t of batchRemovedTables)statements.push(db.prepare(`DELETE FROM ${sqlName(t)} WHERE rowid>(SELECT high FROM legacy_import_marks WHERE name='${t}')`))
 statements.push(db.prepare('DELETE FROM legacy_import_marks'),lease.cleared(db))
 return statements
}
