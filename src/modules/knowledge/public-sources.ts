import {articleAccessSql,accessParams,accessForContact,helpAccessWriteGuard,type HelpAccess} from './access'
import {getKnowledgeExperience} from './experience'
import type {Env} from '../../platform/env'
import {isProjectActive} from '../../platform/project-status.ts'

export interface PublicReference {id:string;sourceVersion:string}
export interface PublicCitation extends PublicReference {title:string;url:string;locale?:string;requestedLocale?:string;localeFallback?:boolean}
const publicationParts=(version:string)=>{const [base,locale,translation,defaultLocale]=version.split('~');return {base,locale,translation,defaultLocale}}
/** The requested locale stays in the reference even on fallback. This prevents a
 * translation arriving or changing mid-turn from silently changing the evidence. */
export function articlePublicationSql(alias='a',version='issued.source_version'){return `(${alias}.publication_version=${version} OR EXISTS(SELECT 1 FROM knowledge_experience ke,json_each(ke.locales_json) locale WHERE ke.project_id=${alias}.project_id AND ((EXISTS(SELECT 1 FROM knowledge_translations t WHERE t.article_id=${alias}.id AND t.locale=locale.value AND t.published_source_version=${alias}.publication_version AND t.published_json IS NOT NULL AND ${alias}.publication_version||'~'||t.locale||'~'||t.publication_version||'~'||ke.default_locale=${version})) OR (${alias}.publication_version||'~'||locale.value||'~base~'||ke.default_locale=${version} AND NOT EXISTS(SELECT 1 FROM knowledge_translations t WHERE t.article_id=${alias}.id AND t.locale=locale.value AND t.locale<>ke.default_locale AND t.published_source_version=${alias}.publication_version AND t.published_json IS NOT NULL)))))`}

export const activeSourceProjectSql = (project:string) => `EXISTS(SELECT 1 FROM projects p WHERE p.id=${project} AND NOT EXISTS(SELECT 1 FROM project_settings s WHERE s.project_id=p.id AND json_extract(s.settings_json,'$.deleted_at') IS NOT NULL))`
export const articleEligibilitySql = (alias='a',authenticated='0',domain="''") => `${alias}.status='published' AND ${articleAccessSql(alias,authenticated,domain)} AND ${activeSourceProjectSql(`${alias}.project_id`)}`
/** Shared with the owner checklist: exactly the eligibility retrieval uses. */
export async function isArticleEligibleForAI(env:Env,projectId:string,articleId:string,sourceVersion?:string,access?:HelpAccess){
 return Boolean(await env.DB.prepare(`SELECT 1 FROM knowledge_articles a WHERE a.id=? AND a.project_id=? AND ${articleEligibilitySql('a','?', '?')} AND (? IS NULL OR a.publication_version=?)`).bind(articleId,projectId,...accessParams(access),sourceVersion??null,sourceVersion??null).first())
}
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
export async function readKnowledgeSource(env:Env,projectId:string,ref:PublicReference,access?:HelpAccess){
 if(!await isProjectActive(env,projectId))return null
 if(ref.id.startsWith('article:')){
  const id=ref.id.slice(8),parts=publicationParts(ref.sourceVersion)
  if(!await isArticleEligibleForAI(env,projectId,id,parts.base,access))return null
  const row=await env.DB.prepare(`SELECT title,slug,content,publication_version sourceVersion FROM knowledge_articles a WHERE id=? AND project_id=? AND publication_version=? AND ${articleEligibilitySql('a','?', '?')}`).bind(id,projectId,parts.base,...accessParams(access)).first<any>()
  if(!row)return null
  if(!parts.locale)return {...row,id:ref.id,url:articleCanonicalUrl(env,projectId,row.slug)}
  const settings=await getKnowledgeExperience(env,projectId)
  if(!settings.locales.includes(parts.locale)||parts.defaultLocale!==settings.defaultLocale)return null
  const tr=parts.locale!==settings.defaultLocale?await env.DB.prepare('SELECT published_json,publication_version FROM knowledge_translations WHERE article_id=? AND locale=? AND published_source_version=? AND published_json IS NOT NULL').bind(id,parts.locale,parts.base).first<any>():null
  if((tr?.publication_version||'base')!==parts.translation)return null
  const locale=tr?parts.locale:settings.defaultLocale,url=new URL(articleCanonicalUrl(env,projectId,row.slug));url.searchParams.set('locale',parts.locale)
  return {...row,...(tr?JSON.parse(tr.published_json):{}),id:ref.id,sourceVersion:ref.sourceVersion,url:url.href,locale,requestedLocale:parts.locale,localeFallback:locale!==parts.locale}
 }
 if(!ref.id.startsWith('knowledge:'))return null
 const row=await env.DB.prepare(`SELECT f.title,f.url,f.content,f.version_id sourceVersion FROM knowledge_documents f JOIN knowledge_datasets d ON d.published_version=f.version_id WHERE f.id=? AND d.project_id=? AND f.version_id=? AND ${activeSourceProjectSql('d.project_id')}`).bind(ref.id.slice(10),projectId,ref.sourceVersion).first<any>()
 return row?{...row,id:ref.id}:null
}
export async function resolvePublicCitations(env:Env,projectId:string,generationId:string,refs:PublicReference[],access?:HelpAccess):Promise<PublicCitation[]>{
 if(!Array.isArray(refs)||refs.length>10)throw new Error('Invalid public citations')
 const citations:PublicCitation[]=[]
 for(const ref of refs){
  if(!ref||typeof ref.id!=='string'||typeof ref.sourceVersion!=='string')throw new Error('Invalid public citation reference')
  if(!await env.DB.prepare('SELECT 1 FROM ai_generation_sources WHERE generation_id=? AND project_id=? AND source_id=? AND source_version=?').bind(generationId,projectId,ref.id,ref.sourceVersion).first())throw new Error('Unissued public citation')
  const row=await readKnowledgeSource(env,projectId,ref,access),url=safePublicUrl(row?.url)
  if(!row||!url)throw new Error('Stale or unsafe public citation')
  if(!citations.some(c=>c.id===ref.id))citations.push({id:ref.id,sourceVersion:ref.sourceVersion,title:row.title,url,...(row.requestedLocale?{locale:row.locale,requestedLocale:row.requestedLocale,localeFallback:row.localeFallback}:{})})
 }
 return citations
}
/** Used inside the single INSERT SELECT, after server resolution and before commit. */
export function citationAdmissionGuard(ref:PublicCitation,projectId:string,access?:HelpAccess){
 if(ref.id.startsWith('article:')){const identity=helpAccessWriteGuard(projectId,access);return {sql:`EXISTS(SELECT 1 FROM knowledge_articles a WHERE a.id=? AND a.project_id=c.project_id AND a.publication_version=? AND a.title=? AND ${articleEligibilitySql('a','?', '?')}) AND (${identity.sql})`,args:[ref.id.slice(8),ref.sourceVersion,ref.title,...accessParams(access),...identity.args]}}
 return {sql:`EXISTS(SELECT 1 FROM knowledge_documents f JOIN knowledge_datasets d ON d.published_version=f.version_id WHERE f.id=? AND d.project_id=c.project_id AND f.version_id=? AND f.title=? AND f.url=? AND ${activeSourceProjectSql('d.project_id')})`,args:[ref.id.slice(10),ref.sourceVersion,ref.title,ref.url]}
}

