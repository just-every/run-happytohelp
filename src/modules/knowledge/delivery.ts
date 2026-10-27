import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'
import {activeSourceProjectSql} from './public-sources'
import {knowledgeAccountCte} from './access'

/** All material seen by a generation matters, including sources it did not cite.
 * Evaluate against live recipients and publications in the admitting statement. */
function sourcesKnowledgeSql(issued:string,conversation='c',reader?:string,pendingRecipients:string[]=[],addresses="SELECT NULL address WHERE 0"){
 const denied=(account:string)=>`(k.audience<>'public' AND (${account}.id IS NULL OR (k.audience='domains' AND NOT EXISTS(SELECT 1 FROM json_each(k.allowed_domains) WHERE lower(value)=${account}.domain)))) OR ((k.audience<>'public' OR k.requires_entitlement=1) AND NOT EXISTS(SELECT 1 FROM knowledge_collection_entitlements gr WHERE gr.project_id=k.project_id AND gr.category_id=k.id AND gr.contact_id=${account}.id))`
 // Separate materialized relations keep this predicate within D1's expression
 // depth bound even inside the message admission statement's other guards.
 return `EXISTS(WITH RECURSIVE
 recipients(id) AS (SELECT ${conversation}.contact_id UNION SELECT cp.contact_id FROM conversation_participants cp WHERE cp.conversation_id=${conversation}.id UNION SELECT value FROM json_each('${JSON.stringify(pendingRecipients).replaceAll("'","''")}') UNION SELECT (SELECT coalesce(max(CASE WHEN ct.id=${conversation}.contact_id THEN ct.id END),CASE count(*) WHEN 1 THEN min(ct.id) ELSE '' END) FROM contacts ct WHERE ct.project_id=${conversation}.project_id AND lower(trim(ct.email))=lower(trim(destination.address))) FROM (${addresses}) destination WHERE destination.address IS NOT NULL AND destination.address<>''${reader?` UNION SELECT ${reader}`:''}),
 ${knowledgeAccountCte('recipient','(SELECT id FROM recipients WHERE id=kr.id)',`${conversation}.project_id`)},
 issued AS MATERIALIZED (${issued}),
 articles AS MATERIALIZED (SELECT i.source_id,i.source_version,a.id,a.category_id,a.status,a.publication_version FROM issued i LEFT JOIN knowledge_articles a ON a.id=substr(i.source_id,9) AND a.project_id=${conversation}.project_id WHERE substr(i.source_id,1,8)='article:'),
 lineage(source_id,id) AS (SELECT source_id,category_id FROM articles WHERE category_id IS NOT NULL UNION SELECT a.source_id,ac.category_id FROM articles a JOIN knowledge_article_categories ac ON ac.article_id=a.id UNION SELECT l.source_id,k.parent_id FROM lineage l JOIN knowledge_categories k ON k.id=l.id WHERE k.parent_id IS NOT NULL),
 invalid_articles AS MATERIALIZED (SELECT 1 FROM articles WHERE id IS NULL OR status<>'published' OR publication_version<>source_version),
 invalid_categories AS MATERIALIZED (SELECT 1 FROM lineage l JOIN knowledge_categories k ON k.id=l.id CROSS JOIN recipients target LEFT JOIN recipient ON recipient.id=target.id WHERE k.project_id<>${conversation}.project_id OR k.is_published<>1 OR (${denied('recipient')})),
 invalid_datasets AS MATERIALIZED (SELECT 1 FROM issued i LEFT JOIN knowledge_documents kd ON kd.id=substr(i.source_id,11) AND kd.version_id=i.source_version LEFT JOIN knowledge_datasets ds ON ds.published_version=kd.version_id AND ds.project_id=${conversation}.project_id WHERE substr(i.source_id,1,10)='knowledge:' AND ds.id IS NULL),
 invalid_ids AS MATERIALIZED (SELECT 1 FROM issued WHERE substr(source_id,1,8)<>'article:' AND substr(source_id,1,10)<>'knowledge:')
 SELECT 1 WHERE ${activeSourceProjectSql(`${conversation}.project_id`)} AND NOT EXISTS(SELECT 1 FROM invalid_articles) AND NOT EXISTS(SELECT 1 FROM invalid_categories) AND NOT EXISTS(SELECT 1 FROM invalid_datasets) AND NOT EXISTS(SELECT 1 FROM invalid_ids))`
}
/** Internal metadata carries source identity, never a cached grant. JSON cannot
 * manufacture it. Rendering preserves it through preparation and held resends. */
export const customerReplyScope=Symbol('customer reply source scope')
export interface CustomerReplyScope {projectId:string;conversationId:string}
const literal=(value:string)=>"'"+value.replaceAll("'","''")+"'"
/** Composition provenance is server held and deliberately cumulative: an edited,
 * saved or replayed draft cannot attest that previously retrieved text is gone.
 * Keep the fence with the ticket, independently of audit retention and clients. */
