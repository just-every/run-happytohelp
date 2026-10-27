import type {Env} from '../../platform/env'
import {activeSourceProjectSql} from './public-sources'
import {knowledgeAccountCte} from './access'

/** All material seen by a generation matters, including sources it did not cite.
 * Evaluate against live recipients and publications in the admitting statement. */
export function generationKnowledgeSql(generation:string,conversation='c',reader?:string){
 const denied=(account:string)=>`(k.audience<>'public' AND (${account}.id IS NULL OR (k.audience='domains' AND NOT EXISTS(SELECT 1 FROM json_each(k.allowed_domains) WHERE lower(value)=${account}.domain)))) OR (k.requires_entitlement=1 AND NOT EXISTS(SELECT 1 FROM knowledge_collection_entitlements gr WHERE gr.project_id=k.project_id AND gr.category_id=k.id AND gr.contact_id=${account}.id))`
 // Separate materialized relations keep this predicate within D1's expression
 // depth bound even inside the message admission statement's other guards.
 return `EXISTS(WITH RECURSIVE
 ${knowledgeAccountCte('requester',`${conversation}.contact_id`,`${conversation}.project_id`)}${reader?`,${knowledgeAccountCte('reader',reader,`${conversation}.project_id`)}`:''},
 issued AS MATERIALIZED (SELECT source_id,source_version FROM ai_generation_sources WHERE project_id=${conversation}.project_id AND generation_id=${generation}),
 articles AS MATERIALIZED (SELECT i.source_id,i.source_version,a.id,a.category_id,a.status,a.publication_version FROM issued i LEFT JOIN knowledge_articles a ON a.id=substr(i.source_id,9) AND a.project_id=${conversation}.project_id WHERE substr(i.source_id,1,8)='article:'),
 lineage(source_id,id) AS (SELECT source_id,category_id FROM articles WHERE category_id IS NOT NULL UNION SELECT a.source_id,ac.category_id FROM articles a JOIN knowledge_article_categories ac ON ac.article_id=a.id UNION SELECT l.source_id,k.parent_id FROM lineage l JOIN knowledge_categories k ON k.id=l.id WHERE k.parent_id IS NOT NULL),
 invalid_articles AS MATERIALIZED (SELECT 1 FROM articles WHERE id IS NULL OR status<>'published' OR publication_version<>source_version),
 invalid_categories AS MATERIALIZED (SELECT 1 FROM lineage l JOIN knowledge_categories k ON k.id=l.id LEFT JOIN requester ON 1=1 ${reader?'LEFT JOIN reader ON 1=1':''} WHERE (${denied('requester')}) ${reader?`OR (${denied('reader')})`:''} OR ((k.audience<>'public' OR k.requires_entitlement=1) AND EXISTS(SELECT 1 FROM conversation_participants cp WHERE cp.conversation_id=${conversation}.id))),
 invalid_datasets AS MATERIALIZED (SELECT 1 FROM issued i LEFT JOIN knowledge_documents kd ON kd.id=substr(i.source_id,11) AND kd.version_id=i.source_version LEFT JOIN knowledge_datasets ds ON ds.published_version=kd.version_id AND ds.project_id=${conversation}.project_id WHERE substr(i.source_id,1,10)='knowledge:' AND ds.id IS NULL),
 invalid_ids AS MATERIALIZED (SELECT 1 FROM issued WHERE substr(source_id,1,8)<>'article:' AND substr(source_id,1,10)<>'knowledge:')
 SELECT 1 WHERE ${activeSourceProjectSql(`${conversation}.project_id`)} AND NOT EXISTS(SELECT 1 FROM invalid_articles) AND NOT EXISTS(SELECT 1 FROM invalid_categories) AND NOT EXISTS(SELECT 1 FROM invalid_datasets) AND NOT EXISTS(SELECT 1 FROM invalid_ids))`
}
export function messageKnowledgeSql(message='m',conversation='c',reader?:string){
 return `(${message}.actor_role<>'ai' OR ${generationKnowledgeSql(`substr(${message}.local_id,12)`,conversation,reader)})`
}
export async function messageKnowledgeAvailable(env:Env,messageId:string,readerId?:string){
 return Boolean(await env.DB.prepare(`SELECT 1 FROM messages m JOIN conversations c ON c.id=m.conversation_id AND c.project_id=m.project_id WHERE m.id=? AND ${messageKnowledgeSql('m','c',readerId?'?':undefined)}`).bind(messageId,...(readerId?[readerId]:[])).first())
}
/** Keep a generation's inherited knowledge provenance even if it only paraphrases history. */
export async function inheritKnowledgeSources(env:Env,generationId:string,messageIds:string[]){
 if(!messageIds.length)return
 await env.DB.prepare(`INSERT OR IGNORE INTO ai_generation_sources(generation_id,project_id,source_id,source_version) SELECT ?,ks.project_id,ks.source_id,ks.source_version FROM messages m JOIN ai_generation_sources ks ON ks.generation_id=substr(m.local_id,12) AND ks.project_id=m.project_id WHERE m.actor_role='ai' AND m.id IN (SELECT value FROM json_each(?))`).bind(generationId,JSON.stringify(messageIds)).run()
}
