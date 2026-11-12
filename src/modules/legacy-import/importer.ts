import type { Env } from '../../platform/env'
import { type LegacyBundle,type Row,type MappedRow,stable,digest,text } from './types'
import {relationships} from './relationships'
import {mapLegacy,tableOrder} from './mapping'
import {sqlName,groupBy,byteSlices,insertJson,jsonBytes,identity,targetSchemas,lookupRows} from './d1'
import {stateEntry,stateStatement,readStates,stateKey,targetKeyOf} from './state'
import {ofErased,heldByNativeMedia} from './erased'
import type {DeltaLease} from './lease'
import {markWorkRows,purgeWorkRows} from './work-rows'
import {importedHistoryStatements} from './imported-history'
import {mediaRewrite} from './media-rewrite'
import {bundleMediaIndex,type MediaIndex} from './media-index'
export interface PreparedIdentity {id:string;bundleDigest:string;source:LegacyBundle['source']}
export interface PreparedSlice {
 identity:PreparedIdentity
 /** False until the runner verifies every row of the ORIGINAL part. */
 finalize:false
 journalStatements?:(db:D1Database,sources:{table:string;sourceId:string}[],applied:boolean)=>D1PreparedStatement[]
 normalize:(targets:MappedRow[])=>Promise<{targets:MappedRow[];statements:D1PreparedStatement[];env:Env}>
}
export async function normalizeImportPlan(plan:Awaited<ReturnType<typeof planImport>>,env:Pick<Env,'DB'|'FILES'>,prepared?:PreparedSlice,include:(source:Awaited<ReturnType<typeof planImport>>['rows'][number])=>boolean=()=>true){
 if(!prepared)return {env,statements:[] as D1PreparedStatement[]}
 const sources=plan.rows.filter(include),mapped=sources.flatMap(source=>source.mapped),schemas=await targetSchemas(env.DB,mapped.map(row=>row.table)),columnsOf=writtenColumns(schemas)
 const normalized=await prepared.normalize(mapped.map(row=>({...row,row:columnsOf(row)})));let at=0
 for(const source of sources){source.mapped=normalized.targets.slice(at,at+source.mapped.length);at+=source.mapped.length}
 return {env:{...env,DB:normalized.env.DB},statements:normalized.statements}
}
/** `media`: the workspace's files by legacy key (media-index.ts), resolved before mapping; a `--file` export without one
 * resolves its own. Legacy storage URLs in the mapped rows are rewritten to native URLs (media-rewrite.ts). */