export function customerReplyAdmissionSql(conversation='c',reader?:string,pendingRecipients:string[]=[],delivery:{localId?:string;emails?:readonly string[]}={}){
 const selected=delivery.localId===undefined?'0=1':`o.local_id=${literal(delivery.localId)}`
 const options=`SELECT * FROM email_message_options o WHERE o.project_id=${conversation}.project_id AND o.conversation_id=${conversation}.id AND ${selected}`
 const addresses=`SELECT value address FROM json_each(${literal(JSON.stringify(delivery.emails??[]))}) UNION SELECT to_address FROM (${options}) UNION SELECT value FROM (${options}) o,json_each(o.cc_json) UNION SELECT value FROM (${options}) o,json_each(o.bcc_json)`
 return sourcesKnowledgeSql(`SELECT source_id,source_version FROM knowledge_reply_sources WHERE project_id=${conversation}.project_id AND conversation_id=${conversation}.id UNION SELECT ks.source_id,ks.source_version FROM ai_generation_sources ks JOIN ai_generations g ON g.id=ks.generation_id AND g.project_id=ks.project_id WHERE g.project_id=${conversation}.project_id AND g.conversation_id=${conversation}.id`,conversation,reader,pendingRecipients,addresses)
}
/** Every channel uses the same predicate at the last reversible send boundary,
 * after rendering/storage reads and current To/CC/BCC preparation. */
export class KnowledgeDeliveryRefused extends HTTPException {constructor(){super(409,{message:'Knowledge access changed; review every To, CC and BCC recipient and current grants before sending'})}}
type ReplyMail={ [customerReplyScope]?:CustomerReplyScope;to:string;cc?:readonly string[];bcc?:readonly string[] }
export function customerReplyMailSql(input:ReplyMail){
 const scope=input[customerReplyScope]
 if(!scope)return '1=1'
 const emails=[input.to,...(input.cc??[]),...(input.bcc??[])]
 return `EXISTS(SELECT 1 FROM conversations c WHERE c.project_id=${literal(scope.projectId)} AND c.id=${literal(scope.conversationId)} AND ${customerReplyAdmissionSql('c',undefined,[],{emails})})`
}
export async function assertCustomerReplyDelivery(env:Env,input:ReplyMail){
 if(!input[customerReplyScope])return
 if(!await env.DB.prepare(`SELECT 1 WHERE ${customerReplyMailSql(input)}`).first())throw new KnowledgeDeliveryRefused()
}

export function messageKnowledgeSql(message='m',conversation='c',reader?:string){
 return customerReplyAdmissionSql(conversation,reader)
}
export async function messageKnowledgeAvailable(env:Env,messageId:string,readerId?:string){
 return Boolean(await env.DB.prepare(`SELECT 1 FROM messages m JOIN conversations c ON c.id=m.conversation_id AND c.project_id=m.project_id WHERE m.id=? AND ${messageKnowledgeSql('m','c',readerId!==undefined?'?':undefined)}`).bind(messageId,...(readerId!==undefined?[readerId]:[])).first())
}
/** Keep a generation's inherited knowledge provenance even if it only paraphrases history. */
export async function inheritKnowledgeSources(env:Env,generationId:string,messageIds:string[]){
 if(!messageIds.length)return
 await env.DB.prepare(`INSERT OR IGNORE INTO ai_generation_sources(generation_id,project_id,source_id,source_version) SELECT ?,ks.project_id,ks.source_id,ks.source_version FROM messages m JOIN ai_generation_sources ks ON ks.generation_id=substr(m.local_id,12) AND ks.project_id=m.project_id WHERE m.actor_role='ai' AND m.id IN (SELECT value FROM json_each(?))`).bind(generationId,JSON.stringify(messageIds)).run()
}

/** Record every byte-bearing preview before returning it. This is provenance,
 * never a grant: every writer calls customerReplyAdmissionSql at send time.
 * The cumulative ticket fence survives edits, omitted citations and saved drafts. */
export async function rememberReplySources(env:Env,projectId:string,conversationId:string,sources:{id:string;sourceVersion:string}[]){
 if(!sources.length)return
 const issued="SELECT json_extract(value,'$.id') source_id,json_extract(value,'$.sourceVersion') source_version FROM json_each(?)"
 const guard=sourcesKnowledgeSql(issued)
 const encoded=JSON.stringify(sources)
 const results=await env.DB.batch([
  env.DB.prepare(`INSERT OR IGNORE INTO knowledge_reply_sources(project_id,conversation_id,source_id,source_version) SELECT c.project_id,c.id,i.source_id,i.source_version FROM conversations c CROSS JOIN (${issued}) i WHERE c.project_id=? AND c.id=? AND ${guard}`).bind(encoded,projectId,conversationId,encoded),
  env.DB.prepare(`SELECT 1 FROM conversations c WHERE c.project_id=? AND c.id=? AND ${guard} AND NOT EXISTS(SELECT 1 FROM (${issued}) i WHERE NOT EXISTS(SELECT 1 FROM knowledge_reply_sources ks WHERE ks.project_id=c.project_id AND ks.conversation_id=c.id AND ks.source_id=i.source_id AND ks.source_version=i.source_version))`).bind(projectId,conversationId,encoded,encoded)
 ])
 if(!results[1].results.length)throw new HTTPException(409,{message:'Knowledge access changed; review the current recipients and grants before replying'})
}
