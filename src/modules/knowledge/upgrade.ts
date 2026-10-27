import type {Env} from '../../platform/env'
import {canonicaliseFields,updateKnowledgeIndex} from './canonicaliser'
import {hashToken} from '../../platform/auth'
import {boundedDatabase} from '../../platform/d1-budget'
import {claimUpgrade,releaseUpgrade,completeUpgrade,type UpgradeProgress} from './upgrade-progress'

/** Source bytes and original help templates retain their owning representation. */
const excluded=/^(?:sqlite_|_cf_|d1_|knowledge_(?:articles$|article_history$|article_publications$|retired_articles$|translations$|translation_history$|translation_publications$|documents$|datasets$|versions$|reply_blocks$|generation_sources$|source_index$|shingles$|index_dirty$|write_guards$|canonicalisation_receipts$|upgrade_reports$|upgrade_progress$|upgrade_permits$|categories$|article_categories$|experience$|help_|collection_entitlements$|company_entitlements$|read_receipts$)|.*_search(?:_|$)|.*_fts(?:_|$)|move_in_(?:original|source|attachment_bytes)|migration|audit_|sessions$|users$|projects$|memberships$|project_settings$|company_domains$|integration_tokens$|api_credentials$)/
interface Column {name:string;type:string;pk:number}
interface Table {name:string;columns:Column[];foreignKeys:{from:string;table:string;to:string}[]}
const identifier=(value:string)=>'"'+value.replaceAll('"','""')+'"'

/** Real D1 permits direct PRAGMA statements, but not table-valued pragma
 * functions. Discover at most 24 tables per quantum and persist their metadata.
 * A cursor of -1 means discovery is complete; later row steps reuse the cache. */
async function discoverUpgradeSchema(env:Env,progress:UpgradeProgress){
 if(progress.schema_cursor<0)return true
 const names=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%' ORDER BY name LIMIT 24 OFFSET ?").bind(progress.schema_cursor).all<{name:string}>()
 const selected=names.results.filter(row=>/^[a-z_0-9]+$/i.test(row.name)),cached=JSON.parse(progress.schema_json) as Table[]
 if(selected.length){
  const results=await env.DB.batch(selected.flatMap(({name})=>[env.DB.prepare(`PRAGMA table_info(${identifier(name)})`),env.DB.prepare(`PRAGMA foreign_key_list(${identifier(name)})`)]))
  for(const [index,{name}] of selected.entries())cached.push({name,columns:(results[index*2].results as unknown as Column[]).map(column=>({name:column.name,type:column.type,pk:column.pk})).sort((a,b)=>a.name.localeCompare(b.name)),foreignKeys:(results[index*2+1].results as any[]).map(foreign=>({from:foreign.from,table:foreign.table,to:foreign.to}))})
 }
 progress.schema_cursor=names.results.length<24?-1:progress.schema_cursor+names.results.length
 progress.schema_json=JSON.stringify(cached)
 await env.DB.prepare('UPDATE knowledge_upgrade_progress SET schema_json=?,schema_cursor=?,updated_at=? WHERE project_id=? AND lease_token=?').bind(progress.schema_json,progress.schema_cursor,Date.now(),progress.project_id,progress.lease_token).run()
 return false
}

function upgradeTables(progress:UpgradeProgress){
 const tables=new Map<string,Table>((JSON.parse(progress.schema_json) as Table[]).map(table=>[table.name,table]))
 const scope=(table:Table,seen=new Set<string>()):string|null=>{
  if(seen.has(table.name)||seen.size>=5)return null
  seen=new Set([...seen,table.name]);const has=(key:string)=>table.columns.some(column=>column.name===key)
  if(has('project_id'))return 'project_id=?1'
  const known:Record<string,string>={conversation_id:'conversations',generation_id:'ai_generations',macro_id:'macros',rule_id:'workflow_rules'}
  for(const [column,parent] of Object.entries(known))if(has(column)&&tables.get(parent)?.columns.some(c=>c.name==='project_id'))return `${identifier(column)} IN (SELECT id FROM ${identifier(parent)} WHERE project_id=?1)`
  for(const foreign of table.foreignKeys){const parent=tables.get(foreign.table);if(!parent||!foreign.to)continue;const parentScope=scope(parent,seen);if(parentScope)return `${identifier(foreign.from)} IN (SELECT ${identifier(foreign.to)} FROM ${identifier(parent.name)} WHERE ${parentScope})`}
  return null
 }
 return [...tables.values()].filter(table=>!excluded.test(table.name)&&/^[a-z_0-9]+$/i.test(table.name)&&table.columns.some(c=>/TEXT/i.test(c.type))&&table.columns.some(c=>c.pk)).flatMap(table=>{const owned=scope(table);return owned?[{...table,scope:owned}]:[]})
}

/** The lease, receipt and cursor make retries representation-preserving. A
 * failed compare-and-write cannot claim a receipt or advance past that row. */
