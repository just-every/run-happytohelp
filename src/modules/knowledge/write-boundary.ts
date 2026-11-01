import {guardKnowledgeWrite,textBindingIndexes} from './write-bindings'
import type {Env} from '../../platform/env'
import {canonicaliseFields} from './canonicaliser'
import {knowledgeWords} from './words'

export interface KnowledgeWriteScope {projectId?:string;authorContactId?:string}
const boundaries=new WeakSet<object>()
/** Source bytes and the author's own help templates stay in their owning stores.
 * Every other D1 writer, including SQL/JSON content movers, uses this boundary.
 * The guard and write share a transaction: a concurrent source edit cannot land
 * between index observation and storing newly unrecognized copied text. */
export function knowledgeWriteEnvironment(env:Env,scope:()=>KnowledgeWriteScope):Env{
 if(boundaries.has(env.DB))return env
 const original=env.DB,statements=new WeakMap<object,{sql:string;values:unknown[]}>()
 const candidate=(value:unknown):boolean=>{if(typeof value==='string'){if(/^[\[{]/.test(value)){try{return candidate(JSON.parse(value))}catch{}}return knowledgeWords(value).length>=12}if(Array.isArray(value))return value.some(candidate);if(value&&typeof value==='object')return Object.entries(value).some(([key,item])=>candidate(key)||candidate(item));return false}
 const mutation=(sql:string)=>/^\s*(?:INSERT|UPDATE|REPLACE|WITH)\b/i.test(sql)&&/\b(?:INSERT|UPDATE|REPLACE)\b/i.test(sql)
 const source=(sql:string)=>/^\s*(?:INSERT(?:\s+OR\s+\w+)?\s+INTO|REPLACE\s+INTO|UPDATE)\s+(?:knowledge_(?:articles|article_history|translations|translation_history|documents|datasets|versions|reply_blocks|generation_sources|translation_publications|article_publications|retired_articles|source_index|shingles|index_dirty|write_guards|canonicalisation_receipts|upgrade_reports|upgrade_progress|upgrade_permits|categories|article_categories|experience)|projects|users|memberships|sessions|project_settings|brands)\b/i.test(sql)
 async function prepare(sql:string,values:unknown[]){
  if(!mutation(sql)||source(sql)||!values.some(candidate))return {statement:original.prepare(sql).bind(...values),protected:false}
  const stored=textBindingIndexes(sql).indexes.filter(index=>candidate(values[index]))
  if(!stored.length)return {statement:original.prepare(sql).bind(...values),protected:false}
  const {projectId:knownProject,authorContactId}=scope()
  const project=async()=>{
   if(knownProject)return knownProject
   const identifiers=JSON.stringify(values.filter(value=>typeof value==='string'&&value.length<201))
   const rows=await original.prepare(`SELECT id project_id FROM projects WHERE id IN (SELECT value FROM json_each(?1)) UNION SELECT project_id FROM conversations WHERE id IN (SELECT value FROM json_each(?1)) UNION SELECT project_id FROM ai_generations WHERE id IN (SELECT value FROM json_each(?1)) UNION SELECT project_id FROM macros WHERE id IN (SELECT value FROM json_each(?1))`).bind(identifiers).all<{project_id:string}>()
   return rows.results.length===1?rows.results[0].project_id:undefined
  }
  const normalized=[...values],text=await canonicaliseFields({...env,DB:original},project,stored.map(index=>values[index]),authorContactId)
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
 const database={[Symbol.for('happytohelp.d1.layer')]:(instrument:(db:D1Database)=>D1Database)=>knowledgeWriteEnvironment({...env,DB:instrument(original)},scope).DB,prepare:wrap,async batch(batch:D1PreparedStatement[]){
  const prepared=[]
  for(const statement of batch){const description=statements.get(statement);prepared.push(description?await prepare(description.sql,description.values):{statement,protected:false})}
  return original.batch(prepared.map(row=>row.statement))
 },exec:(...args:any[])=>original.exec(...args as [string]),dump:()=>original.dump()} as unknown as D1Database
 boundaries.add(database)
 return {...env,DB:database}
}
