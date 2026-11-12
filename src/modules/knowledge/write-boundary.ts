import {guardKnowledgeWrite,textBindingIndexes} from './write-bindings'
import type {Env} from '../../platform/env'
import {canonicaliseFields,planCanonicaliseFields,ticketCustody} from './canonicaliser'
import {knowledgeWords} from './words'

export interface KnowledgeWriteScope {projectId?:string;authorContactId?:string;conversationId?:string}
const boundaries=new WeakSet<object>()
const underlying=new WeakMap<object,D1Database>()
type PlannedTarget={table:string;row:Record<string,unknown>;key:string[]}
/** This capability carries exact planned target values, not a native-table exemption. */
export async function planLegacyKnowledgeTargets(env:Env,projectId:string,targets:PlannedTarget[]){
 const base={...env,DB:underlying.get(env.DB)??env.DB}
 const sourceTables=new Set(['knowledge_articles','knowledge_categories','knowledge_article_categories','knowledge_documents','knowledge_datasets','knowledge_versions','projects','users','memberships','project_settings','brands'])
 const normalized=targets.map(target=>({...target,row:{...target.row}})),statements:D1PreparedStatement[]=[],groups=new Map<string,{indices:number[];values:Record<string,unknown>[]}>()
 for(let index=0;index<targets.length;index++){
  const target=targets[index];if(sourceTables.has(target.table))continue
  const literal=['messages','conversation_notes'].includes(target.table),input=literal?{...target.row,content:undefined}:target.row,custody=target.row.conversation_id?ticketCustody(String(target.row.conversation_id)):''
  const group=groups.get(custody)??{indices:[],values:[]};group.indices.push(index);group.values.push(input);groups.set(custody,group)
 }
 for(const [custody,group] of groups){
  const plan=await planCanonicaliseFields(base,projectId,group.values,{custody:custody||undefined})
  group.indices.forEach((index,at)=>{const target=targets[index],literal=['messages','conversation_notes'].includes(target.table);normalized[index].row=literal?{...plan.value[at],content:target.row.content}:plan.value[at]});statements.push(...plan.statements)
 }
 if(statements.length>120)throw new Error('KNOWLEDGE_PLAN_TOO_LARGE')
 return {targets:normalized,statements,env:plannedEnvironment(base,()=>({projectId}),normalized)}
}
// Only the core's exact INSERT/UPDATE shapes and planned row values are admitted.
// Everything else still takes the ordinary native boundary.
function plannedTarget(sql:string,values:unknown[],targets:PlannedTarget[]){
 const insert=sql.match(/^INSERT INTO "([a-z_]+)" \(([^)]+)\) SELECT /i)
 if(insert&&values.length===1&&typeof values[0]==='string'){
  const names=insert[2].split(',').map(name=>name.replaceAll('"','')),wanted=targets.filter(row=>row.table===insert[1]).map(({row})=>JSON.stringify(names.map(name=>row[name])))
  let rows:unknown;try{rows=JSON.parse(values[0])}catch{return false}
  return Array.isArray(rows)&&rows.length>0&&rows.every(row=>wanted.includes(JSON.stringify(row)))
 }
 const update=sql.match(/^UPDATE "([a-z_]+)" SET (.+) WHERE (.+)$/i)
 if(update&&values.length===1&&typeof values[0]==='string'){
  const names=[...update[2].matchAll(/"([a-z_]+)"=/g),...update[3].matchAll(/"([a-z_]+)"=/g)].map(match=>match[1])
  return targets.some(target=>target.table===update[1]&&JSON.stringify(names.map(name=>target.row[name]))===values[0])
 }
 return false
}
/** Source bytes and the author's own help templates stay in their owning stores.
 * Every other D1 writer, including SQL/JSON content movers, uses this boundary.
 * The guard and write share a transaction: a concurrent source edit cannot land
 * between index observation and storing newly unrecognized copied text. */
