import {getKnowledgeExperience} from './experience'
import {visibleArticleSql,activeProjectSql,type Readers} from './door'
import type {Env} from '../../platform/env'
import {isProjectActive} from '../../platform/project-status.ts'

export interface PublicReference {id:string;sourceVersion:string}
export interface PublicCitation extends PublicReference {title:string;url:string;locale?:string;requestedLocale?:string;localeFallback?:boolean}
export const activeSourceProjectSql=(project:string)=>activeProjectSql(project)
export function safePublicUrl(value:unknown):string|null{
 if(typeof value!=='string'||/[\u0000-\u0020\u007f]/.test(value))return null
 try{const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?value:null}catch{return null}
}
export function articleCanonicalUrl(env:Env,projectId:string,slug:string){
 const origin=safePublicUrl(env.APP_ORIGIN)
 if(!origin)throw new Error('APP_ORIGIN_REQUIRED: native article citations need the application origin')
 return new URL(`/help/${encodeURIComponent(projectId)}/${encodeURIComponent(slug)}`,new URL(origin).origin).href
}
/** A continuation may only read the publication identity originally issued by search. */
export async function readKnowledgeSource(env:Env,projectId:string,ref:PublicReference,readers:Readers){
 if(!await isProjectActive(env,projectId))return null
 if(ref.id.startsWith('article:')){
  const id=ref.id.slice(8),[base,requestedLocale,translation,defaultLocale]=ref.sourceVersion.split('~')
  const row=await env.DB.prepare(`SELECT json_extract(snapshot.snapshot_json,'$.title') title,json_extract(snapshot.snapshot_json,'$.slug') slug,json_extract(snapshot.snapshot_json,'$.content') content,a.publication_version currentVersion,snapshot.source_version sourceVersion FROM knowledge_article_publications snapshot JOIN knowledge_articles a ON a.id=snapshot.article_id AND a.project_id=snapshot.project_id WHERE snapshot.article_id=? AND snapshot.project_id=? AND snapshot.source_version=? AND ${visibleArticleSql('a',readers)}`).bind(id,projectId,base).first<any>()
  if(!row)return null
  if(!requestedLocale)return {...row,id:ref.id,url:articleCanonicalUrl(env,projectId,row.slug)}
  const settings=await getKnowledgeExperience(env,projectId)
  if(row.currentVersion!==base||!settings.locales.includes(requestedLocale)||defaultLocale!==settings.defaultLocale)return null
  const translated=requestedLocale!==settings.defaultLocale?await env.DB.prepare('SELECT published_json,publication_version FROM knowledge_translations WHERE article_id=? AND locale=? AND published_source_version=? AND published_json IS NOT NULL').bind(id,requestedLocale,base).first<any>():null
  if((translated?.publication_version||'base')!==translation)return null
  const locale=translated?requestedLocale:settings.defaultLocale,url=new URL(articleCanonicalUrl(env,projectId,row.slug));url.searchParams.set('locale',requestedLocale)
  return {...row,...(translated?JSON.parse(translated.published_json):{}),id:ref.id,sourceVersion:ref.sourceVersion,url:url.href,locale,requestedLocale,localeFallback:locale!==requestedLocale}
 }
 if(!ref.id.startsWith('knowledge:'))return null
 const row=await env.DB.prepare(`SELECT original.title,original.url,original.content,original.version_id sourceVersion FROM knowledge_documents original JOIN knowledge_versions version ON version.id=original.version_id JOIN knowledge_datasets d ON d.id=version.dataset_id WHERE original.id=? AND d.project_id=? AND original.version_id=? AND EXISTS(SELECT 1 FROM knowledge_versions current_version JOIN knowledge_documents current ON current.version_id=current_version.id WHERE current_version.id=d.published_version AND current_version.dataset_id=d.id AND current.url=original.url) AND ${activeSourceProjectSql('d.project_id')}`).bind(ref.id.slice(10),projectId,ref.sourceVersion).first<any>()
 return row?{...row,id:ref.id}:null
}
export async function resolvePublicCitations(env:Env,projectId:string,generationId:string,refs:PublicReference[],readers:Readers):Promise<PublicCitation[]>{
 if(!Array.isArray(refs)||refs.length>10)throw new Error('Invalid public citations')
 const citations:PublicCitation[]=[]
 for(const ref of refs){
  if(!ref||typeof ref.id!=='string'||typeof ref.sourceVersion!=='string')throw new Error('Invalid public citation reference')
  if(!await env.DB.prepare('SELECT 1 FROM ai_generation_sources WHERE generation_id=? AND project_id=? AND source_id=? AND source_version=?').bind(generationId,projectId,ref.id,ref.sourceVersion).first())throw new Error('Unissued public citation')
  const row=await readKnowledgeSource(env,projectId,ref,readers),url=safePublicUrl(row?.url)
  if(!row||!url)throw new Error('Stale or unsafe public citation')
  if(!citations.some(c=>c.id===ref.id))citations.push({id:ref.id,sourceVersion:ref.sourceVersion,title:row.title,url,...(row.requestedLocale?{locale:row.locale,requestedLocale:row.requestedLocale,localeFallback:row.localeFallback}:{})})
 }
 return citations
}
/** Used inside the single INSERT SELECT, after server resolution and before commit. */
export function citationAdmissionGuard(ref:PublicCitation,readers:Readers){
 if(ref.id.startsWith('article:'))return {sql:`EXISTS(SELECT 1 FROM knowledge_articles a WHERE a.id=? AND a.project_id=c.project_id AND ${visibleArticleSql('a',readers)})`,args:[ref.id.slice(8)]}
 return {sql:`EXISTS(SELECT 1 FROM knowledge_documents original JOIN knowledge_versions version ON version.id=original.version_id JOIN knowledge_datasets d ON d.id=version.dataset_id WHERE original.id=? AND d.project_id=c.project_id AND original.version_id=? AND original.title=? AND original.url=? AND EXISTS(SELECT 1 FROM knowledge_versions current_version JOIN knowledge_documents current ON current.version_id=current_version.id WHERE current_version.id=d.published_version AND current_version.dataset_id=d.id AND current.url=original.url) AND ${activeSourceProjectSql('d.project_id')})`,args:[ref.id.slice(10),ref.sourceVersion,ref.title,ref.url]}
}