export async function planImport(bundle:LegacyBundle,options:{context?:LegacyBundle;objectKeys?:Set<string>;media?:MediaIndex;identity?:PreparedIdentity}={}){
 if(bundle.format!=='happytohelp-legacy-v1'||!bundle.tables||!bundle.source?.revision||!bundle.source.repository||!Number.isFinite(Date.parse(bundle.source.exportedAt)))throw new Error('Invalid legacy bundle provenance')
 const bundleDigest=options.identity?.bundleDigest??await digest(stable(bundle)),rows=[],rewrite=mediaRewrite(options.media??(options.context?undefined:bundleMediaIndex(bundle)),String(bundle.source.projectId??''))
 for(const table of Object.keys(bundle.tables).sort((a,b)=>{const ia=tableOrder.indexOf(a),ib=tableOrder.indexOf(b);return (ia<0?1000:ia)-(ib<0?1000:ib)||a.localeCompare(b)})){
 if(!Array.isArray(bundle.tables[table]))throw new Error(`Expected row array for ${table}`)
 let sourceRows=[...bundle.tables[table]]
 if(table==='categories'||table==='knowledge_categories'){const depth=(r:Row,seen=new Set<string>()):number=>{if(!r.parent_id)return 0;const key=String(r.id);if(seen.has(key))throw new Error('Category parent cycle');seen.add(key);const parent=sourceRows.find(p=>String(p.id)===String(r.parent_id));return parent?1+depth(parent,seen):1};sourceRows.sort((a,b)=>depth(a)-depth(b))}
 const seen=new Set<string>();for(const row of sourceRows){if(!row||Array.isArray(row)||typeof row!=='object')throw new Error(`Invalid ${table} row`);const rowDigest=await digest(stable(row)),sourceId=String(row.id??row.event_id??row.token_hash??rowDigest);if(seen.has(sourceId))throw new Error(`Duplicate source identity ${table}:${sourceId}`);seen.add(sourceId);rows.push({table,sourceId,row,rowDigest,mapped:rewrite.map(table,row,mapLegacy(table,row,options.context??bundle))})}
 }
 const mappedRows=rows.flatMap(row=>row.mapped);const conversationScopes=new Map(mappedRows.filter(m=>m.table==='conversations').map(m=>[String(m.row.id),m.row]));const contacts=new Map(mappedRows.filter(m=>m.table==='contacts').map(m=>[String(m.row.id),m.row]));for(const mapped of mappedRows){const r=mapped.row;if(r.conversation_id&&r.project_id){const conv=conversationScopes.get(String(r.conversation_id))??(options.context?relationships(options.context).find('conversations',r.conversation_id):undefined);if(conv&&conv.project_id!==r.project_id)throw new Error(`Cross-project legacy reference in ${mapped.table}:${r.id}`)}if(mapped.table==='conversations'){const contact=contacts.get(String(r.contact_id))??(options.context?relationships(options.context).find('contacts',r.contact_id):undefined);if(contact&&contact.project_id!==r.project_id)throw new Error(`Cross-project legacy conversation contact: ${r.id}`)}}
 const keys=new Set<string>(options.objectKeys);for(const object of bundle.objects||[]){if(!object.key||object.key.startsWith('/')||object.key.split('/').includes('..')||keys.has(object.key))throw new Error('Invalid or duplicate object key');keys.add(object.key);const bytes=Uint8Array.from(atob(object.dataBase64),c=>c.charCodeAt(0));if(await digest(bytes)!==object.sha256)throw new Error(`Object digest mismatch: ${object.key}`)}
 const mediaRows=rows.flatMap(row=>row.mapped.filter(m=>m.table==='media'));for(const media of mediaRows){if(!keys.has(String(media.row.object_key)))throw new Error(`Media ${media.row.id} requires exported bytes for ${media.row.object_key}`)}
 return {id:`legacy:${bundleDigest}`,bundleDigest,source:bundle.source,rows,objects:bundle.objects||[],summary:{sourceRows:rows.length,mappedRows:rows.reduce((n,r)=>n+r.mapped.length,0),archivedOnly:rows.filter(r=>!r.mapped.length).map(r=>`${r.table}:${r.sourceId}`),holds:rows.flatMap(r=>r.mapped.filter(m=>m.hold).map(m=>`${r.table}:${r.sourceId}: ${m.hold}`)),objects:keys.size,...rewrite.summary()}}
}
/** Apply one full (non-delta) bundle: a chunk of a package, or a `--file` export with its inline objects. Writes only under
 * the workspace's lease (`lease`, lease.ts): every write batch asserts it, and each inline upload is confirmed under it.
 * `erased`: the workspace's erased contacts (erased.ts), read under that lease. A pending row of theirs is journaled as
 * erasure leaves it (digest kept, source copy '{}', status 'erased', its mapped target) and writes no canonical row, hold,
 * reporting row or import state; it takes no part in the conflict preflight; its file is not uploaded, and one an earlier
 * run left in R2 that no native media row holds is removed. Replayed rows are untouched. */
