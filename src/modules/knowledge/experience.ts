import {rememberReplySources} from './delivery'
import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'
import {articleAccessSql,categoryAccessSql,accessParams,type HelpAccess} from './access'
import {activeSourceProjectSql} from './public-sources'
export const templateTypes=['home','category','section','article','search','request'] as const
export function validLocale(value:unknown):string {if(typeof value!=='string'||!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/.test(value))throw new HTTPException(400,{message:'Invalid locale'});try{Intl.getCanonicalLocales(value)}catch{throw new HTTPException(400,{message:'Invalid locale'})}return value}
export async function getKnowledgeExperience(env:Env,projectId:string){
 const row=await env.DB.prepare('SELECT * FROM knowledge_experience WHERE project_id=?').bind(projectId).first<any>()
 return {defaultLocale:row?.default_locale||'en',locales:JSON.parse(row?.locales_json||'["en"]') as string[],templates:JSON.parse(row?.templates_json||'{}') as Record<string,string>}
}
export async function selectKnowledgeLocale(env:Env,projectId:string,requested?:string){const settings=await getKnowledgeExperience(env,projectId);return settings.locales.includes(requested||'')?requested!:settings.defaultLocale}
export async function listAccessibleCategories(env:Env,projectId:string,access?:HelpAccess,locale?:string){
 const rows=await env.DB.prepare(`SELECT k.id,k.name,k.name title,k.slug,k.summary,k.parent_id,k.parent_id parentId,k.position FROM knowledge_categories k WHERE k.project_id=? AND ${activeSourceProjectSql('k.project_id')} AND ${categoryAccessSql('k','?', '?','?')} ORDER BY k.position,k.name`).bind(projectId,...accessParams(access)).all<any>();return rows.results
}
export interface ArticleOptions {access?:HelpAccess;locale?:string;query?:string;categoryId?:string;conversationId?:string}
const articleFields=`a.id,a.slug,a.title,a.content,a.summary,a.category_id,a.category_id categoryId,a.position,a.publication_version,(SELECT json_group_array(category_id) FROM knowledge_article_categories WHERE article_id=a.id) category_ids`
async function localize(env:Env,projectId:string,rows:any[],requested?:string){
 const experience=await getKnowledgeExperience(env,projectId),locale=await selectKnowledgeLocale(env,projectId,requested)
 return Promise.all(rows.map(async row=>{const tr=locale!==experience.defaultLocale?await env.DB.prepare("SELECT published_json FROM knowledge_translations WHERE article_id=? AND locale=? AND published_json IS NOT NULL AND published_source_version=?").bind(row.id,locale,row.publication_version).first<any>():null;return {...row,...(tr?JSON.parse(tr.published_json):{}),locale:tr?locale:experience.defaultLocale,requestedLocale:locale,category_ids:JSON.parse(row.category_ids||'[]')}}))
}
export async function listAccessibleArticles(env:Env,projectId:string,options:ArticleOptions={}){
 const rows=await env.DB.prepare(`SELECT ${articleFields} FROM knowledge_articles a WHERE a.project_id=? AND a.status='published' AND ${activeSourceProjectSql('a.project_id')} AND ${articleAccessSql('a','?', '?','?')} ${options.conversationId?`AND (${articleAccessSql('a')} OR NOT EXISTS(SELECT 1 FROM conversation_participants cp WHERE cp.conversation_id=?))`:''} ${options.categoryId?'AND (a.category_id=? OR EXISTS(SELECT 1 FROM knowledge_article_categories ac WHERE ac.article_id=a.id AND ac.category_id=?))':''} ORDER BY a.position,a.title`).bind(projectId,...accessParams(options.access),...(options.conversationId?[options.conversationId]:[]),...(options.categoryId?[options.categoryId,options.categoryId]:[])).all<any>()
 const localized=await localize(env,projectId,rows.results,options.locale),query=options.query?.trim().toLowerCase(),articles=query?localized.filter(a=>`${a.title} ${a.summary} ${a.content}`.toLowerCase().includes(query)):localized
 if(options.conversationId)await rememberReplySources(env,projectId,options.conversationId,articles.map(a=>({id:`article:${a.id}`,sourceVersion:a.publication_version})))
 return articles
}
export async function lookupAccessibleArticle(env:Env,projectId:string,slug:string,options:ArticleOptions={}){
 const row=await env.DB.prepare(`SELECT ${articleFields} FROM knowledge_articles a WHERE a.project_id=? AND (a.slug=? OR a.id=(SELECT article_id FROM knowledge_slug_redirects WHERE project_id=? AND slug=?)) AND a.status='published' AND ${activeSourceProjectSql('a.project_id')} AND ${articleAccessSql('a','?', '?','?')} ORDER BY (a.slug=?) DESC LIMIT 1`).bind(projectId,slug,projectId,slug,...accessParams(options.access),slug).first<any>()
 if(!row)return null;return {article:(await localize(env,projectId,[row],options.locale))[0],...(row.slug!==slug?{redirectSlug:row.slug}:{})}
}
