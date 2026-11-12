import type {Env} from '../../../platform/env'
import type {LegacyPackageManifest,LegacyPart} from '../worker-contract'
import {digest,stable,timestamp,type Row} from '../types'
import {contactIdentity,isMessageMedia} from '../relationships'
import {legacyKey,exportedObjectKey} from '../media-index'
import {insertJson,jsonBytes} from '../d1'
import {readRows} from './reader'
import {checkpoint,cursor,limits,packageParts,type Run} from './state'
import {jsonRows} from './json-rows'
import {refuse} from './errors'
/** Byte and row ceilings apply together. Oversized indivisible rows are refused. */
export function sliceRows(rows:Row[],offset:number,maxRows:number=limits.rows){const selected:Row[]=[];let bytes=2
 for(const row of rows.slice(offset,offset+maxRows)){const n=jsonBytes(row);if(n+3>limits.bytes)refuse('row_too_large');if(selected.length&&bytes+n+1>limits.bytes)break;selected.push(row);bytes+=n+1}
 return {rows:selected,bytes}
}
export async function loadContext(env:Env,run:Run,manifest:LegacyPackageManifest){
 const parts=packageParts(manifest,JSON.parse(run.exclude_json)).filter(part=>part.kind!=='object'),c=cursor(run),ordinal=Number(c.ordinal??0),part=parts[ordinal]
 if(!part){await checkpoint(env,run,{cursor_json:JSON.stringify({stage:'transcripts',after:'',conversation:'',revision:0}),phase:'context'});return {rows:0,bytes:0}}
 const original=await readRows(env.FILES,run.manifest_sha256,run.project_id,part.kind as 'chunk'|'context',part as LegacyPart),offset=Number(c.row??0),selected=sliceRows(original,offset,100)
 const records:unknown[][]=[],messages:unknown[][]=[],media:unknown[][]=[],identities:Row[]=[]
 for(const source of selected.rows){
  let row={...source};const sourceId=String(row.id??row.event_id??row.token_hash??await digest(stable(row)))
  if(part.table==='projects'&&run.mode==='delta'){delete row.deleted_at}
  if(part.table==='media'){const object=manifest.objects.find(item=>String(item.mediaId)===String(row.id));if(!object||object.key!==exportedObjectKey(run.source_project_id,String(row.id)))refuse('invalid_scope',422);row.object_key=object.key}
  const parent=row.conversation_id??row.dataset_id??row.parent_id??null
  records.push([run.id,'record',part.table,sourceId,JSON.stringify(row),await digest(stable(source)),row.project_id??null,parent==null?null:String(parent),timestamp(row.updated_at??row.created_at),row.deleted_at?1:0])
  if(part.table==='messages')messages.push([run.id,String(row.id),String(row.conversation_id),row.project_id??null,row.contact_id??null,row.agent_id??null,row.ai_id??null,timestamp(row.created_at),row.deleted_at?1:0,row.local_id==null?null:String(row.local_id),0,JSON.stringify(row)])
  if(part.table==='media')media.push([run.id,String(row.id),'','','',String(row.object_key),legacyKey(row)??'',JSON.stringify(row)])
  if(part.table==='mediables')media.push([run.id,String(row.media_id),sourceId,String(row.mediable_type),String(row.mediable_id),'','',JSON.stringify(row)])
  if(part.table==='contacts'&&contactIdentity(row)!==null)identities.push(row)
 }
 const statements:D1PreparedStatement[]=[]
 if(run.mode==='delta'&&part.kind==='chunk')for(const record of records)statements.push(env.DB.prepare(`INSERT OR REPLACE INTO legacy_import_context(run_id,kind,source_table,source_id,row_json,row_digest,parent_id) VALUES(?,'delta_plan',?,?,?, ?,?)`).bind(run.id,'incoming:'+part.table,String(record[3]),'{}',String(record[5]),record[7]))
 if(records.length)statements.push(insertJson(env.DB,'INSERT OR REPLACE INTO legacy_import_context(run_id,kind,source_table,source_id,row_json,row_digest,project_id,parent_id,created_ms,deleted)',10,records))
 if(messages.length)statements.push(insertJson(env.DB,`INSERT INTO legacy_import_context_messages(run_id,id,conversation_id,project_id,contact_id,agent_id,ai_id,created_ms,deleted,local_id,revision,row_json)`,12,messages))
 // A full chunk enriches an earlier reduced context record; retain every link.
 if(messages.length){const statement=statements.pop()!;statements.push(env.DB.prepare(`DELETE FROM legacy_import_context_messages WHERE run_id=? AND id IN (SELECT json_extract(value,'$[1]') FROM json_each(?))`).bind(run.id,JSON.stringify(messages)),statement)}
 if(media.length){statements.push(env.DB.prepare(`DELETE FROM legacy_import_context_media WHERE run_id=? AND (media_id,link_id) IN (SELECT json_extract(value,'$[1]'),json_extract(value,'$[2]') FROM json_each(?))`).bind(run.id,JSON.stringify(media)),insertJson(env.DB,'INSERT INTO legacy_import_context_media(run_id,media_id,link_id,mediable_type,mediable_id,object_key,legacy_key,row_json)',8,media))}
 // Identity ties use JavaScript's raw source-ID comparison, independently
 // of SQLite's UTF-8 ordering and transcript localeCompare.
 if(identities.length){
  const existing=await env.DB.prepare('SELECT identity,contact_id,created_ms FROM legacy_import_context_identities WHERE run_id=? AND project_id=? AND identity IN (SELECT value FROM json_each(?))').bind(run.id,run.source_project_id,JSON.stringify(identities.map(contactIdentity))).all<{identity:string;contact_id:string;created_ms:number}>()
  const owners=new Map(existing.results.map(row=>[row.identity,row])),changed=new Map<string,{contact_id:string;created_ms:number}>()
  for(const row of identities){const key=contactIdentity(row)!,prior=owners.get(key),candidate={identity:key,contact_id:String(row.id),created_ms:timestamp(row.created_at)};if(!prior||candidate.created_ms<prior.created_ms||candidate.created_ms===prior.created_ms&&candidate.contact_id<prior.contact_id){owners.set(key,candidate);changed.set(key,candidate)}}
  for(const [key,owner] of changed)statements.push(env.DB.prepare('INSERT INTO legacy_import_context_identities(run_id,project_id,identity,contact_id,created_ms) VALUES(?,?,?,?,?) ON CONFLICT(run_id,project_id,identity) DO UPDATE SET contact_id=excluded.contact_id,created_ms=excluded.created_ms').bind(run.id,run.source_project_id,key,owner.contact_id,owner.created_ms))
 }

 const next=offset+selected.rows.length,done=next===original.length
 statements.push(env.DB.prepare('UPDATE legacy_import_worker_parts SET loaded_rows=? WHERE run_id=? AND file=?').bind(next,run.id,part.file))
 await checkpoint(env,run,{cursor_json:JSON.stringify({stage:'load',ordinal:done?ordinal+1:ordinal,file:done?null:part.file,row:done?0:next})},statements)
 return {rows:selected.rows.length,bytes:selected.bytes}
}
/** A timestamp tie is sorted with JS localeCompare, exactly like the CLI. The
 * transcript itself is streamed as bounded ties; no whole-conversation array. */