export function knowledgeWriteEnvironment(env:Env,scope:()=>KnowledgeWriteScope):Env{return plannedEnvironment(env,scope)}
function plannedEnvironment(env:Env,scope:()=>KnowledgeWriteScope,targets?:PlannedTarget[]):Env{
 if(boundaries.has(env.DB)&&!targets)return env
 const original=env.DB,statements=new WeakMap<object,{sql:string;values:unknown[]}>()
 const candidate=(value:unknown):boolean=>{if(typeof value==='string'){if(/^[\[{]/.test(value)){try{return candidate(JSON.parse(value))}catch{}}return knowledgeWords(value).length>=12}if(Array.isArray(value))return value.some(candidate);if(value&&typeof value==='object')return Object.entries(value).some(([key,item])=>candidate(key)||candidate(item));return false}
 const mutation=(sql:string)=>/^\s*(?:INSERT|UPDATE|REPLACE|WITH)\b/i.test(sql)&&/\b(?:INSERT|UPDATE|REPLACE)\b/i.test(sql)
 // Import-kit custody is private, hash-bound source material. Rewriting its
 // plans/journals would invalidate erasure and reversal fingerprints; native
 // text targets still pass through this boundary and ordinary read guards.
 const source=(sql:string)=>{
  // insertJson emits quoted identifiers. Recognize one complete target name,
  // then match the existing source inventory plus the legacy hash-bound stores.
  const target=sql.match(/^\s*(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|REPLACE\s+INTO|UPDATE)\s+(?:"([a-z][a-z0-9_]*)"|([a-z][a-z0-9_]*))(?=\s|\(|$)/i)
  if(!target)return false
  return /^(?:knowledge_(?:articles|article_history|translations|translation_history|documents|datasets|versions|reply_blocks|generation_sources|translation_publications|article_publications|retired_articles|source_index|shingles|index_dirty|write_guards|canonicalisation_receipts|upgrade_reports|upgrade_progress|upgrade_permits|categories|article_categories|experience)|ik_(?:d1_[a-z_]+|door_[a-z_]+|jobs|sources|provenance|originals|original_sets|stages|batches|targets)|legacy_import_(?:runs|rows|objects|state|holds|marks|conflicts|worker_runs|worker_parts|worker_counts|context|context_messages|context_media|context_identities)|projects|users|memberships|sessions|project_settings|brands)$/i.test(target[1]??target[2])
 }

 async function prepare(sql:string,values:unknown[]){
  if(targets&&plannedTarget(sql,values,targets))return {statement:original.prepare(sql).bind(...values),protected:true}
  if(!mutation(sql)||source(sql)||!values.some(candidate))return {statement:original.prepare(sql).bind(...values),protected:false}
  const stored=textBindingIndexes(sql).indexes.filter(index=>candidate(values[index]))
  if(!stored.length)return {statement:original.prepare(sql).bind(...values),protected:false}
  const {projectId:knownProject,authorContactId,conversationId}=scope()
  const identifiers=JSON.stringify(values.filter(value=>typeof value==='string'&&value.length<201))
  const project=async()=>{
   if(knownProject)return knownProject
   const rows=await original.prepare(`SELECT id project_id FROM projects WHERE id IN (SELECT value FROM json_each(?1)) UNION SELECT project_id FROM conversations WHERE id IN (SELECT value FROM json_each(?1)) UNION SELECT project_id FROM ai_generations WHERE id IN (SELECT value FROM json_each(?1)) UNION SELECT project_id FROM macros WHERE id IN (SELECT value FROM json_each(?1))`).bind(identifiers).all<{project_id:string}>()
   return rows.results.length===1?rows.results[0].project_id:undefined
  }
  // Copied spans belong to the one ticket this statement writes (a ticket, a
  // message or a note it names), otherwise to the request's ticket.
  const custody=async(projectId:string)=>{
   const rows=await original.prepare(`SELECT 'statement' origin,id FROM conversations WHERE project_id=?2 AND id IN (SELECT value FROM json_each(?1)) UNION SELECT 'statement',conversation_id FROM messages WHERE project_id=?2 AND id IN (SELECT value FROM json_each(?1)) UNION SELECT 'statement',note.conversation_id FROM conversation_notes note JOIN conversations ticket ON ticket.id=note.conversation_id AND ticket.project_id=?2 WHERE note.id IN (SELECT value FROM json_each(?1)) UNION SELECT 'request',id FROM conversations WHERE project_id=?2 AND id=?3`).bind(identifiers,projectId,conversationId??null).all<{origin:string;id:string}>()
   const named=rows.results.filter(row=>row.origin==='statement'),ticket=named.length===1?named[0].id:rows.results.find(row=>row.origin==='request')?.id
   return ticket?ticketCustody(ticket):undefined
  }
  const normalized=[...values],text=await canonicaliseFields({...env,DB:original},project,stored.map(index=>values[index]),authorContactId,false,custody)
  stored.forEach((index,at)=>{normalized[index]=text[at]})
  return {statement:original.prepare(guardKnowledgeWrite(sql)).bind(...normalized),protected:true}
 }
 async function execute(sql:string,values:unknown[],method:'run'|'all'|'first'|'raw',args:any[]){
  const prepared=await prepare(sql,values)
  return (prepared.statement[method] as any)(...args)
 }
 function wrap(sql:string,values:unknown[]=[]):D1PreparedStatement{
  const result={bind(...params:unknown[]){return wrap(sql,params)},run(){return execute(sql,values,'run',[])},all(){return execute(sql,values,'all',[])},first(...args:any[]){return execute(sql,values,'first',args)},raw(...args:any[]){return execute(sql,values,'raw',args)}} as D1PreparedStatement
  statements.set(result,{sql,values});return result
 }
 const database={[Symbol.for('happytohelp.d1.layer')]:(instrument:(db:D1Database)=>D1Database)=>plannedEnvironment({...env,DB:instrument(original)},scope,targets).DB,prepare:wrap,async batch(batch:D1PreparedStatement[]){
  const prepared=[]
  for(const statement of batch){const description=statements.get(statement);prepared.push(description?await prepare(description.sql,description.values):{statement,protected:false})}
  return original.batch(prepared.map(row=>row.statement))
 },exec:(...args:any[])=>original.exec(...args as [string]),dump:()=>original.dump()} as unknown as D1Database
 underlying.set(database,original)
 boundaries.add(database)
 return {...env,DB:database}
}
