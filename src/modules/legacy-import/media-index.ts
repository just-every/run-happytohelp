import type {Row,LegacyBundle} from './types'
import {relationships} from './relationships'
import {archiveOnly} from './archive-only'
import {byteSlices,jsonBytes} from './d1'

/** One legacy file a rewritten URL may name, found by its legacy storage key. `conversationId`: the conversation whose
 * native media row holds it (it is served through that conversation). Otherwise `audience` says who the file door
 * (file-door.ts) serves it to; a file with neither has no native door, and a URL naming it is left. */
export interface ImportedFile {mediaId:string;objectKey:string;contentType:string;filename:string;conversationId?:string;audience?:'public'|'article'}
/** The files of one workspace by legacy storage key, resolved once per run before mapping. */
export interface MediaIndex {projectId:string;files:Map<string,ImportedFile>}

const segment=(value:string)=>encodeURIComponent(value).replace(/\./g,'%2E')
/** The R2 key the exporter gives a carried file (scripts/legacy-export/attachments.mjs). */
export const exportedObjectKey=(projectId:string,mediaId:string)=>`legacy/projects/${segment(projectId)}/media/${segment(mediaId)}`
/** The legacy storage key of a media row: `<directory>/<filename>.<extension>`, outer slashes trimmed, as legacy's
 * storage and the exporter join it. */
export function legacyKey(row:Row){
 if(typeof row.filename!=='string'||!row.filename)return undefined
 const extension=typeof row.extension==='string'&&row.extension?`.${row.extension}`:''
 return `${typeof row.directory==='string'?row.directory:''}/${row.filename}${extension}`.replace(/^\/+|\/+$/g,'')||undefined
}
const model=(link:Row,names:string)=>new RegExp(`(?:^|\\\\)(?:${names})$`).test(String(link.mediable_type))
/** Who may read a file legacy linked to no conversation: anyone for a workspace, teammate or assistant file (logos,
 * avatars, the widget background), an article's readers for an article file. */
function door(links:Row[]):{audience?:'public'|'article';conversational:boolean}{
 if(links.some(link=>model(link,'Message|Event|SupportDelegation')))return {conversational:true}
 if(links.some(link=>model(link,'Project|User|AI|Ai')))return {audience:'public',conversational:false}
 if(links.some(link=>model(link,'Article')))return {audience:'article',conversational:false}
 return {conversational:false}
}
const described=(row:Row)=>({contentType:String(row.content_type||row.mime_type||'application/octet-stream'),filename:String(row.original_filename||row.filename_original||(row.extension?`${row.filename}.${row.extension}`:row.filename)||row.id)})

/** The files a package (or `--file` export) carries: each media row with exported bytes, by its legacy key. A file
 * the import puts in a conversation (map-core.ts `media`) is served through it; a file linked to none gets the door
 * its links give it (a variant through its original's links). Archive-only files are not resolved. */
export function packageMediaIndex(projectId:string,media:Iterable<Row>,carried:Set<string>,context:LegacyBundle):MediaIndex{
 const {find,mediaMessages,mediaLinks}=relationships(context),files=new Map<string,ImportedFile>()
 for(const row of media){
  const key=legacyKey(row),objectKey=String(row.object_key||row.storage_key||'')
  if(!key||!carried.has(objectKey)||archiveOnly('media',row,context))continue
  const message=find('messages',row.message_id||mediaMessages.get(String(row.id))?.mediable_id),conversation=row.conversation_id||message?.conversation_id
  const base={mediaId:String(row.id),objectKey,...described(row)}
  if(conversation!=null){files.set(key,{...base,conversationId:String(conversation)});continue}
  const links=[row.id,row.original_media_id].filter(id=>id!=null).flatMap(id=>mediaLinks.get(String(id))??[])
  const {audience,conversational}=door(links)
  files.set(key,conversational?base:{...base,audience})
 }
 return {projectId,files}
}