export async function indexTranscripts(env:Env,run:Run){
 const c=cursor(run),next=await env.DB.prepare(`SELECT conversation_id,created_ms FROM legacy_import_context_messages WHERE run_id=? AND deleted=0 AND (conversation_id>? OR (conversation_id=? AND created_ms>?)) ORDER BY conversation_id,created_ms LIMIT 1`).bind(run.id,c.conversation??'',c.conversation??'',c.created??-1).first<{conversation_id:string;created_ms:number}>()
 if(!next){await checkpoint(env,run,{cursor_json:JSON.stringify({stage:'datasets',after:''})});return {rows:0,bytes:0}}
 const rows=await jsonRows<{id:string;local_id:string|null;row_json:string}>(env.DB,'SELECT id,local_id,row_json FROM legacy_import_context_messages WHERE run_id=? AND conversation_id=? AND deleted=0 AND created_ms=?',[run.id,next.conversation_id,next.created_ms],['id','local_id','row_json'],250,limits.bytes)
 const bytes=jsonBytes(rows.results);if(rows.results.length>250||bytes>limits.bytes)refuse('row_too_large')
 rows.results.sort((a,b)=>a.id.localeCompare(b.id));const base=next.conversation_id===c.conversation?Number(c.revision??0):0,count=base+rows.results.length,last=rows.results.at(-1)!.id
 const revisions=rows.results.map((row,i)=>[row.id,base+i+1])
 await checkpoint(env,run,{cursor_json:JSON.stringify({stage:'transcripts',conversation:next.conversation_id,created:next.created_ms,revision:count})},[
  env.DB.prepare(`UPDATE legacy_import_context_messages SET revision=(SELECT json_extract(value,'$[1]') FROM json_each(?1) WHERE json_extract(value,'$[0]')=legacy_import_context_messages.id) WHERE run_id=?2 AND id IN (SELECT json_extract(value,'$[0]') FROM json_each(?1))`).bind(JSON.stringify(revisions),run.id),
  env.DB.prepare(`INSERT OR REPLACE INTO legacy_import_context(run_id,kind,source_table,source_id,row_json,row_digest) VALUES(?,'conversation_summary','conversations',?,?,'')`).bind(run.id,next.conversation_id,JSON.stringify({count,lastId:last})),
 ])
 return {rows:rows.results.length,bytes}
}
export async function indexDatasets(env:Env,run:Run){
 const c=cursor(run),rows=await env.DB.prepare(`SELECT source_id,row_json FROM legacy_import_context WHERE run_id=? AND kind='record' AND source_table='dataset_files' AND source_id>? ORDER BY source_id LIMIT ?`).bind(run.id,c.after??'',1).all<{source_id:string;row_json:string}>()
 if(!rows.results.length){await checkpoint(env,run,{cursor_json:JSON.stringify({stage:'earlier',created:-1,lastRun:''})});return {rows:0,bytes:0}}
 let bytes=0;const statements:D1PreparedStatement[]=[];let last=c.after
 for(const source of rows.results){bytes+=jsonBytes(source);if(bytes>limits.bytes)refuse('row_too_large');const file=JSON.parse(source.row_json),dataset=await env.DB.prepare("SELECT row_json FROM legacy_import_context WHERE run_id=? AND kind='record' AND source_table IN ('datasets','knowledge_datasets') AND source_id=? LIMIT 1").bind(run.id,String(file.dataset_id)).first<{row_json:string}>();last=source.source_id
  const d=dataset?JSON.parse(dataset.row_json):null,published=d&&!file.deleted_at&&(file.markdown||file.content)&&(d.status==='ready'||d.last_refreshed_at&&(Array.isArray(d.published_file_ids)?d.published_file_ids.map(String).includes(String(file.id)):(file.updated_at||file.created_at)&&timestamp(file.updated_at||file.created_at)<=timestamp(d.last_refreshed_at)))
  if(published)statements.push(env.DB.prepare(`INSERT OR REPLACE INTO legacy_import_context(run_id,kind,source_table,source_id,parent_id,row_json,row_digest) VALUES(?,'media_lookup','dataset_files',?,?,'{}','')`).bind(run.id,String(file.id),String(file.dataset_id)))
 }
 await checkpoint(env,run,{cursor_json:JSON.stringify({stage:'datasets',after:last})},statements);return {rows:rows.results.length,bytes}
}
