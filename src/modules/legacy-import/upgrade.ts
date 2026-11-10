import type {Row,MappedRow} from './types'
import {sqlName,insertJson,byteSlices,jsonBytes} from './d1'
import {readStates,stateKey,stateStatement,stateEntry,columnsDigest,unchangedSinceImport,type ImportState} from './state'
import {earlierMediaIndex} from './media-index'
import {mediaRewrite} from './media-rewrite'
import {STORAGE_MARK} from './media-urls'
import {projectSettings} from './map-project'
import type {DeltaLease} from './lease'

/** Bring a workspace imported by an earlier importer to what the current importer writes (scripts/legacy-import/upgrade.mjs):
 *
 * - **Media URLs.** Each legacy storage URL in its messages, articles, logo, widget background, team and assistant avatars
 *   that names a file an import carried and the seed still holds becomes its native URL, as an import now writes it
 *   (media-rewrite.ts); a file the file door serves gets its `legacy_import_files` row.
 * - **Widget.** Its settings get the legacy widget translation (legacy-widget.ts), re-mapped from the journaled legacy
 *   project row, where the seed has not changed them since import. Settings the seed changed are left and counted.
 *
 * A row whose import state equalled it keeps an import state equal to what is now written, so a later delta reads it as
 * unchanged since import and a replay of the original package changes nothing. A row the seed changed keeps its state.
 * Candidate rows are found per table by the bucket's name (a LIKE through the workspace's rows), a page at a time; nothing
 * else is read into memory beyond the workspace's file list. Every write batch asserts the workspace's lease. A second
 * run finds nothing to change. Returns counts only. */
