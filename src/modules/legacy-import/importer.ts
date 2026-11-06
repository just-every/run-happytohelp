import type { Env } from '../../platform/env'
import { type LegacyBundle,type Row,type MappedRow,stable,digest,text } from './types'
import {relationships} from './relationships'
import {mapLegacy,tableOrder} from './mapping'
import {sqlName,groupBy,byteSlices,insertJson,jsonBytes,identity,targetSchemas,lookupRows} from './d1'
import {stateEntry,stateStatement,readStates,stateKey,targetKeyOf} from './state'
export async function planImport(bundle:LegacyBundle,options:{context?:LegacyBundle;objectKeys?:Set<string>}={}){
 if(bundle.format!=='happytohelp-legacy-v1'||!bundle.tables||!bundle.source?.revision||!bundle.source.repository||!Number.isFinite(Date.parse(bundle.source.exportedAt)))throw new Error('Invalid legacy bundle provenance')
 const bundleDigest=await digest(stable(bundle)),rows=[]
 for(const table of Object.keys(bundle.tables).sort((a,b)=>{const ia=tableOrder.indexOf(a),ib=tableOrder.indexOf(b);return (ia<0?1000:ia)-(ib<0?1000:ib)||a.localeCompare(b)})){
 if(!Array.isArray(bundle.tables[table]))throw new Error(`Expected row array for ${table}`)
 let sourceRows=[...bundle.tables[table]]
 if(table==='categories'||table==='knowledge_categories'){const depth=(r:Row,seen=new Set<string>()):number=>{if(!r.parent_id)return 0;const key=String(r.id);if(seen.has(key))throw new Error('Category parent cycle');seen.add(key);const parent=sourceRows.find(p=>String(p.id)===String(r.parent_id));return parent?1+depth(parent,seen):1};sourceRows.sort((a,b)=>depth(a)-depth(b))}
 const seen=new Set<string>();for(const row of sourceRows){if(!row||Array.isArray(row)||typeof row!=='object')throw new Error(`Invalid ${table} row`);const rowDigest=await digest(stable(row)),sourceId=String(row.id??row.event_id??row.token_hash??rowDigest);if(seen.has(sourceId))throw new Error(`Duplicate source identity ${table}:${sourceId}`);seen.add(sourceId);rows.push({table,sourceId,row,rowDigest,mapped:mapLegacy(table,row,options.context??bundle)})}
 }
 const mappedRows=rows.flatMap(row=>row.mapped);const conversationScopes=new Map(mappedRows.filter(m=>m.table==='conversations').map(m=>[String(m.row.id),m.row]));const contacts=new Map(mappedRows.filter(m=>m.table==='contacts').map(m=>[String(m.row.id),m.row]));for(const mapped of mappedRows){const r=mapped.row;if(r.conversation_id&&r.project_id){const conv=conversationScopes.get(String(r.conversation_id))??(options.context?relationships(options.context).find('conversations',r.conversation_id):undefined);if(conv&&conv.project_id!==r.project_id)throw new Error(`Cross-project legacy reference in ${mapped.table}:${r.id}`)}if(mapped.table==='conversations'){const contact=contacts.get(String(r.contact_id))??(options.context?relationships(options.context).find('contacts',r.contact_id):undefined);if(contact&&contact.project_id!==r.project_id)throw new Error(`Cross-project legacy conversation contact: ${r.id}`)}}
 const keys=new Set<string>(options.objectKeys);for(const object of bundle.objects||[]){if(!object.key||object.key.startsWith('/')||object.key.split('/').includes('..')||keys.has(object.key))throw new Error('Invalid or duplicate object key');keys.add(object.key);const bytes=Uint8Array.from(atob(object.dataBase64),c=>c.charCodeAt(0));if(await digest(bytes)!==object.sha256)throw new Error(`Object digest mismatch: ${object.key}`)}
 const mediaRows=rows.flatMap(row=>row.mapped.filter(m=>m.table==='media'));for(const media of mediaRows){if(!keys.has(String(media.row.object_key)))throw new Error(`Media ${media.row.id} requires exported bytes for ${media.row.object_key}`)}
 return {id:`legacy:${bundleDigest}`,bundleDigest,source:bundle.source,rows,objects:bundle.objects||[],summary:{sourceRows:rows.length,mappedRows:rows.reduce((n,r)=>n+r.mapped.length,0),archivedOnly:rows.filter(r=>!r.mapped.length).map(r=>`${r.table}:${r.sourceId}`),holds:rows.flatMap(r=>r.mapped.filter(m=>m.hold).map(m=>`${r.table}:${r.sourceId}: ${m.hold}`)),objects:keys.size}}
}
export async function importLegacy(env:Pick<Env,'DB'|'FILES'>,bundle:LegacyBundle,options:{context?:LegacyBundle;objectKeys?:Set<string>;checkOnly?:boolean}={}){
 if(bundle.source?.since!==undefined||bundle.source?.delta!==undefined)throw new Error('A delta export imports only as a package (--package), which applies it update-aware')
 const plan=await planImport(bundle,options),existing=await env.DB.prepare('SELECT id,bundle_digest,state FROM legacy_import_runs WHERE id=?').bind(plan.id).first<{id:string;bundle_digest:string;state:string}>();if(existing&&existing.bundle_digest!==plan.bundleDigest)throw new Error('Import digest conflict')
 // A run's journal is read once. Existing canonical rows are looked up, and new
 // rows written, as one JSON array parameter per statement, so a production-sized
 // chunk costs a few D1 round trips and never approaches D1's 100 bound
 // parameters. Each group commits its canonical writes, holds and
 // legacy_import_rows records together in one batch.
 const priors=new Map((await env.DB.prepare('SELECT source_table,source_id,row_digest FROM legacy_import_rows WHERE run_id=?').bind(plan.id).all<{source_table:string;source_id:string;row_digest:string}>()).results.map(r=>[identity(r.source_table,[r.source_id]),r.row_digest]))
 let applied=0,replayed=0,d1Ms=0,maxBatchMs=0
 for(const source of plan.rows){const prior=priors.get(identity(source.table,[source.sourceId]));if(prior!==undefined){if(prior!==source.rowDigest)throw new Error('Source row replay differs');replayed++}}
 const pending=plan.rows.filter(source=>!priors.has(identity(source.table,[source.sourceId])))
 const replayedRows=plan.rows.filter(source=>priors.has(identity(source.table,[source.sourceId])))
 const schemas=await targetSchemas(env.DB,plan.rows.flatMap(source=>source.mapped.map(m=>m.table)))
 const columnsOf=writtenColumns(schemas)
 const current=await canonicalRows(env.DB,pending.flatMap(source=>source.mapped),columnsOf)
 // Preflight every canonical row and object before changing either store. A
 // conflict in a later batch/chunk must not leave earlier business rows applied.
 const proposed=new Map(current)
 for(const source of pending)for(const mapped of source.mapped){
  const row=columnsOf(mapped),values=mapped.key.map(k=>row[k]),id=identity(mapped.table,values),prior=proposed.get(id)
  if(prior){for(const [key,value]of Object.entries(row))if(prior[key]!==value)throw new Error(`Existing data conflict ${mapped.table}:${values.join(':')} column ${key}; no rows overwritten`)}
  else proposed.set(id,row)
 }
 const objects=[]
 for(const object of plan.objects){
  const erased=await env.DB.prepare("SELECT 1 FROM legacy_import_rows WHERE run_id=? AND source_table='media' AND source_id IN (SELECT json_extract(value,'$.id') FROM json_each(?)) AND source_json='{}' LIMIT 1").bind(plan.id,JSON.stringify((options.context??bundle).tables.media?.filter(row=>String(row.object_key||row.storage_key)===object.key)??[])).first()
  if(erased)continue
  const current=await env.FILES.get(object.key)
  if(current&&await digest(new Uint8Array(await current.arrayBuffer()))!==object.sha256)throw new Error(`Existing R2 object differs: ${object.key}`)
  objects.push(object)
 }
 if(options.checkOnly)return {id:plan.id,...plan.summary,applied:0,replayed,d1Ms:0,maxBatchMs:0}
 await env.DB.prepare("INSERT OR IGNORE INTO legacy_import_runs VALUES(?,?,?,'running',?,NULL)").bind(plan.id,stable(plan.source),plan.bundleDigest,Date.now()).run()
 await confirmReplayedState(env.DB,plan.id,replayedRows,columnsOf)
 for(const object of objects){const bytes=Uint8Array.from(atob(object.dataBase64),c=>c.charCodeAt(0)),current=await env.FILES.get(object.key);if(current&&await digest(new Uint8Array(await current.arrayBuffer()))!==object.sha256)throw new Error(`Existing R2 object differs: ${object.key}`);if(!current){const stored=await env.FILES.put(object.key,bytes,{onlyIf:{etagDoesNotMatch:'*'},customMetadata:{sha256:object.sha256,legacyImport:plan.id}});if(!stored){const raced=await env.FILES.get(object.key);if(!raced||await digest(new Uint8Array(await raced.arrayBuffer()))!==object.sha256)throw new Error(`Concurrent R2 object conflict: ${object.key}`)}};await env.DB.prepare('INSERT OR IGNORE INTO legacy_import_objects VALUES(?,?,?,?)').bind(plan.id,object.key,object.sha256,bytes.length).run()}
 // Each source row's share of every statement its group binds: its journal entry, its holds,
 // its reporting row and its canonical rows' values. A group is sized by the largest of these,
 // so no statement's JSON parameter can outgrow the group, however small the rows are.
 // Every written or confirmed target records its import state with it, so a later delta can tell whether the seed changed it.
 const writes=await Promise.all(pending.map(async source=>{
  const conversation=source.table==='conversations'&&source.mapped.find(m=>m.table==='conversations')
  const state=await Promise.all(source.mapped.map(m=>stateEntry(m.table,targetKeyOf(m),columnsOf(m),source.rowDigest,plan.id,source.table,source.sourceId)))
  const write={source,journal:[plan.id,source.table,source.sourceId,source.rowDigest,stable(source.row),source.mapped.map(m=>m.table).join(',')||null,source.mapped.map(m=>m.key.map(k=>m.row[k]).join(':')).join(',')||null,source.mapped.length?'mapped':'archived_only'],holds:source.mapped.filter(m=>m.hold).map(m=>[`${plan.id}:${source.table}:${source.sourceId}`,plan.id,source.table,source.sourceId,m.hold]),reporting:conversation?[conversation.row.project_id,conversation.row.id,plan.id]:null,state}
  const sum=(values:unknown[])=>values.reduce<number>((n,value)=>n+jsonBytes(value),0)
  return {...write,bytes:Math.max(jsonBytes(write.journal),sum(write.holds),jsonBytes(write.reporting),sum(state),sum(source.mapped.map(m=>Object.values(columnsOf(m)))))}
 }))
 for(const group of byteSlices(writes,write=>write.bytes)){
  const inserts=new Map<string,Map<string,unknown[][]>>(),holds:unknown[][]=[],reporting:unknown[][]=[],journal:unknown[][]=[],state:unknown[][]=[]
  for(const {source,journal:entry,holds:held,reporting:report,state:confirmed} of group){
   state.push(...confirmed)
   for(const mapped of source.mapped){
    const row=columnsOf(mapped),keyValues=mapped.key.map(k=>row[k]),id=identity(mapped.table,keyValues),existingRow=current.get(id)
    if(existingRow){for(const [key,value]of Object.entries(row))if(existingRow[key]!==value)throw new Error(`Existing data conflict ${mapped.table}:${keyValues.join(':')} column ${key}; no rows overwritten`)}
    else{const names=Object.keys(row),byColumns=inserts.get(mapped.table)??new Map<string,unknown[][]>();inserts.set(mapped.table,byColumns);const values=byColumns.get(names.join(','))??[];byColumns.set(names.join(','),values);values.push(names.map(k=>row[k]));current.set(id,row)}
   }
   holds.push(...held);if(report)reporting.push(report);journal.push(entry)
  }
  // Tables keep their first-mapped order, so a parent row precedes the rows that reference it.
  const statements=[...inserts].flatMap(([table,byColumns])=>[...byColumns].map(([names,values])=>insertJson(env.DB,`INSERT INTO ${sqlName(table)} (${names.split(',').map(sqlName).join(',')})`,names.split(',').length,values)))
  if(holds.length)statements.push(insertJson(env.DB,'INSERT OR IGNORE INTO legacy_import_holds(id,run_id,source_table,source_id,reason)',5,holds))
  if(reporting.length)statements.push(insertJson(env.DB,'INSERT OR IGNORE INTO reporting_legacy_conversations(project_id,conversation_id,run_id)',3,reporting))
  if(state.length)statements.push(stateStatement(env.DB,state))
  statements.push(insertJson(env.DB,'INSERT INTO legacy_import_rows(run_id,source_table,source_id,row_digest,source_json,target_table,target_key,status)',8,journal))
  // D1 reports each statement's server time; the batch's sum is its share of the database's CPU.
  const batch=(await env.DB.batch(statements)).reduce((ms,result)=>ms+Number(result.meta?.duration||0),0);applied+=group.length;d1Ms+=batch;maxBatchMs=Math.max(maxBatchMs,batch)
 }
 await env.DB.prepare("UPDATE legacy_import_runs SET state='complete',completed_at=? WHERE id=?").bind(Date.now(),plan.id).run();return {id:plan.id,...plan.summary,applied,replayed,d1Ms:Math.round(d1Ms),maxBatchMs:Math.round(maxBatchMs)}
}
/** The mapped columns the target table has, objects as their stable JSON: what the importer writes. */
export function writtenColumns(schemas:Map<string,Set<string>>){return (mapped:MappedRow)=>Object.fromEntries(Object.entries(mapped.row).filter(([key,value])=>schemas.get(mapped.table)!.has(key)&&value!==undefined).map(([key,value])=>[key,typeof value==='object'&&value!==null?stable(value):value])) as Row}
/** The canonical rows behind mapped targets, by identity (null where none exists). Key columns
 * are required and non-null, so a row-value IN reaches each key through its index. */
