import type {Env} from '../../../platform/env'
import type {LegacyPackageManifest} from '../worker-contract'
import {planDelta,type DeltaPlan,type DeltaSeed} from '../delta-plan'
import {readStates,stateKey,unchangedSinceImport} from '../state'
import {archiveOnly} from '../archive-only'
import {contactsOf} from '../delta-scope'
import {relationships} from '../relationships'
import {jsonBytes} from '../d1'
import {type Row as SourceRow} from '../types'
import {hydrate} from './context-read'
import {checkpoint,cursor,limits,json,type Run} from './state'
import {refuse} from './errors'
const own=`EXISTS(SELECT 1 FROM legacy_import_rows journal JOIN legacy_import_worker_parts part ON part.journal_run_id=journal.run_id WHERE part.run_id=?1 AND journal.source_table='messages' AND journal.source_id=native.id)`
/** Erasure scope is refreshed each quantum, limited to the hydrated ancestry. */
export async function scopedErased(env:Env,run:Run,table:string,rows:SourceRow[],context:any){
 const ids=[...new Set(rows.flatMap(row=>contactsOf(table,row,context)))];if(ids.length>500)refuse('row_too_large')
 const found=await env.DB.prepare(`SELECT contact_id FROM contact_erasures WHERE project_id=?1 AND contact_id IN (SELECT value FROM json_each(?2)) UNION SELECT contact_id FROM contact_erasure_leases WHERE project_id=?1 AND contact_id IN (SELECT value FROM json_each(?2))`).bind(run.project_id,JSON.stringify(ids)).all<{contact_id:string}>()
 return new Set(found.results.map(row=>row.contact_id))
}
function empty(erased=new Set<string>()):DeltaPlan{return {erased,messages:new Map(),conversations:new Map(),held:new Map(),heldIn:new Map(),gaining:new Set(),withheldMedia:new Set(),erasedMedia:new Set(),skippedMessages:new Set(),skippedConversations:new Set()}}
async function savePlan(env:Env,run:Run,table:string,id:string,parent:string|null,value:unknown){return env.DB.prepare(`INSERT OR REPLACE INTO legacy_import_context(run_id,kind,source_table,source_id,parent_id,row_json,row_digest) VALUES(?,'delta_plan',?,?,?,?,'')`).bind(run.id,table,id,parent,JSON.stringify(value))}
export async function deltaMessages(env:Env,run:Run,manifest:LegacyPackageManifest){
 const c=cursor(run);let conversation=String(c.conversation??''),after=Number(c.revision??0),summary:any
 if(!conversation){const next=await env.DB.prepare(`SELECT conversation FROM (SELECT DISTINCT message.conversation_id conversation FROM legacy_import_context_messages message JOIN legacy_import_context incoming ON incoming.run_id=message.run_id AND incoming.kind='delta_plan' AND incoming.source_table='incoming:messages' AND incoming.source_id=message.id WHERE message.run_id=?1 UNION SELECT source_id FROM legacy_import_context WHERE run_id=?1 AND kind='delta_plan' AND source_table='incoming:conversations') WHERE conversation>?2 ORDER BY conversation LIMIT 1`).bind(run.id,c.after??'').first<{conversation:string}>();if(!next){await checkpoint(env,run,{cursor_json:JSON.stringify({stage:'delta_media',after:''})});return {rows:0,bytes:0}}conversation=next.conversation;after=0}
 const prior=await env.DB.prepare("SELECT row_json FROM legacy_import_context WHERE run_id=? AND kind='delta_plan' AND source_table='conversations' AND source_id=?").bind(run.id,conversation).first<{row_json:string}>();summary=prior?JSON.parse(prior.row_json):null
 const incoming=await env.DB.prepare(`WITH incoming AS MATERIALIZED (SELECT message.row_json,message.revision FROM legacy_import_context_messages message JOIN legacy_import_context marker ON marker.run_id=message.run_id AND marker.kind='delta_plan' AND marker.source_table='incoming:messages' AND marker.source_id=message.id WHERE message.run_id=? AND message.conversation_id=? AND message.revision>? ORDER BY message.revision LIMIT ?),sized AS (SELECT row_json,revision,sum(length(CAST(row_json AS BLOB))+1) OVER (ORDER BY revision) bytes FROM incoming) SELECT row_json,revision FROM sized WHERE bytes+2<=${limits.bytes} ORDER BY revision`).bind(run.id,conversation,after,limits.rows).all<{row_json:string;revision:number}>()
 const rows=incoming.results.map(row=>JSON.parse(row.row_json) as SourceRow),bytes=jsonBytes(rows);if(bytes>limits.bytes)refuse('row_too_large')
 const hydrated=await hydrate(env,run,manifest,'messages',rows),related=relationships(hydrated.context)
 // Conversations with no incoming live message still need a baseline plan.
 if(!related.find('conversations',conversation)){
  const found=await env.DB.prepare("SELECT row_json FROM legacy_import_context WHERE run_id=? AND kind='record' AND source_table='conversations' AND source_id=?").bind(run.id,conversation).first<{row_json:string}>()
  if(found){hydrated.context.tables.conversations=[JSON.parse(found.row_json)];const original=related.find;related.find=(table,id)=>table==='conversations'&&String(id)===conversation?hydrated.context.tables.conversations[0]:original(table,id)}
 }
 if(!summary){
  const base=await env.DB.prepare(`SELECT coalesce(max(native.revision),0) revision FROM messages native WHERE native.conversation_id=?2 AND NOT (${own})`).bind(run.id,conversation).first<{revision:number}>()
  const fresh=await env.DB.prepare(`SELECT count(*) n,coalesce(max(message.revision),0) last FROM legacy_import_context_messages message JOIN legacy_import_context marker ON marker.run_id=message.run_id AND marker.kind='delta_plan' AND marker.source_table='incoming:messages' AND marker.source_id=message.id LEFT JOIN messages native ON native.id=message.id WHERE message.run_id=?1 AND message.conversation_id=?2 AND message.deleted=0 AND NOT EXISTS(SELECT 1 FROM legacy_mail_s3_receipts receipt WHERE receipt.ses_message_id=message.local_id) AND (native.id IS NULL OR ${own})`).bind(run.id,conversation).first<{n:number;last:number}>()
  const last=fresh?.last?await env.DB.prepare('SELECT id FROM legacy_import_context_messages WHERE run_id=? AND conversation_id=? AND revision=?').bind(run.id,conversation,fresh.last).first<{id:string}>():null
  summary={base:base?.revision??0,freshTotal:fresh?.n??0,lastFresh:last?.id??'',offset:0}
 }
 const ids=rows.map(row=>String(row.id)),locals=rows.map(row=>row.local_id).filter(value=>value!=null).map(String)
 const existing=await env.DB.prepare('SELECT id,conversation_id,revision,local_id FROM messages WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(ids)).all<{id:string;conversation_id:string;revision:number;local_id:string}>()
 const ours=await env.DB.prepare(`SELECT native.id FROM messages native WHERE native.id IN (SELECT value FROM json_each(?2)) AND ${own}`).bind(run.id,JSON.stringify(ids)).all<{id:string}>()
 const taken=await env.DB.prepare(`SELECT native.local_id FROM messages native WHERE native.conversation_id=?2 AND native.local_id IN (SELECT value FROM json_each(?3)) AND NOT (${own}) UNION SELECT json_extract(row_json,'$.message.local_id') FROM legacy_import_context WHERE run_id=?1 AND kind='delta_plan' AND source_table='messages' AND parent_id=?2 AND json_extract(row_json,'$.message.local_id') IN (SELECT value FROM json_each(?3))`).bind(run.id,conversation,JSON.stringify(locals)).all<{local_id:string}>()
 const erased=await scopedErased(env,run,'messages',rows,hydrated.context)
 const sourceConversation=related.find('conversations',conversation)
 if(sourceConversation&&(archiveOnly('conversations',sourceConversation,hydrated.context)||contactsOf('conversations',sourceConversation,hydrated.context).some(id=>erased.has(id))))summary.freshTotal=0
 const all=await env.DB.prepare(`SELECT count(*) total,sum(EXISTS(SELECT 1 FROM legacy_mail_s3_receipts receipt WHERE receipt.ses_message_id=message.local_id)) skipped FROM legacy_import_context_messages message JOIN legacy_import_context marker ON marker.run_id=message.run_id AND marker.kind='delta_plan' AND marker.source_table='incoming:messages' AND marker.source_id=message.id WHERE message.run_id=? AND message.conversation_id=?`).bind(run.id,conversation).first<{total:number;skipped:number}>()
 const canonical=await env.DB.prepare('SELECT 1 FROM conversations WHERE id=?').bind(conversation).first()
 const skipped=new Set<string>(!canonical&&all?.total&&all.total===all.skipped?[conversation]:[])
 const seed:DeltaSeed={erased,rows:existing.results,base:new Map([[conversation,summary.base]]),taken:new Map([[conversation,new Set(taken.results.map(row=>row.local_id))]]),offset:new Map([[conversation,summary.offset]]),freshTotal:new Map([[conversation,summary.freshTotal]]),lastFresh:new Map([[conversation,summary.lastFresh]]),skippedConversations:skipped}
 const plan=await planDelta(env.DB,{projectId:run.project_id,context:hydrated.context,conversations:[conversation],messages:rows,media:[],ours:new Set(ours.results.map(row=>row.id)),prepared:seed})
 const ownIds=new Set(ours.results.map(row=>row.id)),nativeIds=new Set(existing.results.filter(row=>!ownIds.has(row.id)).map(row=>row.id))
 summary.offset+=rows.filter(row=>!row.deleted_at&&!plan.skippedMessages.has(String(row.id))&&!nativeIds.has(String(row.id))&&!archiveOnly('messages',row,hydrated.context)&&!contactsOf('messages',row,hydrated.context).some(id=>erased.has(id))).length
 Object.assign(summary,{conversation:plan.conversations.get(conversation),heldIn:plan.heldIn.get(conversation)??(summary.freshTotal&&!plan.gaining.has(conversation)?summary.freshTotal:0),gaining:plan.gaining.has(conversation),skipped:plan.skippedConversations.has(conversation)})
 const statements=[await savePlan(env,run,'conversations',conversation,null,summary)]
 for(const row of rows){const id=String(row.id);statements.push(await savePlan(env,run,'messages',id,conversation,{message:plan.messages.get(id),held:plan.held.get('messages:'+id),skipped:plan.skippedMessages.has(id)}))}
 const more=await env.DB.prepare(`SELECT 1 FROM legacy_import_context_messages message JOIN legacy_import_context marker ON marker.run_id=message.run_id AND marker.kind='delta_plan' AND marker.source_table='incoming:messages' AND marker.source_id=message.id WHERE message.run_id=? AND message.conversation_id=? AND message.revision>? LIMIT 1`).bind(run.id,conversation,incoming.results.at(-1)?.revision??after).first(),done=!more,next=done?{stage:'delta',after:conversation}:{stage:'delta',after:c.after??'',conversation,revision:incoming.results.at(-1)!.revision}
 await checkpoint(env,run,{cursor_json:JSON.stringify(next)},statements);return {rows:rows.length,bytes}
}
export async function deltaMedia(env:Env,run:Run,manifest:LegacyPackageManifest){
 const c=cursor(run),found=await env.DB.prepare(`SELECT source.source_id,source.row_json FROM legacy_import_context source JOIN legacy_import_context marker ON marker.run_id=source.run_id AND marker.kind='delta_plan' AND marker.source_table='incoming:media' AND marker.source_id=source.source_id WHERE source.run_id=? AND source.kind='record' AND source.source_table='media' AND source.source_id>? ORDER BY source.source_id LIMIT ?`).bind(run.id,c.after??'',limits.rows).all<{source_id:string;row_json:string}>()
 if(!found.results.length){await checkpoint(env,run,{cursor_json:JSON.stringify({stage:'rows',ordinal:0,row:0})});return {rows:0,bytes:0}}
 const rows=found.results.map(row=>JSON.parse(row.row_json)),hydrated=await hydrate(env,run,manifest,'media',rows),ids=[...(hydrated.context.tables.conversations??[]).map(row=>String(row.id))],erased=await scopedErased(env,run,'media',rows,hydrated.context)
 const seed:DeltaSeed={erased,rows:[],base:new Map(),taken:new Map(),offset:new Map(),freshTotal:new Map(),lastFresh:new Map(),skippedConversations:new Set()}
 const plan=await planDelta(env.DB,{projectId:run.project_id,context:hydrated.context,conversations:ids,messages:[],media:rows,ours:new Set(),prepared:seed})
 const statements=[];for(const row of rows){const id=String(row.id);statements.push(await savePlan(env,run,'media',id,null,{withheld:plan.withheldMedia.has(id),erased:plan.erasedMedia.has(id),held:plan.held.get('media:'+id)}))}
 await checkpoint(env,run,{cursor_json:JSON.stringify({stage:'delta_media',after:found.results.at(-1)!.source_id})},statements);return {rows:rows.length,bytes:jsonBytes(rows)}
}
export async function readDelta(env:Env,run:Run,table:string,rows:SourceRow[],context:any){
 const plan=empty(await scopedErased(env,run,table,rows,context)),ids=rows.map(row=>String(row.id)),conversations=(context.tables.conversations??[]).map((row:SourceRow)=>String(row.id))
 const stored=await env.DB.prepare(`SELECT source_table,source_id,row_json FROM legacy_import_context WHERE run_id=? AND kind='delta_plan' AND ((source_table=? AND source_id IN (SELECT value FROM json_each(?))) OR (source_table='conversations' AND source_id IN (SELECT value FROM json_each(?))))`).bind(run.id,table,JSON.stringify(ids),JSON.stringify(conversations)).all<{source_table:string;source_id:string;row_json:string}>()
 for(const item of stored.results){const row=JSON.parse(item.row_json),id=item.source_id
  if(item.source_table==='conversations'){if(row.conversation)plan.conversations.set(id,row.conversation);if(row.heldIn)plan.heldIn.set(id,row.heldIn);if(row.gaining)plan.gaining.add(id);if(row.skipped)plan.skippedConversations.add(id)}
  if(item.source_table==='messages'){if(row.message)plan.messages.set(id,row.message);if(row.held)plan.held.set('messages:'+id,row.held);if(row.skipped)plan.skippedMessages.add(id)}
  if(item.source_table==='media'){if(row.withheld)plan.withheldMedia.add(id);if(row.erased)plan.erasedMedia.add(id);if(row.held)plan.held.set('media:'+id,row.held)}
 }
 // A native conversation edit after preflight also withholds fresh messages.
 for(const conversation of conversations){const native=await env.DB.prepare('SELECT * FROM conversations WHERE id=?').bind(conversation).first<SourceRow>();if(!native)continue;const state=await readStates(env.DB,[['conversations',conversation]]);if(native.status_category==='closed'||!await unchangedSinceImport(native,state.get(stateKey('conversations',conversation))))for(const source of rows)if(table==='messages'&&String(source.conversation_id)===conversation&&!await env.DB.prepare('SELECT 1 FROM messages WHERE id=?').bind(String(source.id)).first())plan.held.set('messages:'+source.id,conversation)}
 return plan
}
