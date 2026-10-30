import type { Env } from '../../platform/env'
import { type LegacyBundle,type Row,type MappedRow,stable,digest,text } from './types'
function groupBy<T,V>(items:T[],key:(item:T)=>string,value:(item:T)=>V){const groups=new Map<string,V[]>();for(const item of items){const k=key(item);if(!groups.has(k))groups.set(k,[]);groups.get(k)!.push(value(item))}return groups}
import {relationships} from './relationships'
import {mapLegacy,tableOrder} from './mapping'
const sqlName=(value:string)=>{if(!/^[a-z][a-z0-9_]*$/.test(value))throw new Error('Unsafe table or column name');return '"'+value+'"'}
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
 const plan=await planImport(bundle,options),existing=await env.DB.prepare('SELECT id,bundle_digest,state FROM legacy_import_runs WHERE id=?').bind(plan.id).first<{id:string;bundle_digest:string;state:string}>();if(existing&&existing.bundle_digest!==plan.bundleDigest)throw new Error('Import digest conflict')
 // A run's journal is read once. Existing canonical rows are looked up, and new
 // rows written, as one JSON array parameter per statement, so a production-sized
 // chunk costs a few D1 round trips and never approaches D1's 100 bound
 // parameters. Each group commits its canonical writes, holds and
 // legacy_import_rows records together in one batch.
 const identity=(table:string,values:unknown[])=>table+'\u0000'+JSON.stringify(values)
 const priors=new Map((await env.DB.prepare('SELECT source_table,source_id,row_digest FROM legacy_import_rows WHERE run_id=?').bind(plan.id).all<{source_table:string;source_id:string;row_digest:string}>()).results.map(r=>[identity(r.source_table,[r.source_id]),r.row_digest]))
 let applied=0,replayed=0,d1Ms=0,maxBatchMs=0
 for(const source of plan.rows){const prior=priors.get(identity(source.table,[source.sourceId]));if(prior!==undefined){if(prior!==source.rowDigest)throw new Error('Source row replay differs');replayed++}}
 const pending=plan.rows.filter(source=>!priors.has(identity(source.table,[source.sourceId])))
 const schemas=await targetSchemas(env.DB,pending.flatMap(source=>source.mapped.map(m=>m.table)))
 const columnsOf=(mapped:MappedRow)=>Object.fromEntries(Object.entries(mapped.row).filter(([key,value])=>schemas.get(mapped.table)!.has(key)&&value!==undefined).map(([key,value])=>[key,typeof value==='object'&&value!==null?stable(value):value]))
 const current=new Map<string,Row|null>()
 for(const [shape,rows] of groupBy(pending.flatMap(source=>source.mapped),m=>m.table+'\u0000'+m.key.join(','),m=>m)){
  const [table,keyList]=shape.split('\u0000'),keys=keyList.split(','),seen=new Set<string>()
  const wanted=rows.map(m=>{const row=columnsOf(m);for(const key of keys)text(row[key],`${table}.${key}`);return keys.map(k=>row[k])}).filter(values=>{const id=identity(table,values);if(seen.has(id))return false;seen.add(id);return true})
  for(const part of byteSlices(wanted,jsonBytes)){
   // Key columns are required and non-null, so a row-value IN reaches each key through its index.
   const found=await env.DB.prepare(`SELECT * FROM ${sqlName(table)} WHERE (${keys.map(sqlName).join(',')}) IN (SELECT ${keys.map((_,i)=>`json_extract(value,'$[${i}]')`).join(',')} FROM json_each(?))`).bind(JSON.stringify(part)).all<Row>()
   for(const values of part)current.set(identity(table,values),null)
   for(const row of found.results)current.set(identity(table,keys.map(k=>row[k])),row)
  }
 }
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
  const erased=await env.DB.prepare("SELECT 1 FROM legacy_import_rows WHERE source_table='media' AND source_id IN (SELECT json_extract(value,'$.id') FROM json_each(?)) AND source_json='{}' LIMIT 1").bind(JSON.stringify((options.context??bundle).tables.media?.filter(row=>String(row.object_key||row.storage_key)===object.key)??[])).first()
  if(erased)continue
  const current=await env.FILES.get(object.key)
  if(current&&await digest(new Uint8Array(await current.arrayBuffer()))!==object.sha256)throw new Error(`Existing R2 object differs: ${object.key}`)
  objects.push(object)
 }
 if(options.checkOnly)return {id:plan.id,...plan.summary,applied:0,replayed,d1Ms:0,maxBatchMs:0}
 await env.DB.prepare("INSERT OR IGNORE INTO legacy_import_runs VALUES(?,?,?,'running',?,NULL)").bind(plan.id,stable(plan.source),plan.bundleDigest,Date.now()).run()
 for(const object of objects){const bytes=Uint8Array.from(atob(object.dataBase64),c=>c.charCodeAt(0)),current=await env.FILES.get(object.key);if(current&&await digest(new Uint8Array(await current.arrayBuffer()))!==object.sha256)throw new Error(`Existing R2 object differs: ${object.key}`);if(!current){const stored=await env.FILES.put(object.key,bytes,{onlyIf:{etagDoesNotMatch:'*'},customMetadata:{sha256:object.sha256,legacyImport:plan.id}});if(!stored){const raced=await env.FILES.get(object.key);if(!raced||await digest(new Uint8Array(await raced.arrayBuffer()))!==object.sha256)throw new Error(`Concurrent R2 object conflict: ${object.key}`)}};await env.DB.prepare('INSERT OR IGNORE INTO legacy_import_objects VALUES(?,?,?,?)').bind(plan.id,object.key,object.sha256,bytes.length).run()}
 // Each source row's share of every statement its group binds: its journal entry, its holds,
 // its reporting row and its canonical rows' values. A group is sized by the largest of these,
 // so no statement's JSON parameter can outgrow the group, however small the rows are.
 const writes=pending.map(source=>{
  const conversation=source.table==='conversations'&&source.mapped.find(m=>m.table==='conversations')
  const write={source,journal:[plan.id,source.table,source.sourceId,source.rowDigest,stable(source.row),source.mapped.map(m=>m.table).join(',')||null,source.mapped.map(m=>m.key.map(k=>m.row[k]).join(':')).join(',')||null,source.mapped.length?'mapped':'archived_only'],holds:source.mapped.filter(m=>m.hold).map(m=>[`${plan.id}:${source.table}:${source.sourceId}`,plan.id,source.table,source.sourceId,m.hold]),reporting:conversation?[conversation.row.project_id,conversation.row.id,plan.id]:null}
  const sum=(values:unknown[])=>values.reduce<number>((n,value)=>n+jsonBytes(value),0)
  return {...write,bytes:Math.max(jsonBytes(write.journal),sum(write.holds),jsonBytes(write.reporting),sum(source.mapped.map(m=>Object.values(columnsOf(m)))))}
 })
 for(const group of byteSlices(writes,write=>write.bytes)){
  const inserts=new Map<string,Map<string,unknown[][]>>(),holds:unknown[][]=[],reporting:unknown[][]=[],journal:unknown[][]=[]
  for(const {source,journal:entry,holds:held,reporting:report} of group){
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
  statements.push(insertJson(env.DB,'INSERT INTO legacy_import_rows(run_id,source_table,source_id,row_digest,source_json,target_table,target_key,status)',8,journal))
  // D1 reports each statement's server time; the batch's sum is its share of the database's CPU.
  const batch=(await env.DB.batch(statements)).reduce((ms,result)=>ms+Number(result.meta?.duration||0),0);applied+=group.length;d1Ms+=batch;maxBatchMs=Math.max(maxBatchMs,batch)
 }
 await env.DB.prepare("UPDATE legacy_import_runs SET state='complete',completed_at=? WHERE id=?").bind(Date.now(),plan.id).run();return {id:plan.id,...plan.summary,applied,replayed,d1Ms:Math.round(d1Ms),maxBatchMs:Math.round(maxBatchMs)}
}
// D1 limits a bound value to 2 MB. A group binds at most 1.25 MB in any one of its
// JSON parameters; a single source row too large for that is refused by insertJson.
const groupBytes=1_250_000,parameterBytes=2_000_000,utf8=new TextEncoder(),jsonBytes=(value:unknown)=>utf8.encode(JSON.stringify(value)).length
function byteSlices<T>(items:T[],size:(item:T)=>number){const result:T[][]=[];let part:T[]=[],bytes=0;for(const item of items){const n=size(item);if(part.length&&bytes+n>groupBytes){result.push(part);part=[];bytes=0}part.push(item);bytes+=n}if(part.length)result.push(part);return result}
function insertJson(db:D1Database,into:string,width:number,rows:unknown[][]){const json=JSON.stringify(rows);if(utf8.encode(json).length>parameterBytes)throw new Error('Legacy import group exceeds the D1 bound value limit');return db.prepare(`${into} SELECT ${Array.from({length:width},(_,i)=>`json_extract(value,'$[${i}]')`).join(',')} FROM json_each(?)`).bind(json)}
const schemaCache=new WeakMap<D1Database,Map<string,Set<string>>>()
async function targetSchemas(db:D1Database,tables:string[]){
 const schemas=schemaCache.get(db)??new Map<string,Set<string>>();schemaCache.set(db,schemas)
 for(const table of new Set(tables))if(!schemas.has(table)){const schema=await db.prepare(`PRAGMA table_info(${sqlName(table)})`).all<{name:string}>();if(!schema.results.length)throw new Error(`Target migration missing: ${table}`);schemas.set(table,new Set(schema.results.map(c=>c.name)))}
 return schemas
}
