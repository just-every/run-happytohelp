import type { D1Sql, D1TargetAdapter, TargetRow, D1Database } from '../import-kit/src/d1/index'
import {LIMITS} from './types'
import type { NativeValue } from './readers/normalise'
import {completeImportedTicket} from './ticket-state'
import {emailKey} from './contact-keys'
interface Table {name:string;key:string;columns:string[];order:string;generated?:string[];nativeOnly?:boolean}
const table=(name:string,key:string,columns:string,order=key,generated?:string[]):Table=>({name,key,columns:columns.split(','),order,generated})
const entities:Record<string,Table[]>={
 field:[table('ticket_fields','id','project_id,id,name,type,required,options_json,validation_json,read_roles_json,write_roles_json,updated_at')],
 form:[table('request_forms','id','project_id,id,config_json,enabled,updated_at')],
 group:[table('ticket_groups','id','project_id,id,name,updated_at'),table('ticket_group_members','group_id','project_id,group_id,user_id','user_id')],
 calendar:[table('workflow_calendars','id','project_id,id,name,timezone,weekly_json,holidays,closures_json,active,updated_at')],
 view:[table('ticket_views','id','id,project_id,owner_id,name,visibility,filters_json,sort_json,version,created_at,updated_at')],
 rule:[table('workflow_rules','id','id,project_id,name,kind,position,state,draft_json,published_version,owner_id,created_at,updated_at'),table('workflow_rule_versions','rule_id','rule_id,project_id,version,definition_json,published_by,published_at,event_after_id','version')],
 category:[table('knowledge_categories','id','id,project_id,parent_id,name,slug,summary,is_published,position')],
 tag:[table('workspace_tags','id','id,project_id,name,normalized_name')],
 contact:[table('contacts','id','id,project_id,name,email,external_id,created_at,is_verified,metadata_json'),table('context_subjects','subject_id','project_id,subject_id,consent,revision,help_types,bot_enabled')],
 macro:[table('macros','id','id,project_id,title,content,created_by,created_at,updated_at'),table('macro_heads','macro_id','macro_id,version,archived_at,archived_by'),table('macro_versions','macro_id','macro_id,project_id,version,title,content,actions_json,scope_json,created_by,created_at','version')],
 article:[table('knowledge_articles','id','id,project_id,category_id,slug,title,content,summary,status,updated_at,position,source_revision,source_incarnation,publication_version','id',['publication_version']),table('knowledge_article_categories','article_id','article_id,category_id','category_id')],
 conversation:[
  table('conversations','id','id,project_id,contact_id,revision,last_message_id,assigned_to,resolved_at,created_at,updated_at,mailbox_id,subject,status_id,status_category,channel,group_id'),
  table('move_in_conversations','conversation_id','conversation_id,project_id,vendor,source_id,subject,source_state,source_channel'),
  table('email_threading_keys','conversation_id','project_id,conversation_id,key_kind,key_value,source,source_ref,created_at',"key_kind||':'||key_value"),
  table('messages','conversation_id','id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at,intent_hash,bucket_id,erased_at,citations_json','id'),
  table('move_in_message_sources','message_id','message_id,project_id,author_json,source_id,source_time,time_provenance','message_id'),
  table('move_in_notes','conversation_id','id,project_id,conversation_id,author_json,content,created_at,source_time','id'),
  table('ticket_field_values','conversation_id','project_id,conversation_id,field_id,value_json','field_id'),
  table('conversation_tags','conversation_id','project_id,conversation_id,tag_id','tag_id'),
  ...[
   table('message_authorship','message_id','message_id,project_id,kind,source_kind,source_id,source_part,recorded_at','message_id'),
   table('conversation_ratings','resolution_id','resolution_id,value,comment,updated_at,revision','resolution_id'),
   table('conversation_rating_history','resolution_id','id,resolution_id,value,comment,created_at,revision','id'),
   table('reporting_legacy_conversations','conversation_id','project_id,conversation_id,run_id'),
   table('conversation_tracking','conversation_id','conversation_id,project_id,initial_history_complete,cycle_history_complete,cycle_start_revision,cycle_start_at,cycle_epoch,first_resolved_at,transition_id'),
   table('ai_handoff_receipts','conversation_id','id,project_id,conversation_id,generation_id,agent_id,revision,created_at','id'),
   table('conversation_handoffs','conversation_id','id,project_id,conversation_id,agent_id,revision,created_at,cycle_epoch','id'),
   table('conversation_resolutions','conversation_id','id,project_id,conversation_id,contact_id,ordinal,resolved_at,resolved_revision,cycle_start_revision,outcome,evidence_json,reopened_at','id'),
   table('conversation_notes','conversation_id','id,conversation_id,user_id,content,created_at','id'),
   table('conversation_ai','conversation_id','conversation_id,ai_id'),
   table('conversation_participants','conversation_id','id,conversation_id,contact_id,created_at','id'),
   table('conversation_buckets','conversation_id','id,conversation_id,created_at,metadata_json','id'),
   table('media','conversation_id','id,project_id,conversation_id,uploaded_by,object_key,filename,content_type,size,message_id,created_at','id')
  ].map(t=>({...t,nativeOnly:true}))]
}
function definitions(kind:string){const value=entities[kind];if(!value)throw new Error('unsupported_native_target');return value}
function where(t:Table){if(t.name==='macro_heads')return 'macro_id=? AND macro_id IN (SELECT id FROM macros WHERE project_id=?)';if(t.name==='message_authorship')return 'message_id IN (SELECT id FROM messages WHERE conversation_id=? AND project_id=?)';if(t.name==='conversation_ratings'||t.name==='conversation_rating_history')return 'resolution_id IN (SELECT id FROM conversation_resolutions WHERE conversation_id=? AND project_id=?)';if(t.nativeOnly)return 'conversation_id=? AND conversation_id IN (SELECT id FROM conversations WHERE project_id=?)';if(t.name==='move_in_message_sources')return 'project_id=? AND message_id IN (SELECT id FROM messages WHERE project_id=? AND conversation_id=?)';if(t.name==='knowledge_article_categories')return 'article_id=? AND article_id IN (SELECT id FROM knowledge_articles WHERE project_id=?)';return `project_id=? AND ${t.key}=?`}
function params(t:Table,destination:string,id:string){return t.nativeOnly?[id,destination]:t.name==='move_in_message_sources'?[destination,destination,id]:['knowledge_article_categories','macro_heads'].includes(t.name)?[id,destination]:[destination,id]}
function select(t:Table){return `(SELECT COALESCE(json_group_array(json_array(${t.columns.join(',')})),'[]') FROM (SELECT ${t.columns.join(',')} FROM ${t.name} WHERE ${where(t)} ORDER BY ${t.order}))`}
function orderKey(t:Table,row:Record<string,any>){return t.name==='email_threading_keys'?`${row.key_kind}:${row.key_value}`:String(row[t.order])}
function expected(t:Table,value:NativeValue){return JSON.stringify([...(value.tables[t.name]??[])].sort((a,b)=>orderKey(t,a)<orderKey(t,b)?-1:orderKey(t,a)>orderKey(t,b)?1:0).map(row=>t.columns.map(column=>column==='publication_version'?`${row.source_incarnation}:${row.source_revision}`:row[column]??null)))}
function guard(row:TargetRow|null,destination:string,kind:string,id:string):D1Sql {
 const defs=definitions(kind),clauses:string[]=[],bindings:any[]=[]
 for(const t of defs){clauses.push(`${select(t)}=?`);bindings.push(...params(t,destination,id),row?expected(t,row.value as unknown as NativeValue):'[]')}
 if(row&&kind==='field'){clauses.push("NOT EXISTS(SELECT 1 FROM ticket_field_values WHERE project_id=? AND field_id=?) AND NOT EXISTS(SELECT 1 FROM request_forms f,json_each(f.config_json,'$.fields') ref WHERE f.project_id=? AND json_extract(ref.value,'$.fieldId')=?)");bindings.push(destination,id,destination,id)}
 if(row&&kind==='form'){clauses.push('NOT EXISTS(SELECT 1 FROM request_form_submissions WHERE project_id=? AND form_id=?)');bindings.push(destination,id)}
 if(row&&kind==='group'){clauses.push('NOT EXISTS(SELECT 1 FROM conversations WHERE project_id=? AND group_id=?)');bindings.push(destination,id)}
 if(row&&kind==='calendar'){clauses.push('NOT EXISTS(SELECT 1 FROM sla_policies WHERE project_id=? AND calendar_id=?)');bindings.push(destination,id)}
 if(row){clauses.push('EXISTS(SELECT 1 FROM move_in_origins WHERE project_id=? AND target_kind=? AND target_id=? AND revision=? AND source_json=?)');bindings.push(destination,kind,id,row.revision,JSON.stringify((row.value as unknown as NativeValue).source))}
 else {clauses.push('NOT EXISTS(SELECT 1 FROM move_in_origins WHERE project_id=? AND target_kind=? AND target_id=?)');bindings.push(destination,kind,id)}
 return {sql:`(${clauses.join(' AND ')})`,params:bindings}
}
export function nativeStatementCount(kind:string,value:NativeValue){return definitions(kind).filter(t=>!t.nativeOnly).reduce((n,t)=>n+(value.tables[t.name]?.length??0),0)+1+(kind==='conversation'?2:kind==='article'||kind==='contact'?1:0)}
export function completeNativeValue(kind:string,value:NativeValue):NativeValue {
 if(kind==='conversation')completeImportedTicket(value)
 if(kind==='macro'){
  const m=value.tables.macros[0]
  value.tables.macro_heads??=[{macro_id:m.id,version:1,archived_at:null,archived_by:null}]
  value.tables.macro_versions??=[{macro_id:m.id,project_id:m.project_id,version:1,title:m.title,content:m.content,actions_json:'{}',scope_json:'{"visibility":"shared","roles":[],"groups":[],"brands":[]}',created_by:m.created_by,created_at:m.updated_at}]
 }

 for(const t of definitions(kind))value.tables[t.name]=(value.tables[t.name]??[]).map(row=>Object.fromEntries(t.columns.map(column=>[column,column==='publication_version'?`${row.source_incarnation}:${row.source_revision}`:row[column]??null]))).sort((a,b)=>orderKey(t,a)<orderKey(t,b)?-1:orderKey(t,a)>orderKey(t,b)?1:0)
 return value
}
export const nativeTargets:D1TargetAdapter={
 async read(db,destination,kind,id){
  const defs=definitions(kind),row:any=await db.prepare(`SELECT ${defs.map((t,i)=>`${select(t)} AS t${i}`).join(',')},(SELECT source_json FROM move_in_origins WHERE project_id=? AND target_kind=? AND target_id=?) AS source,(SELECT revision FROM move_in_origins WHERE project_id=? AND target_kind=? AND target_id=?) AS revision`).bind(...defs.flatMap(t=>params(t,destination,id)),destination,kind,id,destination,kind,id).first()
  const tables:NativeValue['tables']={};for(let i=0;i<defs.length;i++){const t=defs[i];tables[t.name]=JSON.parse(row[`t${i}`]).map((values:any[])=>Object.fromEntries(t.columns.map((column,index)=>[column,values[index]])))}
  if(!row.source&&!Object.values(tables).some(rows=>rows.length))return undefined
  // An unowned native collision is visible to the kit and cannot be overwritten without review.
  return {destination,targetKind:kind,targetId:id,revision:row.revision??'native',value:{tables,source:row.source?JSON.parse(row.source):{}} as any}
 },
 matches:guard,
 write(row){const value=row.value as unknown as NativeValue,statements:D1Sql[]=[]
  if(row.targetKind==='conversation')statements.push({sql:'INSERT INTO move_in_native_fences(project_id,conversation_id) VALUES(?,?)',params:[row.destination,row.targetId]})
  for(const t of definitions(row.targetKind).filter(t=>!t.nativeOnly&&!['macro_heads','macro_versions'].includes(t.name)))for(const item of value.tables[t.name]??[]){if(item.project_id!==undefined&&item.project_id!==row.destination)throw new Error('native_destination_mismatch');const columns=t.columns.filter(c=>!t.generated?.includes(c));statements.push({sql:`INSERT ${t.name==='context_subjects'?'OR REPLACE ':''}INTO ${t.name}(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`,params:columns.map(c=>item[c]??null)})}
  if(row.targetKind==='macro'){const version=value.tables.macro_versions[0];statements.push({sql:'UPDATE macro_versions SET actions_json=?,scope_json=? WHERE macro_id=? AND project_id=? AND version=1',params:[version.actions_json,version.scope_json,row.targetId,row.destination]})}
  if(row.targetKind==='contact'){const contact=value.tables.contacts[0];statements.push({sql:'UPDATE move_in_contact_keys SET email_digest=? WHERE project_id=? AND contact_id=? AND EXISTS(SELECT 1 FROM contacts WHERE project_id=? AND id=? AND email IS ?)',params:[emailKey(row.destination,contact.email),row.destination,row.targetId,row.destination,row.targetId,contact.email]})}
  if(row.targetKind==='article'){const article=value.tables.knowledge_articles[0];statements.push({sql:'UPDATE knowledge_articles SET source_incarnation=?,source_revision=? WHERE id=? AND project_id=?',params:[article.source_incarnation,article.source_revision,row.targetId,row.destination]})}
  if(row.targetKind==='conversation')statements.push({sql:'DELETE FROM move_in_native_fences WHERE project_id=? AND conversation_id=?',params:[row.destination,row.targetId]})
  statements.push({sql:'INSERT INTO move_in_origins(project_id,target_kind,target_id,vendor,source_id,source_json,revision) VALUES(?,?,?,?,?,?,?)',params:[row.destination,row.targetKind,row.targetId,value.source.vendor,value.source.id,JSON.stringify(value.source),row.revision]});return statements
 },
 remove(destination,kind,id){const statements=[...definitions(kind)].filter(t=>!t.nativeOnly).reverse().map(t=>({sql:`DELETE FROM ${t.name} WHERE ${where(t)}`,params:params(t,destination,id)})).concat([{sql:'DELETE FROM move_in_origins WHERE project_id=? AND target_kind=? AND target_id=?',params:[destination,kind,id]}]);if(kind==='conversation'){statements.unshift({sql:"DELETE FROM context_tracked_events WHERE project_id=? AND type='MESSAGE_READ' AND json_valid(payload) AND json_extract(payload,'$.conversation_id')=?",params:[destination,id]});statements.unshift({sql:'DELETE FROM conversation_reads WHERE conversation_id=? AND conversation_id IN (SELECT id FROM conversations WHERE project_id=?)',params:[id,destination]});statements.unshift({sql:'INSERT INTO move_in_native_fences(project_id,conversation_id) VALUES(?,?)',params:[destination,id]});statements.push({sql:'DELETE FROM move_in_native_fences WHERE project_id=? AND conversation_id=?',params:[destination,id]})}return statements},
 async list(db,destination){
  const origins=(await db.prepare('SELECT * FROM move_in_origins WHERE project_id=? ORDER BY target_kind,target_id').bind(destination).all<any>()).results
  return snapshotsForOrigins(db,destination,origins)
 },
 matchesCount(count,destination){return {sql:'(SELECT COUNT(*) FROM move_in_origins WHERE project_id=?)=?',params:[destination,count]}}
}

