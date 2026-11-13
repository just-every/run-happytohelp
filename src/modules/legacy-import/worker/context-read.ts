import type {Env} from '../../../platform/env'
import type {LegacyPackageManifest} from '../worker-contract'
import {type Row,type LegacyBundle,timestamp} from '../types'
import {useRelationships,type Relationships,isMessageMedia,contactIdentity} from '../relationships'
import {packageMediaIndex,type MediaIndex} from '../media-index'
import {rewriteText} from '../media-urls'
import {jsonBytes} from '../d1'
import {limits,type Run} from './state'
import {jsonRows} from './json-rows'
import {refuse} from './errors'
const refs:Record<string,string[]>={project_id:['projects'],conversation_id:['conversations'],contact_id:['contacts'],user_id:['users'],agent_id:['users','ais','ai_profiles'],ai_id:['ais','ai_profiles'],dataset_id:['datasets','knowledge_datasets'],media_id:['media'],original_media_id:['media'],message_id:['messages'],support_delegation_id:['support_delegations'],article_id:['articles','knowledge_articles'],category_id:['categories','knowledge_categories']}
/** Async hydration ends before any synchronous mapper runs. */
export async function hydrate(env:Env,run:Run,manifest:LegacyPackageManifest,table:string,sourceRows:Row[]){
 const records=new Map<string,Map<string,Row>>(),requested=new Map<string,Set<string>>(),loaded=new Set<string>();let bytes=0
 const add=(table:string,row:Row)=>{if(row.project_id!=null&&String(row.project_id)!==run.source_project_id||table==='projects'&&String(row.id)!==run.source_project_id)refuse('invalid_scope',422);const id=String(row.id??''),list=records.get(table)??new Map<string,Row>();records.set(table,list);bytes+=4*(jsonBytes(row)-(list.has(id)?jsonBytes(list.get(id)):0));if(bytes>limits.closureBytes)refuse('row_too_large');list.set(id,row)}
 const want=(table:string,id:unknown)=>{if(id===undefined||id===null||id==='')return;const ids=requested.get(table)??new Set<string>();requested.set(table,ids);ids.add(String(id));if(ids.size>500)refuse('row_too_large')}
 const inspect=(table:string,row:Row)=>{
  for(const [field,tables] of Object.entries(refs))for(const related of tables)want(related,row[field])
  if(row.parent_id)want(table,row.parent_id)
  if(table==='mediables'){const model=String(row.mediable_type),parent=model.endsWith('Message')?'messages':model.endsWith('Event')?'events':model.endsWith('SupportDelegation')?'support_delegations':undefined;if(parent)want(parent,row.mediable_id)}
 }
 for(const row of sourceRows){add(table,row);inspect(table,row);if(table==='media')want('media',row.id)}
 want('projects',run.source_project_id)
 // The mapper's team/default arrays are bounded independently of history size.
 for(const small of ['users','project_users','memberships','ais','ai_profiles','ai_defaults']){
  const rows=await jsonRows<{row_json:string}>(env.DB,"SELECT row_json FROM legacy_import_context WHERE run_id=? AND kind='record' AND source_table=?",[run.id,small],['row_json'],250,(limits.closureBytes-bytes)/4)
  if(rows.results.length>250)refuse('row_too_large');for(const row of rows.results)add(small,JSON.parse(row.row_json))
 }
 const keys=new Set<string>();const collect=(value:unknown)=>{if(typeof value==='string')rewriteText(value,key=>{keys.add(key);return undefined},{rewritten:0,left:0});else if(Array.isArray(value))value.forEach(collect);else if(value&&typeof value==='object')Object.values(value).forEach(collect)};sourceRows.forEach(collect)
 if(keys.size){const media=await jsonRows<{media_id:string;row_json:string}>(env.DB,`SELECT media_id,row_json FROM legacy_import_context_media WHERE run_id=? AND legacy_key IN (SELECT value FROM json_each(?)) AND link_id=''`,[run.id,JSON.stringify([...keys])],['media_id','row_json'],250,(limits.closureBytes-bytes)/4);if(media.results.length>250)refuse('row_too_large');for(const row of media.results){add('media',JSON.parse(row.row_json));want('media',row.media_id)}}
 const links=new Map<string,Row[]>(),pivots=new Map<string,Row>()
 for(let depth=0;depth<12;depth++){
  let more=false
  for(const [related,ids] of requested){const pending=[...ids].filter(id=>!loaded.has(related+'\0'+id));if(!pending.length)continue;more=true;for(const id of pending)loaded.add(related+'\0'+id)
   const rows=await jsonRows<{row_json:string}>(env.DB,"SELECT row_json FROM legacy_import_context WHERE run_id=? AND kind='record' AND source_table=? AND source_id IN (SELECT value FROM json_each(?))",[run.id,related,JSON.stringify(pending)],['row_json'],500,(limits.closureBytes-bytes)/4)
   for(const item of rows.results){const row=JSON.parse(item.row_json);add(related,row);inspect(related,row)}
   if(related==='media'){
    const found=await jsonRows<{media_id:string;row_json:string}>(env.DB,"SELECT media_id,row_json FROM legacy_import_context_media WHERE run_id=? AND media_id IN (SELECT value FROM json_each(?)) AND link_id NOT IN ('','prior-record') ORDER BY media_id,link_id",[run.id,JSON.stringify(pending)],['media_id','row_json'],250,(limits.closureBytes-bytes)/4);if(found.results.length>250)refuse('row_too_large')
    for(const item of found.results){bytes+=4*jsonBytes(item.row_json);if(bytes>limits.closureBytes)refuse('row_too_large');const row=JSON.parse(item.row_json),list=links.get(item.media_id)??[];links.set(item.media_id,list);list.push(row);if(isMessageMedia(row))pivots.set(item.media_id,row);inspect('mediables',row)}
   }
  }
  if(!more)break;if(depth===11)refuse('row_too_large')
 }
 // Direct source media also needs its links even if its ID had no incoming FK.
 if(table==='media')for(const row of sourceRows)want('media',row.id)
 const conversations=[...new Set([...(records.get('conversations')?.keys()??[]),...sourceRows.map(row=>String(row.conversation_id??'')).filter(Boolean)])]
 const summaries=await env.DB.prepare("SELECT source_id,row_json FROM legacy_import_context WHERE run_id=? AND kind='conversation_summary' AND source_table='conversations' AND source_id IN (SELECT value FROM json_each(?))").bind(run.id,JSON.stringify(conversations)).all<{source_id:string;row_json:string}>()
 const summary=new Map(summaries.results.map(row=>[row.source_id,JSON.parse(row.row_json) as {count:number;lastId:string|null}]))
 const ids=[...new Set([...(records.get('messages')?.keys()??[]),...(table==='messages'?sourceRows.map(row=>String(row.id)):[])])]
 const positions=await env.DB.prepare('SELECT id,conversation_id,local_id,revision FROM legacy_import_context_messages WHERE run_id=? AND id IN (SELECT value FROM json_each(?))').bind(run.id,JSON.stringify(ids)).all<{id:string;conversation_id:string;local_id:string|null;revision:number}>()
 const revisions=new Map(positions.results.map(row=>[row.id,row.revision])),localOwners=new Map<string,string>()
 const local=positions.results.filter(row=>row.local_id).map(row=>[row.conversation_id,row.local_id])
 if(local.length){const owners=await env.DB.prepare(`SELECT conversation_id,local_id,id,revision FROM legacy_import_context_messages WHERE run_id=? AND deleted=0 AND (conversation_id,local_id) IN (SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]') FROM json_each(?)) AND revision=(SELECT min(owner.revision) FROM legacy_import_context_messages owner WHERE owner.run_id=legacy_import_context_messages.run_id AND owner.conversation_id=legacy_import_context_messages.conversation_id AND owner.local_id=legacy_import_context_messages.local_id AND owner.deleted=0)`).bind(run.id,JSON.stringify(local)).all<{conversation_id:string;local_id:string;id:string}>();for(const row of owners.results)localOwners.set(row.conversation_id+'\0'+row.local_id,row.id)}
 const contactRows=[...(records.get('contacts')?.values()??[])],identityRows=await env.DB.prepare('SELECT identity,contact_id FROM legacy_import_context_identities WHERE run_id=? AND project_id=? AND identity IN (SELECT value FROM json_each(?))').bind(run.id,run.source_project_id,JSON.stringify(contactRows.map(contactIdentity).filter(value=>value!==null))).all<{identity:string;contact_id:string}>()
 const identityOwners=new Map(identityRows.results.map(row=>[row.identity,{id:row.contact_id} as Row]))
 const datasets=[...(records.get('datasets')?.keys()??[]),...(records.get('knowledge_datasets')?.keys()??[])],publishedCounts=new Map<string,number>(),published=new Set<string>()
 if(datasets.length){const counts=await env.DB.prepare("SELECT parent_id,count(*) n FROM legacy_import_context WHERE run_id=? AND kind='media_lookup' AND source_table='dataset_files' AND parent_id IN (SELECT value FROM json_each(?)) GROUP BY parent_id").bind(run.id,JSON.stringify(datasets)).all<{parent_id:string;n:number}>();for(const id of datasets)publishedCounts.set(id,0);for(const row of counts.results)publishedCounts.set(row.parent_id,row.n)}
 if(table==='dataset_files'){const files=await env.DB.prepare("SELECT parent_id,source_id FROM legacy_import_context WHERE run_id=? AND kind='media_lookup' AND source_table='dataset_files' AND source_id IN (SELECT value FROM json_each(?))").bind(run.id,JSON.stringify(sourceRows.map(row=>String(row.id)))).all<{parent_id:string;source_id:string}>();for(const row of files.results)published.add(row.parent_id+'\0'+row.source_id)}
 const context:LegacyBundle={format:'happytohelp-legacy-v1',source:manifest.source,tables:Object.fromEntries([...records].filter(([name])=>name!=='dataset_files').map(([name,rows])=>[name,[...rows.values()]]))}
 const index:Relationships={find:(name,id)=>records.get(name)?.get(String(id)),messages:{get:()=>undefined},conversationSummary:{get:id=>summary.get(id)},revisions:{get:id=>revisions.get(id)},mediaMessages:{get:id=>pivots.get(id)},mediaLinks:{get:id=>links.get(id)},identityOwner:(_project,identity)=>identityOwners.get(identity),localIdOwner:(conversation,id)=>localOwners.get(conversation+'\0'+id),publishedFileCount:{get:id=>publishedCounts.get(id)},publishedFile:{has:(dataset,file)=>published.has(dataset+'\0'+file)}}
 useRelationships(context,index)
 const media=packageMediaIndex(run.source_project_id,records.get('media')?.values()??[],new Set(manifest.objects.map(object=>object.key)),context)
 // Previously imported file doors remain available without loading old archives.
 if(keys.size){const prior=await jsonRows<{row_json:string}>(env.DB,"SELECT row_json FROM legacy_import_context WHERE run_id=? AND kind='media_lookup' AND source_table='media' AND parent_id IN (SELECT value FROM json_each(?))",[run.id,JSON.stringify([...keys])],['row_json'],250,(limits.closureBytes-bytes)/4);if(prior.results.length>250)refuse('row_too_large');for(const row of prior.results){const file=JSON.parse(row.row_json);if(!media.files.has(file.legacyKey))media.files.set(file.legacyKey,file.file)}}
 if(table==='messages'&&sourceRows.some(row=>!index.find('conversations',row.conversation_id)))refuse('invalid_scope',422)
 return {context,media,bytes}
}
