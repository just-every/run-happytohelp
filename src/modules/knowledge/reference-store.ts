import {canonicaliseKnowledge} from './canonicaliser'
import {htmlReference} from './html-reference'
import {modelReferenceLabels} from './model-labels'
import {visibleBlockSql,referenceSetAdmittedSql,referenceAdmissionPolicy} from './reference-policy'
export {visibleBlockSql} from './reference-policy'
import type {Env} from '../../platform/env'
import {literal,type Readers,readerSet,memberReaders} from './door'
import {describeReaders} from './readers'
import {HTTPException} from 'hono/http-exception'
import {observedArticleSourceSql,type ObservedArticleSource} from './source-identity'
export const unavailableKnowledge='[Knowledge unavailable]'
export const tokenPattern=/⟦k:([a-f0-9]{32})⟧/g
export const referenceIds=(text:string)=>[...new Set([...text.matchAll(tokenPattern)].map(match=>match[1]))]
export const referenceToken=(id:string)=>`⟦k:${id}⟧`
export interface KnowledgeBlock {id:string;project_id:string;kind:'text'|'link'|'copy'|'answer';payload_json:string;sources_json:string;generation_id:string|null;author_contact_id:string|null}
interface BlockInput {kind:KnowledgeBlock['kind'];text:string;title?:string;url?:string;sources:string[];sourceIdentities?:ObservedArticleSource[];generationId?:string;authorContactId?:string}
// Existing generation ledgers already retain their article dependencies. Direct
// source reads instead prove the incarnation observed with their source bytes.
const blockSourcesObservedSql=(requested:string)=>`NOT EXISTS(SELECT 1 FROM json_each(json_extract(${requested},'$.sources_json')) source WHERE source.value LIKE 'article:%' AND NOT EXISTS(SELECT 1 FROM json_each(json_extract(${requested},'$.sourceIdentities')) observed WHERE json_extract(observed.value,'$.id')=source.value AND ${observedArticleSourceSql('source.value',"json_extract(observed.value,'$.project')","json_extract(observed.value,'$.incarnation')")}) AND NOT EXISTS(SELECT 1 FROM knowledge_generation_sources generation_source WHERE generation_source.project_id=json_extract(${requested},'$.project_id') AND generation_source.generation_id=json_extract(${requested},'$.generation_id') AND generation_source.source_id=source.value) AND NOT EXISTS(SELECT 1 FROM ai_generation_sources generation_source WHERE generation_source.project_id=json_extract(${requested},'$.project_id') AND generation_source.generation_id=json_extract(${requested},'$.generation_id') AND generation_source.source_id=source.value))`
export async function createBlocks(env:Env,projectId:string,blocks:BlockInput[]){
 // Protect answer bytes before wrapping or indexing them. A permitted retrieved
 // source cannot authorize an unrelated restricted copy in the model output.
 const rows=await Promise.all(blocks.map(async block=>{const text=block.kind==='answer'?await canonicaliseKnowledge(env,projectId,block.text,undefined,false,block.generationId):block.text;const payload_json=JSON.stringify({text,title:block.title,url:block.url}),sources_json=JSON.stringify([...new Set(block.sources)].sort()),generation_id=block.generationId||null,author_contact_id=block.authorContactId||null;
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([block.kind,payload_json,sources_json,generation_id,author_contact_id]))),fingerprint=Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('');
 return {id:crypto.randomUUID().replaceAll('-',''),project_id:projectId,kind:block.kind,payload_json,sources_json,generation_id,author_contact_id,created_at:Date.now(),fingerprint,sourceIdentities:block.sourceIdentities||[]}}))
 if(!rows.length)return []
 const tokens:string[]=[]
 for(let offset=0;offset<rows.length;){
  const page:typeof rows=[];let size=2
  while(offset<rows.length){const item=rows[offset],bytes=new TextEncoder().encode(JSON.stringify(item)).length;if(bytes>1800000)throw new Error('Knowledge reference exceeds storage limit');if(page.length&&size+bytes>1800000)break;page.push(item);size+=bytes+1;offset++}
  const serialized=JSON.stringify(page),result=await env.DB.batch([
   env.DB.prepare(`INSERT OR IGNORE INTO knowledge_reply_blocks SELECT json_extract(requested.value,'$.id'),json_extract(requested.value,'$.project_id'),json_extract(requested.value,'$.kind'),json_extract(requested.value,'$.payload_json'),json_extract(requested.value,'$.sources_json'),json_extract(requested.value,'$.generation_id'),json_extract(requested.value,'$.author_contact_id'),json_extract(requested.value,'$.created_at'),json_extract(requested.value,'$.fingerprint') FROM json_each(?) requested WHERE ${blockSourcesObservedSql('requested.value')}`).bind(serialized),
   env.DB.prepare(`SELECT b.id FROM json_each(?) requested JOIN knowledge_reply_blocks b ON b.project_id=? AND b.fingerprint=json_extract(requested.value,'$.fingerprint') WHERE ${blockSourcesObservedSql('requested.value')} ORDER BY CAST(requested.key AS INTEGER)`).bind(serialized,projectId)])
  if(result[1].results.length!==page.length)throw new HTTPException(409,{message:'Knowledge source identity changed'})
  tokens.push(...result[1].results.map((row:any)=>referenceToken(String(row.id))))
 }
 return tokens
}
export const referencesAdmittedSql=(content:string,project:string,readers:Readers)=>referenceSetAdmittedSql(referenceIds(content),project,readers)
export async function renderKnowledge(env:Env,projectId:string,text:string,readers:Readers,mode:'body'|'model'|'html'='body',seen:ReadonlySet<string>=new Set()):Promise<string>{
 const ids=referenceIds(text);if(!ids.length)return text
 const policy=referenceAdmissionPolicy(ids,literal(projectId),readers)
 const rows=await env.DB.prepare(`${policy.prefix}SELECT block.*,visible.id IS NOT NULL visible FROM selected block LEFT JOIN visible_blocks visible ON visible.id=block.id`).bind(...policy.params).all<KnowledgeBlock&{visible:number}>()
 const labels=mode==='model'?await modelReferenceLabels(env,projectId,rows.results.filter(row=>row.visible).map(row=>row.id),readers):new Map<string,string>()
 const values=new Map<string,string>()
 for(const row of rows.results){
  if(!row.visible||seen.has(row.id)||seen.size>=32){values.set(row.id,unavailableKnowledge);continue}
  const payload=JSON.parse(row.payload_json),value=mode==='model'?(payload.url?`[${payload.title||'Knowledge source'}](${payload.url})`:labels.get(row.id)||'[Knowledge source]'):mode==='html'?htmlReference(row.kind,payload):payload.text
  values.set(row.id,await renderKnowledge(env,projectId,value,readers,mode,new Set([...seen,row.id])))
 }
 return text.replace(tokenPattern,(_token,id)=>values.get(id)??unavailableKnowledge)
}
export async function renderKnowledgeFields<T>(env:Env,projectId:string,value:T,readers:Readers,mode:'body'|'model'|'html'='body'):Promise<T>{
 if(typeof value==='string'){
  // JSON columns are returned as strings by several APIs. Render their values
  // without losing the enclosing JSON representation.
  if(/^[\[{]/.test(value)){let parsed:any;try{parsed=JSON.parse(value)}catch{}if(parsed!==undefined)return JSON.stringify(await renderKnowledgeFields(env,projectId,parsed,readers,mode)) as T}
  return await renderKnowledge(env,projectId,value,readers,mode) as T
 }
 if(Array.isArray(value)){const rendered=await Promise.all(value.map(v=>renderKnowledgeFields(env,projectId,v,readers,mode)));return (value.every(v=>v&&typeof v==='object'&&'knowledge_citation' in v)?rendered.filter(v=>v!==null):rendered) as T}
 if(value&&typeof value==='object'){
  if(typeof (value as any).knowledge_citation==='string'){const rendered=await renderKnowledge(env,projectId,(value as any).knowledge_citation,readers,mode);if(mode==='model')return rendered as T;try{return JSON.parse(rendered) as T}catch{return null as T}}
  const provenance=(value as any).knowledge_provenance
  if(typeof provenance==='string'&&referenceIds(provenance).length){const policy=referenceAdmissionPolicy(referenceIds(provenance),literal(projectId),readers);if(!await env.DB.prepare(`${policy.prefix}SELECT 1 WHERE ${policy.sql}`).bind(...policy.params).first())return withheldResult(value) as T}
  return Object.fromEntries(await Promise.all(Object.entries(value).filter(([key])=>key!=='knowledge_provenance').map(async([key,v])=>[await renderKnowledge(env,projectId,key,readers,mode),await renderKnowledgeFields(env,projectId,v,readers,mode)]))) as T
 }
 return value
}
export async function referenceVisibility(env:Env,projectId:string,text:string,operatorId:string,readers:Readers){
 const ids=referenceIds(text);if(!ids.length)return []
 const policy=referenceAdmissionPolicy(ids,literal(projectId),memberReaders(operatorId))
 const [rows,recipients]=await Promise.all([
  env.DB.prepare(`${policy.prefix}SELECT b.*,v.id IS NOT NULL visible FROM selected b LEFT JOIN visible_blocks v ON v.id=b.id`).bind(...policy.params).all<KnowledgeBlock&{visible:number}>(),
  describeReaders(env,projectId,readers)
 ])
 const visibility=await Promise.all(recipients.map(async recipient=>{const current=referenceAdmissionPolicy(ids,literal(projectId),readerSet([recipient]));return new Set((await env.DB.prepare(`${current.prefix}SELECT id FROM visible_blocks`).bind(...current.params).all<{id:string}>()).results.map(row=>row.id))}))
 const sources=await env.DB.prepare(`SELECT DISTINCT source.block_id,a.id,a.title FROM knowledge_articles a JOIN (SELECT b.id block_id,s.value source_id FROM knowledge_reply_blocks b,json_each(b.sources_json) s WHERE b.project_id=?1 AND b.id IN (SELECT value FROM json_each(?2)) UNION SELECT b.id block_id,gs.source_id FROM knowledge_reply_blocks b JOIN knowledge_generation_sources gs ON gs.project_id=b.project_id AND gs.generation_id=b.generation_id WHERE b.project_id=?1 AND b.id IN (SELECT value FROM json_each(?2))) source ON source.source_id='article:'||a.id WHERE a.project_id=?1`).bind(projectId,JSON.stringify(ids)).all<{block_id:string;id:string;title:string}>()
 // Titles are editor metadata. Previews still obey the current read predicate.
 const {memberAccess}=await import('../access/gate'),access=await memberAccess(env.DB,projectId,operatorId),canName=(id:string)=>access?.base!=='collaborator'&&access?.permissions.has('knowledge.edit')&&(access.knowledgeArticleIds===null||access.knowledgeArticleIds.includes(id))
 return rows.results.map(block=>{
  const payload=block.visible?JSON.parse(block.payload_json):{},articles=sources.results.filter(article=>article.block_id===block.id&&canName(article.id)).map(({id,title})=>({id,title})),states=recipients.map((recipient,index)=>({...recipient,visible:visibility[index].has(block.id),reason:visibility[index].has(block.id)?null:'Current knowledge access required'}))
  return {token:referenceToken(block.id),title:payload.title||articles[0]?.title||'Knowledge',articleId:articles[0]?.id,articles,mode:block.kind,preview:payload.text||unavailableKnowledge,recipients:states,withheld:!block.visible}
 })
}

function withheldResult(value:unknown):unknown{
 if(typeof value==='string')return unavailableKnowledge
 if(Array.isArray(value))return value.map(withheldResult)
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>key!=='knowledge_provenance').map(([key,item])=>[key.replace(tokenPattern,unavailableKnowledge),withheldResult(item)]))
 return value
}