/** A `--file` export's own files: its media rows and the objects it carries inline. */
export function bundleMediaIndex(bundle:LegacyBundle):MediaIndex{
 const projectId=String(bundle.source.projectId??bundle.tables.projects?.[0]?.id??'')
 return packageMediaIndex(projectId,bundle.tables.media??[],new Set((bundle.objects??[]).map(object=>object.key)),bundle)
}

/** The files earlier imports of the workspace carried that the seed still holds, from the journal: a media row
 * journaled by any run of the workspace (an erased person's, journaled as '{}', is never read) whose native media row
 * still exists, or whose object a run recorded and R2 still holds for a file linked to no conversation. Reads are
 * bounded by the workspace's files, never its messages or contacts. */
export async function earlierMediaIndex(env:{DB:D1Database;FILES:R2Bucket},projectId:string):Promise<MediaIndex>{
 const runs=(await env.DB.prepare("SELECT id FROM legacy_import_runs WHERE CAST(json_extract(source_json,'$.projectId') AS TEXT)=? ORDER BY created_at,id").bind(projectId).all<{id:string}>()).results
 const media=new Map<string,Row>(),links=new Map<string,Row[]>()
 for(const {id} of runs)for(const row of (await env.DB.prepare("SELECT source_table,source_json FROM legacy_import_rows WHERE run_id=? AND source_table IN ('media','mediables') AND source_json<>'{}'").bind(id).all<{source_table:string;source_json:string}>()).results){
  const source=JSON.parse(row.source_json) as Row
  if(row.source_table==='media'){if(source.id!=null)media.set(String(source.id),source)}
  else if(source.media_id!=null){const list=links.get(String(source.media_id))??[];list.push(source);links.set(String(source.media_id),list)}
 }
 const files=new Map<string,ImportedFile>(),ids=[...media.keys()],native=new Map<string,{conversation_id:string;object_key:string}>()
 for(const part of byteSlices(ids,jsonBytes,100))for(const row of (await env.DB.prepare('SELECT id,conversation_id,object_key FROM media WHERE project_id=? AND id IN (SELECT value FROM json_each(?))').bind(projectId,JSON.stringify(part)).all<{id:string;conversation_id:string;object_key:string}>()).results)native.set(String(row.id),row)
 const doors=new Map<string,ImportedFile>()
 for(const [id,row] of media){
  const key=legacyKey(row)
  if(!key)continue
  const held=native.get(id)
  if(held){files.set(key,{mediaId:id,objectKey:held.object_key,...described(row),conversationId:String(held.conversation_id)});continue}
  const own=[id,row.original_media_id].filter(value=>value!=null).flatMap(value=>links.get(String(value))??[]),{audience}=door(own)
  if(audience)doors.set(key,{mediaId:id,objectKey:String(row.object_key||row.storage_key||exportedObjectKey(projectId,id)),...described(row),audience})
 }
 const recorded=new Set<string>(),keys=[...new Set([...doors.values()].map(file=>file.objectKey))]
 for(const part of byteSlices(keys,jsonBytes,100))for(const row of (await env.DB.prepare('SELECT DISTINCT object_key FROM legacy_import_objects WHERE object_key IN (SELECT value FROM json_each(?))').bind(JSON.stringify(part)).all<{object_key:string}>()).results)recorded.add(row.object_key)
 for(const [key,file] of doors)if(recorded.has(file.objectKey)&&await env.FILES.head(file.objectKey))files.set(key,file)
 return {projectId,files}
}

/** `later` wins: a package's own files over what earlier imports held. */
export const mergedIndex=(earlier:MediaIndex,later:MediaIndex):MediaIndex=>({projectId:later.projectId,files:new Map([...earlier.files,...later.files])})

/** The root-relative native URL of a file, or undefined when it has no native door. Root-relative, so it names the
 * installation that serves it; the widget settings door and the widget make it absolute on a customer's site. */
export function nativeUrl(index:MediaIndex,file:ImportedFile){
 if(file.conversationId!==undefined)return `/api/conversations/${encodeURIComponent(file.conversationId)}/media/${encodeURIComponent(file.mediaId)}`
 if(file.audience)return `/api/imported-files/${encodeURIComponent(index.projectId)}/${encodeURIComponent(file.mediaId)}`
 return undefined
}
