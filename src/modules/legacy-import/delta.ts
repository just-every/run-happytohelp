import type { Env } from '../../platform/env'
import { type LegacyBundle,type Row,type MappedRow,stable } from './types'
import {planImport,writtenColumns,canonicalRows} from './importer'
import {identity,targetSchemas,byteSlices,jsonBytes} from './d1'
import {readStates,stateEntry,stateKey,targetKeyOf,unchangedSinceImport,type ImportState} from './state'
import {projectTables,identityTables,contactsOf} from './delta-scope'
import type {DeltaPlan} from './delta-plan'
import {deltaBatch} from './delta-batch'

export interface DeltaConflict {sourceTable:string;sourceId:string;targetTable:string;targetKey:string;reason:string}
export type DeltaStatus='mapped'|'updated'|'unchanged'|'conflict'|'kept'|'erased'|'archived_only'
type Planned=Awaited<ReturnType<typeof planImport>>['rows'][number]
export interface Decision {source:Planned;status:DeltaStatus;mapped:MappedRow[];appends:MappedRow[];updates:{mapped:MappedRow;changed:string[]}[];state:unknown[][];conflicts:DeltaConflict[];target:{table:string|null;key:string|null}}

/** Seed-derived transcript positions replace the ones mapping computes from legacy alone. */
function positioned(mapped:MappedRow,plan:DeltaPlan):MappedRow{
 const id=String(mapped.row.id)
 if(mapped.table==='messages'&&plan.messages.has(id))return {...mapped,row:{...mapped.row,...plan.messages.get(id)}}
 if(mapped.table==='conversations'&&plan.conversations.has(id))return {...mapped,row:{...mapped.row,...plan.conversations.get(id)}}
 return mapped
}

/** Apply one chunk of a delta package (see README "Delta sweeps"). Per mapped row: append what
 * the seed does not have; update what the seed has not changed since it was imported; leave a row
 * changed in both places and list it as a conflict; write nothing for a row already equal. Rows
 * of the legacy project, of erased contacts and held by the plan are journaled, never applied. */