export async function canonicaliseExistingProject(originalEnv:Env,projectId:string){
 const meter=boundedDatabase(originalEnv.DB,650,60),env={...originalEnv,DB:meter.database}
 const progress=await claimUpgrade(env,projectId)
 if(!progress)return {complete:false,rows:0,changed:0}
 try{
  if(await updateKnowledgeIndex(env,projectId,100)===false){await releaseUpgrade(env,progress,'indexing');return {complete:false,rows:progress.canonicalised_rows,changed:progress.changed_rows}}
  if(!await discoverUpgradeSchema(env,progress)){await releaseUpgrade(env,progress,'discovering');return {complete:false,rows:progress.canonicalised_rows,changed:progress.changed_rows}}
  const tables=upgradeTables(progress)
  let index=progress.table_name?tables.findIndex(table=>table.name>=progress.table_name):0
  if(index<0)index=tables.length
  let scanned=0,visited=0,deferred=false
  while(index<tables.length&&scanned<20&&visited<24&&meter.statements<400){
   const table=tables[index],name=identifier(table.name),text=table.columns.filter(c=>/TEXT/i.test(c.type)).map(c=>c.name),keys=table.columns.filter(c=>c.pk).sort((a,b)=>a.pk-b.pk).map(c=>c.name)
   const requested=20-scanned,cursor=table.name===progress.table_name?progress.row_key:'',rowKeySql=`json_array(${keys.map(identifier).join(',')})`
   const values=await env.DB.prepare(`SELECT *,${rowKeySql} AS __knowledge_upgrade_key FROM ${name} WHERE (${table.scope}) AND (?2='' OR ${rowKeySql}>?2) ORDER BY ${rowKeySql} LIMIT ?3`).bind(projectId,cursor,requested).all<Record<string,unknown>>()
   visited++
   for(const row of values.results){
    if(meter.statements>=400){deferred=true;break}
    const rowKey=String(row.__knowledge_upgrade_key),fingerprint=await hashToken(JSON.stringify(text.map(key=>row[key])))
    const receipt=await env.DB.prepare('SELECT fingerprint FROM knowledge_canonicalisation_receipts WHERE project_id=? AND table_name=? AND row_key=?').bind(projectId,table.name,rowKey).first<{fingerprint:string}>()
    let normalized:Record<string,unknown>=Object.fromEntries(text.map(key=>[key,row[key]])),altered:string[]=[]
    if(receipt?.fingerprint!==fingerprint){const author=row.actor_role==='contact'?String(row.actor_id):undefined;normalized=await canonicaliseFields(env,projectId,normalized,author);altered=text.filter(key=>normalized[key]!==row[key])}
    const after=await hashToken(JSON.stringify(text.map(key=>normalized[key]))),statements:D1PreparedStatement[]=[]
    const permit=altered.length&&['workflow_rule_versions','outbound_notice_commands'].includes(table.name)
    if(permit)statements.push(env.DB.prepare('INSERT OR REPLACE INTO knowledge_upgrade_permits VALUES(?,?,?)').bind(projectId,table.name,rowKey))
    if(altered.length)statements.push(env.DB.prepare(`UPDATE ${name} SET ${altered.map(key=>`${identifier(key)}=?`).join(',')} WHERE ${keys.map(key=>`${identifier(key)} IS ?`).join(' AND ')} AND json_array(${text.map(identifier).join(',')})=?`).bind(...altered.map(key=>normalized[key]),...keys.map(key=>row[key]),JSON.stringify(text.map(key=>row[key]))))
    if(permit)statements.push(env.DB.prepare('DELETE FROM knowledge_upgrade_permits WHERE project_id=? AND table_name=? AND row_key=?').bind(projectId,table.name,rowKey))
    const current=`EXISTS(SELECT 1 FROM ${name} WHERE json_array(${[...keys,...text].map(identifier).join(',')})=?)`,currentValues=[JSON.stringify([...keys,...text].map(key=>key in normalized?normalized[key]:row[key]))]
    statements.push(env.DB.prepare(`INSERT OR REPLACE INTO knowledge_canonicalisation_receipts(project_id,table_name,row_key,fingerprint,canonicalised_at) SELECT ?,?,?,?,? WHERE ${current}`).bind(projectId,table.name,rowKey,after,Date.now(),...currentValues))
    statements.push(env.DB.prepare(`UPDATE knowledge_upgrade_progress SET table_name=?,row_key=?,canonicalised_rows=canonicalised_rows+1,changed_rows=changed_rows+?,updated_at=? WHERE project_id=? AND lease_token=? AND ${current}`).bind(table.name,rowKey,altered.length?1:0,Date.now(),projectId,progress.lease_token,...currentValues))
    const committed=await env.DB.batch(statements)
    if(!committed.at(-1)?.meta.changes){deferred=true;break}
    progress.table_name=table.name;progress.row_key=rowKey;progress.canonicalised_rows++;if(altered.length)progress.changed_rows++;scanned++
   }
   if(deferred||scanned>=20)break
   if(values.results.length<requested){
    index++;progress.table_name=tables[index]?.name||'~';progress.row_key=''
    await env.DB.prepare('UPDATE knowledge_upgrade_progress SET table_name=?,row_key=?,updated_at=? WHERE project_id=? AND lease_token=?').bind(progress.table_name,'',Date.now(),projectId,progress.lease_token).run()
   }
  }
  const complete=index>=tables.length&&!deferred
  if(complete)await completeUpgrade(env,progress);else await releaseUpgrade(env,progress,'pending')
  return {complete,rows:progress.canonicalised_rows,changed:progress.changed_rows}
 }catch(error){
  // Bounded index refresh or a large row can consume this quantum. Its cursor
  // stays put, while already committed rows and receipts remain durable.
  if(!['WORKER_D1_STATEMENT_LIMIT','KNOWLEDGE_INDEX_NOT_READY'].includes((error as Error).message)){await releaseUpgrade(env,progress,'failed');throw error}
  await releaseUpgrade(env,progress,'pending')
  return {complete:false,rows:progress.canonicalised_rows,changed:progress.changed_rows}
 }
}