export async function importLegacy(env:Pick<Env,'DB'|'FILES'>,bundle:LegacyBundle,options:{context?:LegacyBundle;objectKeys?:Set<string>;media?:MediaIndex;checkOnly?:boolean;erased?:Set<string>;lease?:DeltaLease;publishDefaultRules?:boolean;leaveUnread?:boolean;prepared?:PreparedSlice}={}){
 if(bundle.source?.since!==undefined||bundle.source?.delta!==undefined)throw new Error('A delta export imports only as a package (--package), which applies it update-aware')
 const lease=options.lease
 if(!options.checkOnly&&!lease)throw new Error('A legacy import writes only under its workspace lease')
 const context=options.context??bundle,erased=options.erased??new Set<string>()
 const plan=await planImport(bundle,{...options,identity:options.prepared?.identity})
 const existing=await env.DB.prepare('SELECT id,bundle_digest,state FROM legacy_import_runs WHERE id=?').bind(plan.id).first<{id:string;bundle_digest:string;state:string}>();if(existing&&existing.bundle_digest!==plan.bundleDigest)throw new Error('Import digest conflict')
 // A run's journal is read once. Existing canonical rows are looked up, and new
 // rows written, as one JSON array parameter per statement, so a production-sized
 // chunk costs a few D1 round trips and never approaches D1's 100 bound
 // parameters. Each group commits its canonical writes, holds and
 // legacy_import_rows records together in one batch.
 const priors=new Map((await env.DB.prepare(`SELECT source_table,source_id,row_digest FROM legacy_import_rows WHERE run_id=? ${options.prepared?'AND source_id IN (SELECT value FROM json_each(?))':''}`).bind(...(options.prepared?[plan.id,JSON.stringify(plan.rows.map(row=>row.sourceId))]:[plan.id])).all<{source_table:string;source_id:string;row_digest:string}>()).results.map(r=>[identity(r.source_table,[r.source_id]),r.row_digest]))
 let applied=0,replayed=0,d1Ms=0,maxBatchMs=0
 for(const source of plan.rows){const prior=priors.get(identity(source.table,[source.sourceId]));if(prior!==undefined){if(prior!==source.rowDigest)throw new Error('Source row replay differs');replayed++}}
 const pending=plan.rows.filter(source=>!priors.has(identity(source.table,[source.sourceId])))
 const isErased=(source:{table:string;row:Row})=>ofErased(erased,source.table,source.row,context)
 const live=pending.filter(source=>!isErased(source)),withheld=new Set(pending.filter(isErased))
 const replayedRows=plan.rows.filter(source=>priors.has(identity(source.table,[source.sourceId])))
 const normalization=await normalizeImportPlan(plan,env,options.prepared,source=>pending.includes(source)&&!isErased(source));env=normalization.env
 const schemas=await targetSchemas(env.DB,plan.rows.flatMap(source=>source.mapped.map(m=>m.table)))
 const columnsOf=writtenColumns(schemas)
 const current=await canonicalRows(env.DB,live.flatMap(source=>source.mapped),columnsOf)
 // Preflight every canonical row and object before changing either store. A
 // conflict in a later batch/chunk must not leave earlier business rows applied.
 const observed=new Map(current)
 const proposed=new Map(current)
 for(const source of live)for(const mapped of source.mapped){
  const row=columnsOf(mapped),values=mapped.key.map(k=>row[k]),id=identity(mapped.table,values),prior=proposed.get(id)
  if(prior){for(const [key,value]of Object.entries(row))if(prior[key]!==value)throw new Error(`Existing data conflict ${mapped.table}:${values.join(':')} column ${key}; no rows overwritten`)}
  else proposed.set(id,row)
 }
 const objects=[],leftovers=[]
 for(const object of plan.objects){
  const media=context.tables.media?.filter(row=>String(row.object_key||row.storage_key)===object.key)??[]
  // A file of an erased contact is never uploaded. One in R2 that no native media row holds was left by an earlier run
  // before her erasure could see it; one a native media row holds is another person's attachment, and stays.
  if(media.some(row=>ofErased(erased,'media',row,context))){leftovers.push({object,ids:media.map(row=>row.id)});continue}
  const redacted=await env.DB.prepare("SELECT 1 FROM legacy_import_rows WHERE run_id=? AND source_table='media' AND source_id IN (SELECT json_extract(value,'$.id') FROM json_each(?)) AND source_json='{}' LIMIT 1").bind(plan.id,JSON.stringify(media)).first()
  if(redacted)continue
  const current=await env.FILES.get(object.key)
  if(current&&await digest(new Uint8Array(await current.arrayBuffer()))!==object.sha256)throw new Error(`Existing R2 object differs: ${object.key}`)
  objects.push(object)
 }
 const summary={...plan.summary,holds:plan.rows.filter(source=>!withheld.has(source)).flatMap(r=>r.mapped.filter(m=>m.hold).map(m=>`${r.table}:${r.sourceId}: ${m.hold}`))}
 if(options.checkOnly)return {id:plan.id,...summary,applied:0,replayed,erased:0,d1Ms:0,maxBatchMs:0}
 // A batch the lease assertion refused stops the import with the lease's own message.
 const leased=async(statements:D1PreparedStatement[])=>env.DB.batch([lease!.assertion(env.DB),...normalization.statements,...statements,...(options.prepared?[lease!.assertion(env.DB)]:[]),lease!.cleared(env.DB)]).catch(async error=>{await lease!.confirm();throw error})
 await leased([env.DB.prepare("INSERT OR IGNORE INTO legacy_import_runs VALUES(?,?,?,'running',?,NULL)").bind(plan.id,stable(plan.source),plan.bundleDigest,Date.now())])
 await confirmReplayedState(env.DB,plan.id,replayedRows,columnsOf,leased)
 if(replayedRows.length&&options.prepared?.journalStatements)await leased(options.prepared.journalStatements(env.DB,replayedRows,false))
 for(const {object,ids} of leftovers)if(await env.FILES.head(object.key)&&!await heldByNativeMedia(env.DB,ids,object.key)){await leased([env.DB.prepare('DELETE FROM legacy_import_objects WHERE run_id=? AND object_key=?').bind(plan.id,object.key)]);await env.FILES.delete(object.key)}
 for(const object of objects){
  const bytes=Uint8Array.from(atob(object.dataBase64),c=>c.charCodeAt(0)),current=await env.FILES.get(object.key);let uploaded=false
  if(current&&await digest(new Uint8Array(await current.arrayBuffer()))!==object.sha256)throw new Error(`Existing R2 object differs: ${object.key}`)
  if(!current){
   await lease!.confirm()
   const stored=await env.FILES.put(object.key,bytes,{onlyIf:{etagDoesNotMatch:'*'},customMetadata:{sha256:object.sha256,legacyImport:plan.id}})
   if(!stored){const raced=await env.FILES.get(object.key);if(!raced||await digest(new Uint8Array(await raced.arrayBuffer()))!==object.sha256)throw new Error(`Concurrent R2 object conflict: ${object.key}`)}
   else uploaded=true
   // Kept only under a live lease: an upload that landed after the lease lapsed is removed again.
   if(uploaded)await lease!.confirm().catch(async error=>{await env.FILES.delete(object.key);throw error})
  }
  await leased([env.DB.prepare('INSERT OR IGNORE INTO legacy_import_objects VALUES(?,?,?,?)').bind(plan.id,object.key,object.sha256,bytes.length)]).catch(async error=>{if(uploaded)await env.FILES.delete(object.key);throw error})
 }
 // Each source row's share of every statement its group binds: its journal entry, its holds,
 // its reporting row and its canonical rows' values. A group is sized by the largest of these,
 // so no statement's JSON parameter can outgrow the group, however small the rows are.
 // Every written or confirmed target records its import state with it, so a later delta can tell whether the seed changed it.
 let erasedRows=0
 const writes=await Promise.all(pending.map(async source=>{
  const target=[source.mapped.map(m=>m.table).join(',')||null,source.mapped.map(m=>m.key.map(k=>m.row[k]).join(':')).join(',')||null]
  // An erased contact's row: only its journal entry, as erasure leaves it (as delta-batch.ts journals one).
  if(withheld.has(source)){erasedRows++;return {source,mapped:[] as MappedRow[],journal:[plan.id,source.table,source.sourceId,source.rowDigest,'{}',...target,'erased'],holds:[] as unknown[][],reporting:null,state:[] as unknown[][],bytes:jsonBytes(source.row)}}
  const conversation=source.table==='conversations'&&source.mapped.find(m=>m.table==='conversations')
  const state=await Promise.all(source.mapped.map(m=>stateEntry(m.table,targetKeyOf(m),columnsOf(m),source.rowDigest,plan.id,source.table,source.sourceId)))
  const write={source,mapped:source.mapped,journal:[plan.id,source.table,source.sourceId,source.rowDigest,stable(source.row),...target,source.mapped.length?'mapped':'archived_only'],holds:source.mapped.filter(m=>m.hold).map(m=>[`${plan.id}:${source.table}:${source.sourceId}`,plan.id,source.table,source.sourceId,m.hold]),reporting:conversation?[conversation.row.project_id,conversation.row.id,plan.id]:null,state}
  const sum=(values:unknown[])=>values.reduce<number>((n,value)=>n+jsonBytes(value),0)
  return {...write,bytes:Math.max(jsonBytes(write.journal),sum(write.holds),jsonBytes(write.reporting),sum(state),sum(source.mapped.map(m=>Object.values(columnsOf(m)))))}
 }))
 for(const group of byteSlices(writes,write=>write.bytes)){
  const inserts=new Map<string,Map<string,unknown[][]>>(),holds:unknown[][]=[],reporting:unknown[][]=[],journal:unknown[][]=[],state:unknown[][]=[],projects:string[]=[],conversations:string[]=[]
  for(const {mapped:written,journal:entry,holds:held,reporting:report,state:confirmed} of group){
   state.push(...confirmed)
   for(const mapped of written){
    const row=columnsOf(mapped),keyValues=mapped.key.map(k=>row[k]),id=identity(mapped.table,keyValues),existingRow=current.get(id)
    if(existingRow){for(const [key,value]of Object.entries(row))if(existingRow[key]!==value)throw new Error(`Existing data conflict ${mapped.table}:${keyValues.join(':')} column ${key}; no rows overwritten`)}
    else{if(mapped.table==='projects')projects.push(String(row.id));if(mapped.table==='conversations')conversations.push(String(row.id))
     const names=Object.keys(row),byColumns=inserts.get(mapped.table)??new Map<string,unknown[][]>();inserts.set(mapped.table,byColumns);const values=byColumns.get(names.join(','))??[];byColumns.set(names.join(','),values);values.push(names.map(k=>row[k]));current.set(id,row)}
   }
   holds.push(...held);if(report)reporting.push(report);journal.push(entry)
  }
  // Tables keep their first-mapped order, so a parent row precedes the rows that reference it.
  const statements:D1PreparedStatement[]=[...canonicalAssertions(env.DB,group.flatMap(write=>write.mapped),observed,columnsOf),...markWorkRows(env.DB),...[...inserts].flatMap(([table,byColumns])=>[...byColumns].map(([names,values])=>insertJson(env.DB,`INSERT INTO ${sqlName(table)} (${names.split(',').map(sqlName).join(',')})`,names.split(',').length,values)))]
  if(holds.length)statements.push(insertJson(env.DB,'INSERT OR IGNORE INTO legacy_import_holds(id,run_id,source_table,source_id,reason)',5,holds))
  if(reporting.length)statements.push(insertJson(env.DB,'INSERT OR IGNORE INTO reporting_legacy_conversations(project_id,conversation_id,run_id)',3,reporting))
  if(state.length)statements.push(stateStatement(env.DB,state))
  statements.push(insertJson(env.DB,'INSERT INTO legacy_import_rows(run_id,source_table,source_id,row_digest,source_json,target_table,target_key,status)',8,journal))
  if(options.prepared?.journalStatements)statements.push(...options.prepared.journalStatements(env.DB,group.map(write=>write.source),true))
  // What the import writes is history, not work (imported-history.ts): reads, the unpublished default rules, no trigger rows.
  statements.push(...importedHistoryStatements(env.DB,{projects,conversations,publishDefaultRules:options.publishDefaultRules,leaveUnread:options.leaveUnread}),...purgeWorkRows(env.DB))
  // D1 reports each statement's server time; the batch's sum is its share of the database's CPU.
  const batch=(await leased(statements)).reduce((ms,result)=>ms+Number(result.meta?.duration||0),0);applied+=group.length;d1Ms+=batch;maxBatchMs=Math.max(maxBatchMs,batch)
 }
 if(!options.prepared)await leased([env.DB.prepare("UPDATE legacy_import_runs SET state='complete',completed_at=? WHERE id=?").bind(Date.now(),plan.id)])
 return {id:plan.id,...summary,applied,replayed,erased:erasedRows,d1Ms:Math.round(d1Ms),maxBatchMs:Math.round(maxBatchMs)}
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
async function confirmReplayedState(db:D1Database,runId:string,replayed:{table:string;sourceId:string;rowDigest:string;mapped:MappedRow[]}[],columnsOf:(m:MappedRow)=>Row,leased:(statements:D1PreparedStatement[])=>Promise<D1Result[]>){
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
 for(const part of byteSlices(entries,jsonBytes))await leased([stateStatement(db,part)])
}

/** Compare the observed native rows again INSIDE the write transaction. A native
 * edit between planning and commit must never acquire an import-state digest. */
export function canonicalAssertions(db:D1Database,mapped:MappedRow[],observed:Map<string,Row|null>,columnsOf:(mapped:MappedRow)=>Row){
 const statements:D1PreparedStatement[]=[]
 for(const [shape,targets] of groupBy(mapped,m=>m.table+'\0'+m.key.join(','),m=>m)){
  const [table,keyList]=shape.split('\0'),keys=keyList.split(','),rows=targets.map(m=>{const row=columnsOf(m),prior=observed.get(identity(table,keys.map(key=>row[key])));return {keys:keys.map(key=>row[key]),prior:prior??null}})
  const columns=[...new Set(rows.flatMap(row=>row.prior?Object.keys(row.prior):[]))]
  const match=keys.map((key,i)=>`native.${sqlName(key)} IS json_extract(requested.value,'$.keys[${i}]')`).join(' AND ')
  const equal=columns.map(column=>`native.${sqlName(column)} IS json_extract(requested.value,'$.prior.${column}')`).join(' AND ')||'1'
  statements.push(db.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT NOT EXISTS(SELECT 1 FROM json_each(?) requested WHERE CASE WHEN json_type(requested.value,'$.prior')='null' THEN EXISTS(SELECT 1 FROM ${sqlName(table)} native WHERE ${match}) ELSE NOT EXISTS(SELECT 1 FROM ${sqlName(table)} native WHERE ${match} AND ${equal}) END)`).bind(JSON.stringify(rows)))
 }
 return statements
}