export async function importDelta(env:Pick<Env,'DB'|'FILES'>,bundle:LegacyBundle,options:{context:LegacyBundle;objectKeys?:Set<string>;checkOnly?:boolean;plan:DeltaPlan;projectId:string}){
 const plan=await planImport(bundle,options),{plan:delta,context}=options
 const existing=await env.DB.prepare('SELECT bundle_digest,state FROM legacy_import_runs WHERE id=?').bind(plan.id).first<{bundle_digest:string;state:string}>()
 if(existing&&existing.bundle_digest!==plan.bundleDigest)throw new Error('Import digest conflict')
 const priors=new Map((await env.DB.prepare('SELECT source_table,source_id,row_digest FROM legacy_import_rows WHERE run_id=?').bind(plan.id).all<{source_table:string;source_id:string;row_digest:string}>()).results.map(r=>[identity(r.source_table,[r.source_id]),r.row_digest]))
 for(const source of plan.rows){const prior=priors.get(identity(source.table,[source.sourceId]));if(prior!==undefined&&prior!==source.rowDigest)throw new Error('Source row replay differs')}
 const pending=plan.rows.filter(source=>!priors.has(identity(source.table,[source.sourceId]))).map(source=>({...source,mapped:source.mapped.map(m=>positioned(m,delta))}))
 const replayed=plan.rows.length-pending.length
 // A rerun writes nothing and lists the conflicts this chunk's run recorded.
 const conflicts:DeltaConflict[]=replayed?(await env.DB.prepare('SELECT source_table sourceTable,source_id sourceId,target_table targetTable,target_key targetKey,reason FROM legacy_import_conflicts WHERE run_id=?').bind(plan.id).all<DeltaConflict>()).results.map(c=>({...c})):[]
 const schemas=await targetSchemas(env.DB,pending.flatMap(source=>source.mapped.map(m=>m.table)))
 const columnsOf=writtenColumns(schemas)
 const proposed=await canonicalRows(env.DB,pending.flatMap(source=>source.mapped),columnsOf)
 const states=await readStates(env.DB,pending.flatMap(source=>source.mapped.map(m=>[m.table,targetKeyOf(m)] as [string,string])))
 const earlier=await earlierTargets(env.DB,pending.filter(source=>!source.mapped.length).map(source=>[source.table,source.sourceId]))
 const decisions:Decision[]=[]
 for(const source of pending){
  const decision:Decision={source,status:'unchanged',mapped:source.mapped,appends:[],updates:[],state:[],conflicts:[],target:{table:source.mapped.map(m=>m.table).join(',')||null,key:source.mapped.map(targetKeyOf).join(',')||null}}
  decisions.push(decision)
  const conflict=(m:{table:string;key:string},reason:string)=>decision.conflicts.push({sourceTable:source.table,sourceId:source.sourceId,targetTable:m.table,targetKey:m.key,reason})
  // A row that maps to nothing now (legacy deleted it) is journaled against where an earlier run mapped it.
  const prior=source.mapped.length?undefined:earlier.get(identity(source.table,[source.sourceId]))
  if(prior)decision.target=prior
  if(source.table==='projects'||source.mapped.some(m=>projectTables.has(m.table))){decision.status='kept';continue}
  if(contactsOf(source.table,source.row,context).some(c=>delta.erased.has(c))){decision.status='erased';continue}
  if(!source.mapped.length){
   decision.status='archived_only'
   // Legacy deleted a row the seed already holds; a delta never deletes it.
   if(prior){decision.status='conflict';conflict({table:String(prior.table).split(',')[0],key:String(prior.key).split(',')[0]},'deleted in legacy; the seed keeps its row')}
   continue
  }
  const heldBy=delta.held.get(`${source.table}:${source.sourceId}`)
  if(heldBy!==undefined){decision.status='conflict';for(const m of source.mapped)conflict({table:m.table,key:targetKeyOf(m)},`held: conversation ${heldBy} changed in the seed since import`);continue}
  for(const m of source.mapped){
   const row=columnsOf(m),key=targetKeyOf(m),id=identity(m.table,m.key.map(k=>row[k])),canonical=proposed.get(id),state=states.get(stateKey(m.table,key))
   // A row the importer wrote that is gone now was deleted in the seed: a delta never brings it back.
   if(!canonical&&state){if(state.source_digest!==source.rowDigest)conflict({table:m.table,key},'deleted in the seed since import');continue}
   if(!canonical){decision.appends.push(m);decision.state.push(await stateEntry(m.table,key,row,source.rowDigest,plan.id,source.table,source.sourceId));continue}
   const changed=Object.keys(row).filter(column=>canonical[column]!==row[column])
   if(!changed.length){if(!await recorded(state,row,source.rowDigest))decision.state.push(await stateEntry(m.table,key,row,source.rowDigest,plan.id,source.table,source.sourceId));continue}
   const reason=await conflictReason(m,canonical,state,source.rowDigest,delta)
   if(reason===null)continue
   if(reason)conflict({table:m.table,key},reason)
   else{decision.updates.push({mapped:m,changed});decision.state.push(await stateEntry(m.table,key,row,source.rowDigest,plan.id,source.table,source.sourceId))}
  }
  if(decision.conflicts.length){decision.status='conflict';decision.appends=[];decision.updates=[];decision.state=[];continue}
  decision.status=decision.updates.length?'updated':decision.appends.length?'mapped':'unchanged'
  for(const m of [...decision.appends,...decision.updates.map(u=>u.mapped)]){const row=columnsOf(m);proposed.set(identity(m.table,m.key.map(k=>row[k])),{...(proposed.get(identity(m.table,m.key.map(k=>row[k])))??{}),...row})}
  for(const entry of decision.state)states.set(stateKey(String(entry[0]),String(entry[1])),{columns:String(entry[2]),digest:String(entry[3]),source_digest:String(entry[4])} as ImportState)
 }
 conflicts.push(...decisions.flatMap(d=>d.conflicts))
 const counts={sourceRows:plan.rows.length,replayed,mapped:0,updated:0,unchanged:0,conflict:0,kept:0,erased:0,archived_only:0}
 for(const d of decisions)counts[d.status]++
 const summary={id:plan.id,...counts,mappedRows:plan.summary.mappedRows,holds:decisions.flatMap(d=>d.status==='mapped'||d.status==='updated'?d.mapped.filter(m=>m.hold).map(m=>`${d.source.table}:${d.source.sourceId}: ${m.hold}`):[]),conflicts}
 if(options.checkOnly)return {...summary,applied:0,d1Ms:0}
 await env.DB.prepare("INSERT OR IGNORE INTO legacy_import_runs VALUES(?,?,?,'running',?,NULL)").bind(plan.id,stable(plan.source),plan.bundleDigest,Date.now()).run()
 let d1Ms=0
 const sized=decisions.map(d=>({d,bytes:Math.max(jsonBytes(d.source.row),...d.mapped.map(m=>jsonBytes(columnsOf(m))),jsonBytes(d.state))}))
 for(const group of byteSlices(sized,item=>item.bytes,100)){
  const result=await env.DB.batch(deltaBatch(env.DB,options.projectId,plan.id,group.map(g=>g.d),columnsOf))
  d1Ms+=result.reduce((ms,r)=>ms+Number(r.meta?.duration||0),0)
 }
 await env.DB.prepare("UPDATE legacy_import_runs SET state='complete',completed_at=? WHERE id=? AND state<>'complete'").bind(Date.now(),plan.id).run()
 return {...summary,applied:decisions.length,d1Ms:Math.round(d1Ms)}
}