export async function canonicalRows(db:D1Database,mapped:MappedRow[],columnsOf:(m:MappedRow)=>Row){
 const current=new Map<string,Row|null>()
 for(const [shape,rows] of groupBy(mapped,m=>m.table+'\u0000'+m.key.join(','),m=>m)){
  const [table,keyList]=shape.split('\u0000'),keys=keyList.split(','),seen=new Set<string>()
  const wanted=rows.map(m=>{const row=columnsOf(m);for(const key of keys)text(row[key],`${table}.${key}`);return keys.map(k=>row[k])}).filter(values=>{const id=identity(table,values);if(seen.has(id))return false;seen.add(id);return true})
  await lookupRows(db,table,keys,wanted,current)
 }
 return current
}
/** An exact replay records the import state of rows journaled before state existed, for each
 * target whose canonical row still equals its mapping. It writes no business row: a target the
 * seed has changed since gets no state, so a later delta lists it as a conflict. */
async function confirmReplayedState(db:D1Database,runId:string,replayed:{table:string;sourceId:string;rowDigest:string;mapped:MappedRow[]}[],columnsOf:(m:MappedRow)=>Row){
 const targets=replayed.flatMap(source=>source.mapped.map(m=>({source,m,key:targetKeyOf(m)})))
 if(!targets.length)return
 const states=await readStates(db,targets.map(t=>[t.m.table,t.key]))
 const missing=targets.filter(t=>!states.has(stateKey(t.m.table,t.key)))
 if(!missing.length)return
 const current=await canonicalRows(db,missing.map(t=>t.m),columnsOf),entries:unknown[][]=[]
 for(const {source,m,key} of missing){
  const row=columnsOf(m),existing=current.get(identity(m.table,m.key.map(k=>row[k])))
  if(existing&&Object.entries(row).every(([column,value])=>existing[column]===value))entries.push(await stateEntry(m.table,key,row,source.rowDigest,runId,source.table,source.sourceId))
 }
 for(const part of byteSlices(entries,jsonBytes))await db.batch([stateStatement(db,part)])
}
