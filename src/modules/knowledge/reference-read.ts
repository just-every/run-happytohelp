import type {Env} from '../../platform/env'
import type {KnowledgeBlock} from './reference-store'
import {anonymousReaders,literal,type Readers} from './door'
import {referenceAdmissionPolicy,sourceOccurrenceVisibleSql} from './reference-policy'

type VisibleBlock=KnowledgeBlock&{visible:number}
export interface ReferenceReadScope {
 rows(ids:string[],readers:Readers,nonempty?:boolean):Promise<VisibleBlock[]>
 articleBlocks(ids:string[]):Promise<string[]>
}

/** One read projection only. A currently published document is a reader-independent
 * visible choice for a copy; every other decision remains with the full policy. */
class ScopedReferenceRead implements ReferenceReadScope {
 private blocks=new Map<string,KnowledgeBlock|null>()
 private loads=new Map<string,Promise<void>>()
 private documentProofs=new Map<string,Promise<boolean>>()
 private provenCopies=new Set<string>()
 private directArticleCandidates=new Set<string>()
 private generationArticles=new Map<string,Promise<boolean>>()
 private readerPresence=new Map<string,Promise<boolean>>()
 private policyReads=new Map<string,Promise<Map<string,number>>>()

 constructor(private env:Env,private projectId:string){}

 async load(ids:string[]):Promise<void>{
  const missing=[...new Set(ids)].filter(id=>!this.loads.has(id)&&!this.blocks.has(id))
  if(missing.length){
   const pending=this.fetch(missing)
   for(const id of missing)this.loads.set(id,pending)
  }
  await Promise.all([...new Set(ids.map(id=>this.loads.get(id)))])
 }

 private async fetch(ids:string[]):Promise<void>{
  const result=await this.env.DB.prepare('SELECT b.* FROM json_each(?1) requested CROSS JOIN knowledge_reply_blocks b ON b.id=requested.value AND b.project_id=?2 ORDER BY CAST(requested.key AS INTEGER)').bind(JSON.stringify(ids),this.projectId).all<KnowledgeBlock>()
  const candidates=new Map<string,string>()
  for(const block of result.results){
   // Unknown source representations remain candidates for the SQL source lookup.
   this.directArticleCandidates.add(block.id)
   // JSON5/JSONB accepted by SQLite but not JSON.parse stays on the full policy.
   let sources:unknown
   try{sources=JSON.parse(block.sources_json)}catch{continue}
   if(!Array.isArray(sources))continue
   if(!sources.some((source:unknown)=>typeof source==='string'&&source.startsWith('article:')))this.directArticleCandidates.delete(block.id)
   if(block.kind!=='copy')continue
   const first=sources.find((source:unknown)=>typeof source==='string'&&source.startsWith('knowledge:'))
   if(typeof first==='string')candidates.set(block.id,first)
  }
  const generations=[...new Set(result.results.flatMap(block=>block.generation_id===null?[]:[block.generation_id]))]
  await Promise.all([this.proveDocuments([...new Set(candidates.values())]),this.findGenerationArticles(generations)])
  for(const [id,source] of candidates)if(await this.documentProofs.get(source))this.provenCopies.add(id)
  // A missing or foreign block is remembered as missing for this projection.
  for(const id of ids)this.blocks.set(id,null)
  for(const block of result.results)this.blocks.set(block.id,block)
 }

 private async findGenerationArticles(generations:string[]):Promise<void>{
  const missing=generations.filter(id=>!this.generationArticles.has(id))
  if(missing.length){
   const query=this.env.DB.prepare("SELECT generation.value generation_id,EXISTS(SELECT 1 FROM knowledge_generation_sources gs WHERE gs.project_id=?2 AND gs.generation_id=generation.value AND gs.source_id>='article:' AND gs.source_id<'article;') has_articles FROM json_each(?1) generation").bind(JSON.stringify(missing),this.projectId).all<{generation_id:string;has_articles:number}>()
   for(const id of missing)this.generationArticles.set(id,query.then(result=>result.results.some(row=>row.generation_id===id&&!!row.has_articles)))
  }
  await Promise.all(generations.map(id=>this.generationArticles.get(id)))
 }

 private async proveDocuments(sources:string[]):Promise<void>{
  const missing=sources.filter(source=>!this.documentProofs.has(source))
  if(missing.length){
   const proof=sourceOccurrenceVisibleSql('source.value',literal(this.projectId),anonymousReaders)
   const query=this.env.DB.prepare('SELECT source.value source_id,'+proof+' visible FROM json_each(?) source').bind(JSON.stringify(missing)).all<{source_id:string;visible:number}>()
   for(const source of missing)this.documentProofs.set(source,query.then(result=>result.results.some(row=>row.source_id===source&&!!row.visible)))
  }
  await Promise.all(sources.map(source=>this.documentProofs.get(source)))
 }

 private hasReaders(readers:Readers):Promise<boolean>{
  let pending=this.readerPresence.get(readers.sql)
  if(!pending){
   pending=this.env.DB.prepare('SELECT 1 FROM ('+readers.sql+') LIMIT 1').first().then(row=>row!==null)
   this.readerPresence.set(readers.sql,pending)
  }
  return pending
 }

 private policyRows(ids:string[],readers:Readers):Promise<Map<string,number>>{
  const key=JSON.stringify([ids,readers.sql])
  let pending=this.policyReads.get(key)
  if(!pending){
   const policy=referenceAdmissionPolicy(ids,literal(this.projectId),readers)
   pending=this.env.DB.prepare(policy.prefix+'SELECT b.id,v.id IS NOT NULL visible FROM selected b LEFT JOIN visible_blocks v ON v.id=b.id').bind(...policy.params).all<{id:string;visible:number}>().then(result=>new Map(result.results.map(row=>[row.id,row.visible])))
   this.policyReads.set(key,pending)
  }
  return pending
 }

 async rows(ids:string[],readers:Readers,nonempty?:boolean):Promise<VisibleBlock[]>{
  if(!ids.length)return []
  await this.load(ids)
  const blocks=ids.flatMap(id=>{const block=this.blocks.get(id);return block?[block]:[]})
  const shortcut=blocks.some(block=>this.provenCopies.has(block.id))&&(nonempty===true||await this.hasReaders(readers))
  const unresolved=blocks.filter(block=>!shortcut||!this.provenCopies.has(block.id)).map(block=>block.id)
  const visibility=unresolved.length?await this.policyRows(unresolved,readers):new Map<string,number>()
  return blocks.map(block=>({...block,visible:shortcut&&this.provenCopies.has(block.id)?1:visibility.get(block.id)??0}))
 }

 async articleBlocks(ids:string[]):Promise<string[]>{
  await this.load(ids)
  const candidates:string[]=[]
  for(const id of ids){
   const block=this.blocks.get(id)
   if(block&&(this.directArticleCandidates.has(id)||block.generation_id!==null&&await this.generationArticles.get(block.generation_id)))candidates.push(id)
  }
  return candidates
 }
}

/** Prefetch the ids found in the projection; nested references load on demand. */
export async function createReferenceReadScope(env:Env,projectId:string,ids:string[]):Promise<ReferenceReadScope>{
 const scope=new ScopedReferenceRead(env,projectId)
 await scope.load(ids)
 return scope
}