/** null: nothing to apply (legacy has not changed the row since its import; the seed keeps its own
 * change). '': update. Otherwise why the row is left as the seed has it. */
async function conflictReason(m:MappedRow,canonical:Row,state:ImportState|undefined,sourceDigest:string,plan:DeltaPlan){
 const conversation=m.table==='conversations'?String(m.row.id):undefined
 const held=conversation!==undefined?plan.heldIn.get(conversation):undefined
 if(!await unchangedSinceImport(canonical,state)){
  if(state&&state.source_digest===sourceDigest&&!held&&!(conversation&&plan.gaining.has(conversation)))return null
  if(held)return `changed in the seed since import; ${held} new legacy messages held`
  return state?'changed in the seed since import':'no import state: changed in the seed, or imported before delta state was recorded (replay the original package once)'
 }
 if(identityTables.has(m.table))return 'identity or authority row: a delta never updates it'
 if(m.table==='conversations'&&canonical.status_category==='closed')return 'closed ticket'
 return ''
}

/** The import state already holds this written row as confirmed from this source row. */
async function recorded(state:ImportState|undefined,row:Row,sourceDigest:string){return !!state&&state.source_digest===sourceDigest&&await unchangedSinceImport(row,state)&&JSON.parse(state.columns).length===Object.keys(row).length}

/** Where earlier runs mapped these source rows, for rows that map to nothing now (deleted in legacy). */
async function earlierTargets(db:D1Database,sources:[string,string][]){
 const found=new Map<string,{table:string|null;key:string|null}>()
 for(const part of byteSlices(sources,jsonBytes)){
  const rows=(await db.prepare("SELECT source_table,source_id,target_table,target_key FROM legacy_import_rows WHERE (source_table,source_id) IN (SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]') FROM json_each(?)) AND target_table IS NOT NULL").bind(JSON.stringify(part)).all<{source_table:string;source_id:string;target_table:string;target_key:string}>()).results
  for(const row of rows)found.set(identity(row.source_table,[row.source_id]),{table:row.target_table,key:row.target_key})
 }
 return found
}