/** Knowledge authority always belongs to the conversation recipient. A typed
 * widget email or operator's own wider access never upgrades that authority. */
export async function conversationKnowledgeAccess(env:Env,projectId:string,conversationId:string){
 const row=await env.DB.prepare('SELECT contact_id FROM conversations WHERE id=? AND project_id=?').bind(conversationId,projectId).first<{contact_id:string}>()
 return row?accessForContact(env,projectId,row.contact_id):undefined
}
export async function generationKnowledgeAccess(env:Env,projectId:string,generationId:string){
 const row=await env.DB.prepare('SELECT conversation_id FROM ai_generations WHERE id=? AND project_id=?').bind(generationId,projectId).first<{conversation_id:string}>()
 return row?conversationKnowledgeAccess(env,projectId,row.conversation_id):undefined
}

/** One set predicate keeps the bounded tool surface below D1's parameter limit,
 * even when the model searches repeatedly and does not select citations. */
export function knowledgeRetrievalAdmissionGuard(generationId:string,projectId:string,access?:HelpAccess){
 const identity=helpAccessWriteGuard(projectId,access)
 return {sql:`(${identity.sql}) AND NOT EXISTS(SELECT 1 FROM ai_generation_sources issued WHERE issued.generation_id=? AND issued.project_id=c.project_id AND (
 (substr(issued.source_id,1,8)='article:' AND NOT EXISTS(SELECT 1 FROM knowledge_articles a WHERE a.id=substr(issued.source_id,9) AND a.project_id=c.project_id AND ${articlePublicationSql()} AND ${articleEligibilitySql('a','?', '?')})) OR
 (substr(issued.source_id,1,10)='knowledge:' AND NOT EXISTS(SELECT 1 FROM knowledge_documents f JOIN knowledge_datasets d ON d.published_version=f.version_id WHERE f.id=substr(issued.source_id,11) AND d.project_id=c.project_id AND f.version_id=issued.source_version AND ${activeSourceProjectSql('d.project_id')})) OR
 (substr(issued.source_id,1,8)<>'article:' AND substr(issued.source_id,1,10)<>'knowledge:')))`,args:[...identity.args,generationId,...accessParams(access)]}
}