/** Preserve the adapter's complete owned-set export contract, while planning can
 * request only this upload's candidate targets. Never return a partial bundle. */
export async function readNativeCandidates(db:D1Database,destination:string,candidates:{kind:string;id:string}[]){
 const origins=(await db.prepare(`SELECT DISTINCT o.* FROM json_each(?2) c CROSS JOIN move_in_origins o ON o.project_id=?1 AND o.target_kind=json_extract(c.value,'$.kind') AND o.target_id=json_extract(c.value,'$.id') ORDER BY o.target_kind,o.target_id`).bind(destination,JSON.stringify(candidates)).all<any>()).results
 const oversized=new Set<string>(),totals=new Map<string,number>()
 for(const kind of Object.keys(entities)){
  const owned=origins.filter(origin=>origin.target_kind===kind);if(!owned.length)continue
  const ids=JSON.stringify(owned.map(origin=>origin.target_id))
  for(const t of definitions(kind)){
   const sizes=(await db.prepare(`SELECT bundle_id,COUNT(*) n,SUM(length(CAST(json_object(${t.columns.flatMap(column=>[`'${column}'`,column]).join(',')}) AS BLOB))) bytes FROM (${snapshotQuery(t)}) GROUP BY bundle_id`).bind(destination,ids).all<{bundle_id:string;n:number;bytes:number}>()).results
   for(const size of sizes){const key=`${kind}/${size.bundle_id}`,total=(totals.get(key)??0)+size.bytes;totals.set(key,total);if(total>LIMITS.planContentBytes||size.n>LIMITS.nativeStatements)oversized.add(key)}
  }
 }
 if([...totals.values()].reduce((sum,size)=>sum+size,0)>LIMITS.expandedBytes*4)for(const origin of origins)oversized.add(`${origin.target_kind}/${origin.target_id}`)
 return {rows:await snapshotsForOrigins(db,destination,origins.filter(origin=>!oversized.has(`${origin.target_kind}/${origin.target_id}`))),oversized}
}
function snapshotQuery(t:Table){
 // CROSS JOIN fixes the bounded candidate list as the outer loop. Otherwise
 // SQLite can choose a project index and visit every unrelated workspace row.
 const ids='json_each(?2) wanted'
 return t.name==='macro_heads'?`SELECT c.*,c.macro_id AS bundle_id FROM ${ids} CROSS JOIN macros m ON m.id=wanted.value AND m.project_id=?1 CROSS JOIN macro_heads c ON c.macro_id=m.id`:
    t.name==='message_authorship'?`SELECT c.*,m.conversation_id AS bundle_id FROM ${ids} CROSS JOIN messages m ON m.project_id=?1 AND m.conversation_id=wanted.value CROSS JOIN message_authorship c ON c.message_id=m.id AND c.project_id=?1`:
    t.name==='conversation_ratings'||t.name==='conversation_rating_history'?`SELECT c.*,r.conversation_id AS bundle_id FROM ${ids} CROSS JOIN conversation_resolutions r ON r.project_id=?1 AND r.conversation_id=wanted.value CROSS JOIN ${t.name} c ON c.resolution_id=r.id`:
    t.name==='move_in_message_sources'?`SELECT c.*,m.conversation_id AS bundle_id FROM ${ids} CROSS JOIN messages m ON m.project_id=?1 AND m.conversation_id=wanted.value CROSS JOIN move_in_message_sources c ON c.message_id=m.id AND c.project_id=?1`:
    t.nativeOnly?`SELECT c.*,c.conversation_id AS bundle_id FROM ${ids} CROSS JOIN conversations v ON v.id=wanted.value AND v.project_id=?1 CROSS JOIN ${t.name} c ON c.conversation_id=v.id`:
    t.name==='knowledge_article_categories'?`SELECT c.*,c.article_id AS bundle_id FROM ${ids} CROSS JOIN knowledge_articles a ON a.id=wanted.value AND a.project_id=?1 CROSS JOIN knowledge_article_categories c ON c.article_id=a.id`:
    `SELECT c.*,c.${t.key} AS bundle_id FROM ${ids} CROSS JOIN ${t.name} c ON c.${t.key}=wanted.value AND c.project_id=?1`
}
async function snapshotsForOrigins(db:D1Database,destination:string,origins:any[]):Promise<TargetRow[]>{
 const result:TargetRow[]=[]
 for(const kind of Object.keys(entities)){
  const owned=origins.filter(origin=>origin.target_kind===kind);if(!owned.length)continue
  const ids=JSON.stringify(owned.map(origin=>origin.target_id)),snapshots=new Map<string,Map<string,any[]>>()
  for(const t of definitions(kind)){
   const sql=snapshotQuery(t)
   const groups=new Map<string,any[]>();for(const row of (await db.prepare(sql).bind(destination,ids).all<any>()).results){const group=groups.get(row.bundle_id)??[];group.push(row);groups.set(row.bundle_id,group)}snapshots.set(t.name,groups)
  }
  for(const origin of owned){const tables:NativeValue['tables']={};for(const t of definitions(kind))tables[t.name]=snapshots.get(t.name)?.get(origin.target_id)??[];result.push({destination,targetKind:kind,targetId:origin.target_id,revision:origin.revision,value:completeNativeValue(kind,{tables,source:JSON.parse(origin.source_json)}) as any})}
 }
 return result
}