export async function knowledgeCatalog(env:Env,projectId:string,readers:Readers){
 const rows=await env.DB.prepare(`SELECT f.id,f.url,f.title FROM knowledge_documents f JOIN knowledge_datasets d ON d.published_version=f.version_id WHERE d.project_id=? AND ${activeProjectSql('d.project_id')} LIMIT 12`).bind(projectId).all<any>();return rows.results.map(row=>({...row,markdown:''}))
}


export function articlePublicationSql(alias='a',version='issued.source_version'){return `(${alias}.publication_version=${version} OR EXISTS(SELECT 1 FROM knowledge_experience ke,json_each(ke.locales_json) locale WHERE ke.project_id=${alias}.project_id AND ((EXISTS(SELECT 1 FROM knowledge_translations t WHERE t.article_id=${alias}.id AND t.locale=locale.value AND t.published_source_version=${alias}.publication_version AND t.published_json IS NOT NULL AND ${alias}.publication_version||'~'||t.locale||'~'||t.publication_version||'~'||ke.default_locale=${version})) OR (${alias}.publication_version||'~'||locale.value||'~base~'||ke.default_locale=${version} AND NOT EXISTS(SELECT 1 FROM knowledge_translations t WHERE t.article_id=${alias}.id AND t.locale=locale.value AND t.locale<>ke.default_locale AND t.published_source_version=${alias}.publication_version AND t.published_json IS NOT NULL)))))`}
/** Locale-specific evidence retains main's exact publication and configuration
 * fence, including uncited sources. Ordinary source-language snapshots can pin edits. */
export function translatedSourcesAdmissionGuard(generationId:string){
 return {sql:`NOT EXISTS(SELECT 1 FROM ai_generation_sources issued WHERE issued.generation_id=? AND issued.project_id=c.project_id AND instr(issued.source_version,'~')>0 AND NOT EXISTS(SELECT 1 FROM knowledge_articles a WHERE 'article:'||a.id=issued.source_id AND a.project_id=c.project_id AND ${articlePublicationSql()}))`,args:[generationId]}
}