export async function upgradeWorkspace(env:{DB:D1Database;FILES:R2Bucket},projectId:string,lease:DeltaLease,{renew=async()=>{}}:{renew?:()=>Promise<void>}={}){
 const runs=await env.DB.prepare("SELECT count(*) n FROM legacy_import_runs WHERE CAST(json_extract(source_json,'$.projectId') AS TEXT)=?").bind(projectId).first<{n:number}>()
 if(!runs?.n)throw new Error('No legacy import of this workspace is journaled here: nothing to upgrade')
 const index=await earlierMediaIndex(env,projectId),rewrite=mediaRewrite(index,projectId)
 const counts={rowsRewritten:{messages:0,knowledge_articles:0,project_settings:0,user_settings:0,ai_profiles:0},filesAdded:0,stateKept:0,changedSinceImport:0,settingsTranslated:0,settingsLeft:0}
 interface Change {table:string;key:string;keyColumn:string;canonical:Row;next:Row;state?:ImportState;doors:MappedRow[]}
 const changes:Change[]=[]

 // Legacy storage URLs, table by table, a page of candidates at a time.
 const like=`%${STORAGE_MARK}%`
 const pages:[string,string,string,string][]=[
  ['messages','id','SELECT * FROM messages WHERE project_id=?1 AND id>?2 AND content LIKE ?3 ORDER BY id LIMIT 200','content'],
  ['knowledge_articles','id','SELECT * FROM knowledge_articles WHERE project_id=?1 AND id>?2 AND content LIKE ?3 ORDER BY id LIMIT 200','content'],
  ['ai_profiles','id','SELECT * FROM ai_profiles WHERE project_id=?1 AND id>?2 AND avatar_url LIKE ?3 ORDER BY id LIMIT 200','avatar_url'],
  ['user_settings','user_id','SELECT s.* FROM user_settings s WHERE s.user_id IN (SELECT user_id FROM memberships WHERE project_id=?1) AND s.user_id>?2 AND s.avatar_url LIKE ?3 ORDER BY s.user_id LIMIT 200','avatar_url'],
 ]
 for(const [table,keyColumn,sql,column] of pages){
  for(let after='';;){
   const rows=(await env.DB.prepare(sql).bind(projectId,after,like).all<Row>()).results
   for(const canonical of rows){const next=rewrite.value(table,canonical[column]);const doors=rewrite.takeDoors();if(next!==canonical[column])changes.push({table,key:String(canonical[keyColumn]),keyColumn,canonical,next:{...canonical,[column]:next},doors})}
   if(rows.length<200)break
   after=String(rows.at(-1)![keyColumn]);await renew()
  }
 }

 // The workspace's settings: re-mapped from its journaled legacy row where the seed has not changed them since import.
 const settings=await env.DB.prepare('SELECT * FROM project_settings WHERE project_id=?').bind(projectId).first<Row>()
 if(settings){
  const state=(await readStates(env.DB,[['project_settings',projectId]])).get(stateKey('project_settings',projectId))
  const source=state&&await unchangedSinceImport(settings,state)?await env.DB.prepare('SELECT source_json FROM legacy_import_rows WHERE run_id=? AND source_table=? AND source_id=?').bind(state.run_id,state.source_table,state.source_id).first<{source_json:string}>():null
  const legacy=source&&source.source_json!=='{}'?JSON.parse(source.source_json) as Row:null
  let next:Row
  if(legacy){
   const [mapped,...doors]=rewrite.map('projects',legacy,[projectSettings(legacy)])
   next={...settings,...mapped.row}
   counts.settingsTranslated+=next.settings_json!==settings.settings_json?1:0
   if(Object.keys(mapped.row).some(column=>next[column]!==settings[column]))changes.push({table:'project_settings',key:projectId,keyColumn:'project_id',canonical:settings,next,state,doors})
  }else{
   counts.settingsLeft++
   const value=rewrite.value('project_settings',settings.settings_json),doors=rewrite.takeDoors()
   if(value!==settings.settings_json)changes.push({table:'project_settings',key:projectId,keyColumn:'project_id',canonical:settings,next:{...settings,settings_json:value},doors})
  }
 }

 // Each change, its file rows and its import state, in leased batches.
 const states=await readStates(env.DB,changes.filter(change=>!change.state).map(change=>[change.table,change.key]))
 const prepared=await Promise.all(changes.map(async change=>{
  const state=change.state??states.get(stateKey(change.table,change.key))
  const kept=!!state&&await unchangedSinceImport(change.canonical,state)
  const columns=Object.keys(change.next).filter(column=>change.next[column]!==change.canonical[column])
  const entries:unknown[][]=[]
  if(kept)entries.push([change.table,change.key,state!.columns,await columnsDigest(change.next,JSON.parse(state!.columns)),state!.source_digest,state!.run_id,state!.source_table,state!.source_id])
  // A file row is new and exactly what the import maps from the row that names it: it is recorded as that row's import.
  for(const door of change.doors)if(state)entries.push(await stateEntry(door.table,`${door.row.project_id}:${door.row.media_id}`,door.row,state!.source_digest,state!.run_id,state!.source_table,state!.source_id))
  // Compare-and-set: a row the seed changes while this runs is left for the next run.
  const update=env.DB.prepare(`UPDATE ${sqlName(change.table)} SET ${columns.map(c=>`${sqlName(c)}=json_extract(?1,'$.next.${c}')`).join(',')} WHERE ${sqlName(change.keyColumn)}=json_extract(?1,'$.key') AND ${columns.map(c=>`${sqlName(c)} IS json_extract(?1,'$.old.${c}')`).join(' AND ')}`).bind(JSON.stringify({key:change.key,next:Object.fromEntries(columns.map(c=>[c,change.next[c]])),old:Object.fromEntries(columns.map(c=>[c,change.canonical[c]]))}))
  return {change,kept,update,entries,bytes:jsonBytes(change.next)+jsonBytes(entries)}
 }))
 for(const group of byteSlices(prepared,item=>item.bytes,50)){
  const doors=[...new Map(group.flatMap(item=>item.change.doors).map(door=>[String(door.row.media_id),door])).values()]
  const before=doors.length?(await env.DB.prepare('SELECT count(*) n FROM legacy_import_files WHERE project_id=?').bind(projectId).first<{n:number}>())!.n:0
  const statements=[lease.assertion(env.DB),...group.map(item=>item.update)]
  if(doors.length)statements.push(insertJson(env.DB,'INSERT OR IGNORE INTO legacy_import_files(project_id,media_id,object_key,content_type,filename,audience)',6,doors.map(door=>['project_id','media_id','object_key','content_type','filename','audience'].map(column=>door.row[column]))))
  const entries=group.flatMap(item=>item.entries)
  if(entries.length)statements.push(stateStatement(env.DB,entries))
  statements.push(lease.cleared(env.DB))
  await env.DB.batch(statements).catch(async error=>{await lease.confirm();throw error})
  if(doors.length)counts.filesAdded+=(await env.DB.prepare('SELECT count(*) n FROM legacy_import_files WHERE project_id=?').bind(projectId).first<{n:number}>())!.n-before
  for(const item of group){counts.rowsRewritten[item.change.table as keyof typeof counts.rowsRewritten]++;if(item.kept)counts.stateKept++;else counts.changedSinceImport++}
  await renew()
 }
 return {...counts,...rewrite.summary()}
}
