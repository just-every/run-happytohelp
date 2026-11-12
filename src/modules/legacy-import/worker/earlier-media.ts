import type {Env} from '../../../platform/env'
import {packageMediaIndex,legacyKey} from '../media-index'
import {useRelationships,isMessageMedia} from '../relationships'
import {type Row,type LegacyBundle} from '../types'
import {jsonBytes,insertJson} from '../d1'
import {checkpoint,cursor,limits,type Run} from './state'
import {jsonRows} from './json-rows'
import {refuse} from './errors'
/** Stream prior media/link journals into indexed scratch; never load historical
 * message or contact journals just to resolve an old storage URL. */
export async function loadEarlierMedia(env:Env,run:Run){
 const c=cursor(run)
 if(c.stage==='earlier_files')return indexEarlierFiles(env,run)
 let sourceRun=String(c.sourceRun??''),after=String(c.after??''),created=Number(c.created??-1)
 if(!sourceRun){const next=await env.DB.prepare(`SELECT id,created_at FROM legacy_import_runs WHERE json_extract(source_json,'$.projectId')=? AND (created_at>? OR (created_at=? AND id>?)) ORDER BY created_at,id LIMIT 1`).bind(run.project_id,created,created,c.lastRun??'').first<{id:string;created_at:number}>()
  if(!next){await checkpoint(env,run,{cursor_json:JSON.stringify({stage:'earlier_files',after:''})});return {rows:0,bytes:0}}sourceRun=next.id;created=next.created_at;after=''
 }
 const rows=await jsonRows<{source_table:string;source_id:string;row_json:string}>(env.DB,`SELECT source_table,source_id,source_json row_json FROM legacy_import_rows WHERE run_id=? AND source_table IN ('media','mediables') AND source_json<>'{}' AND (source_table>? OR (source_table=? AND source_id>?)) ORDER BY source_table,source_id LIMIT ?`,[sourceRun,c.sourceRun?c.sourceTable??'':'',c.sourceRun?c.sourceTable??'':'',after,limits.rows],['source_table','source_id','row_json'],limits.rows,limits.bytes)
 const media:unknown[][]=[];let bytes=0
 for(const item of rows.results){bytes+=jsonBytes(item);if(bytes>limits.bytes)refuse('row_too_large');const row=JSON.parse(item.row_json)
  if(item.source_table==='media')media.push([run.id,String(row.id),'prior-record','','',String(row.object_key||row.storage_key||''),legacyKey(row)??'',JSON.stringify(row)])
  else media.push([run.id,String(row.media_id),'prior:'+sourceRun+':'+item.source_id,String(row.mediable_type),String(row.mediable_id),'','',JSON.stringify(row)])
 }
 const last=rows.results.at(-1),done=rows.results.length<limits.rows
 await checkpoint(env,run,{cursor_json:JSON.stringify(done?{stage:'earlier',lastRun:sourceRun,created,after:''}:{stage:'earlier',sourceRun,sourceTable:last!.source_table,after:last!.source_id,created})},media.length?[insertJson(env.DB,'INSERT OR REPLACE INTO legacy_import_context_media(run_id,media_id,link_id,mediable_type,mediable_id,object_key,legacy_key,row_json)',8,media)]:[])
 return {rows:rows.results.length,bytes}
}
async function indexEarlierFiles(env:Env,run:Run){
 const c=cursor(run),source=await env.DB.prepare("SELECT media_id,row_json,legacy_key FROM legacy_import_context_media WHERE run_id=? AND link_id='prior-record' AND media_id>? ORDER BY media_id LIMIT 1").bind(run.id,c.after??'').first<{media_id:string;row_json:string;legacy_key:string}>()
 if(!source){await checkpoint(env,run,{phase:'preflight',cursor_json:JSON.stringify({stage:run.mode==='delta'?'delta':'rows',ordinal:0,row:0})});return {rows:0,bytes:0}}
 const row=JSON.parse(source.row_json),native=await env.DB.prepare('SELECT conversation_id,object_key FROM media WHERE project_id=? AND id=?').bind(run.project_id,source.media_id).first<{conversation_id:string;object_key:string}>()
 let file:any=native?{mediaId:source.media_id,objectKey:native.object_key,conversationId:native.conversation_id,contentType:String(row.content_type||row.mime_type||'application/octet-stream'),filename:String(row.original_filename||row.filename_original||row.filename||row.id)}:undefined
 if(!file){
  const links=await jsonRows<{media_id:string;row_json:string}>(env.DB,"SELECT media_id,row_json FROM legacy_import_context_media WHERE run_id=? AND media_id IN (SELECT value FROM json_each(?)) AND link_id NOT IN ('','prior-record') ORDER BY link_id",[run.id,JSON.stringify([source.media_id,row.original_media_id].filter(value=>value!=null).map(String))],['media_id','row_json'],250,limits.closureBytes/4);if(links.results.length>250)refuse('row_too_large')
  const byMedia=new Map<string,Row[]>();for(const item of links.results){const list=byMedia.get(item.media_id)??[];list.push(JSON.parse(item.row_json));byMedia.set(item.media_id,list)}
  const context=useRelationships({format:'happytohelp-legacy-v1',source:{repository:'journal',revision:'journal',exportedAt:'2026-01-01T00:00:00Z'},tables:{}},{find:()=>undefined,messages:{get:()=>undefined},revisions:{get:()=>undefined},mediaMessages:{get:()=>undefined},mediaLinks:{get:id=>byMedia.get(id)},identityOwner:()=>undefined,localIdOwner:()=>undefined})
  const key=String(row.object_key||row.storage_key||''),recorded=await env.DB.prepare('SELECT 1 FROM legacy_import_objects WHERE object_key=? LIMIT 1').bind(key).first()
  if(recorded&&await env.FILES.head(key))file=packageMediaIndex(run.project_id,[row],new Set([key]),context).files.get(source.legacy_key)
 }
 await checkpoint(env,run,{cursor_json:JSON.stringify({stage:'earlier_files',after:source.media_id})},file?[env.DB.prepare(`INSERT OR REPLACE INTO legacy_import_context(run_id,kind,source_table,source_id,parent_id,row_json,row_digest) VALUES(?,'media_lookup','media',?,?,?,'')`).bind(run.id,source.media_id,source.legacy_key,JSON.stringify({legacyKey:source.legacy_key,file}))]:[])
 return {rows:1,bytes:jsonBytes(row)}
}
