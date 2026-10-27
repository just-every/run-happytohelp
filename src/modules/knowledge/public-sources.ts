import {articleAccessSql,accessParams,helpAccessWriteGuard,type HelpAccess} from './access'
import type {Env} from '../../platform/env'
import {isProjectActive} from '../../platform/project-status.ts'

export interface PublicReference {id:string;sourceVersion:string}
export interface PublicCitation extends PublicReference {title:string;url:string}
export const activeSourceProjectSql = (project:string) => `EXISTS(SELECT 1 FROM projects p WHERE p.id=${project} AND NOT EXISTS(SELECT 1 FROM project_settings s WHERE s.project_id=p.id AND json_extract(s.settings_json,'$.deleted_at') IS NOT NULL))`
export const articleEligibilitySql = (alias='a',scoped=false) => `${alias}.status='published' AND ${scoped?articleAccessSql(alias,'?','?','?'):articleAccessSql(alias)} AND ${activeSourceProjectSql(`${alias}.project_id`)}`
/** Shared with the owner checklist: exactly the eligibility retrieval uses. */
export async function isArticleEligibleForAI(env:Env,projectId:string,articleId:string,sourceVersion?:string,access?:HelpAccess){
 return Boolean(await env.DB.prepare(`SELECT 1 FROM knowledge_articles a WHERE a.id=? AND a.project_id=? AND ${articleEligibilitySql('a',Boolean(access))} AND (? IS NULL OR a.publication_version=?)`).bind(articleId,projectId,...(access?accessParams(access):[]),sourceVersion??null,sourceVersion??null).first())
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
  const id=ref.id.slice(8)
  if(!await isArticleEligibleForAI(env,projectId,id,ref.sourceVersion,access))return null
  const row=await env.DB.prepare(`SELECT title,slug,content,publication_version sourceVersion FROM knowledge_articles a WHERE id=? AND project_id=? AND publication_version=? AND ${articleEligibilitySql('a',Boolean(access))}`).bind(id,projectId,ref.sourceVersion,...(access?accessParams(access):[])).first<any>()
  return row?{...row,id:ref.id,url:articleCanonicalUrl(env,projectId,row.slug)}:null
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
  if(!citations.some(c=>c.id===ref.id))citations.push({id:ref.id,sourceVersion:ref.sourceVersion,title:row.title,url})
 }
 return citations
}
/** Used inside the single INSERT SELECT, after server resolution and before commit. */
export function citationAdmissionGuard(ref:PublicCitation,projectId:string,access?:HelpAccess){
 if(ref.id.startsWith('article:')){const proof=helpAccessWriteGuard(projectId,access);return {sql:`EXISTS(SELECT 1 FROM knowledge_articles a WHERE a.id=? AND a.project_id=c.project_id AND a.publication_version=? AND a.title=? AND (${articleEligibilitySql()} OR (NOT EXISTS(SELECT 1 FROM conversation_participants cp WHERE cp.conversation_id=c.id) AND ${articleEligibilitySql('a',Boolean(access))}))) AND ${proof.sql}`,args:[ref.id.slice(8),ref.sourceVersion,ref.title,...(access?accessParams(access):[]),...proof.args]}}
 return {sql:`EXISTS(SELECT 1 FROM knowledge_documents f JOIN knowledge_datasets d ON d.published_version=f.version_id WHERE f.id=? AND d.project_id=c.project_id AND f.version_id=? AND f.title=? AND f.url=? AND ${activeSourceProjectSql('d.project_id')})`,args:[ref.id.slice(10),ref.sourceVersion,ref.title,ref.url]}
}
