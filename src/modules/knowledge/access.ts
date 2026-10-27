import type {Env} from '../../platform/env'
import {hashToken} from '../../platform/auth'
import {activeSourceProjectSql} from './public-sources'
export interface HelpAccess {contactId?:string;email?:string;verified:true;helpSessionHash?:string;nativeEmail?:true}
export const publicAccess:HelpAccess|undefined=undefined
export async function hasRestrictedCollections(env:Env,projectId:string){
 return Boolean(await env.DB.prepare("SELECT 1 FROM knowledge_categories WHERE project_id=? AND (audience<>'public' OR requires_entitlement=1) LIMIT 1").bind(projectId).first())
}
/** Every attached collection and its ancestors must admit the customer. A second
 * public category never bypasses a restricted category. UNION also bounds cycles.
 * Category publication controls navigation, independently of article publication. */
export function collectionAccessSql(seed:string,authenticated='0',domain="''",publishedOnly=false,contact="''"){
 return `NOT EXISTS(WITH RECURSIVE lineage(id) AS (${seed} UNION SELECT c.parent_id FROM knowledge_categories c JOIN lineage l ON c.id=l.id WHERE c.parent_id IS NOT NULL) SELECT 1 FROM knowledge_categories k JOIN lineage l ON l.id=k.id WHERE ${publishedOnly?'k.is_published<>1 OR ':''}(k.audience<>'public' AND (${authenticated}=0 OR (k.audience='domains' AND NOT EXISTS(SELECT 1 FROM json_each(k.allowed_domains) WHERE lower(value)=${domain})))) OR (k.requires_entitlement=1 AND NOT EXISTS(SELECT 1 FROM knowledge_collection_entitlements grant_row WHERE grant_row.project_id=k.project_id AND grant_row.category_id=k.id AND grant_row.contact_id=${contact})))`
}
export function articleAccessSql(alias='a',authenticated='0',domain="''",contact="''"){
 return collectionAccessSql(`SELECT ${alias}.category_id WHERE ${alias}.category_id IS NOT NULL UNION SELECT category_id FROM knowledge_article_categories WHERE article_id=${alias}.id`,authenticated,domain,false,contact)
}
export const categoryAccessSql=(alias='k',authenticated='0',domain="''",contact="''")=>collectionAccessSql(`SELECT ${alias}.id`,authenticated,domain,true,contact)
export function accessParams(access?:HelpAccess){return [access?.verified?1:0,access?.email?.split('@')[1]?.toLowerCase()||'',access?.verified?access.contactId||'':''] as const}
// Only a mail-native contact qualifies here. A receipt in a widget thread must
// never turn that widget's typed address into authority for private knowledge.
const nativeEmailProofSql=`c.is_verified=0 AND c.external_id IS NULL
 AND coalesce(json_extract(c.metadata_json,'$.email_unproven'),0)<>1
 AND coalesce(json_extract(c.metadata_json,'$.unverified_sender'),0)<>1
 AND coalesce(json_extract(c.metadata_json,'$.is_blocked'),0)<>1
 AND coalesce(json_extract(c.metadata_json,'$.is_deleted'),0)<>1
 AND coalesce(json_extract(c.metadata_json,'$.is_erasing'),0)<>1
 AND coalesce(json_extract(c.metadata_json,'$.is_erased'),0)<>1
 AND NOT EXISTS(SELECT 1 FROM contact_erasures e WHERE e.project_id=c.project_id AND e.contact_id=c.id)
 AND EXISTS(SELECT 1 FROM messages m JOIN message_authorship ma ON ma.message_id=m.id
 JOIN inbound_emails ie ON ie.project_id=m.project_id AND ie.local_id=m.local_id
 WHERE m.project_id=c.project_id AND m.actor_id=c.id AND m.actor_role='contact' AND ma.kind='visitor'
 AND ie.automatic=0 AND json_extract(ie.evidence_json,'$.sender_verified')=1
 AND lower(trim(CASE WHEN instr(json_extract(ie.evidence_json,'$.header_from'),'<')>0 THEN substr(json_extract(ie.evidence_json,'$.header_from'),instr(json_extract(ie.evidence_json,'$.header_from'),'<')+1,instr(json_extract(ie.evidence_json,'$.header_from'),'>')-instr(json_extract(ie.evidence_json,'$.header_from'),'<')-1) ELSE json_extract(ie.evidence_json,'$.header_from') END))=lower(trim(c.email)))`
/** Imported customer data or a typed widget email is never proof of identity. */
export async function accessForContact(env:Env,projectId:string,contactId:string):Promise<HelpAccess|undefined>{
 const row=await env.DB.prepare(`SELECT id,email,external_id,is_verified,metadata_json FROM contacts WHERE id=? AND project_id=? AND coalesce(json_extract(metadata_json,'$.is_blocked'),0)<>1 AND coalesce(json_extract(metadata_json,'$.is_deleted'),0)<>1 AND coalesce(json_extract(metadata_json,'$.is_erasing'),0)<>1 AND coalesce(json_extract(metadata_json,'$.is_erased'),0)<>1 AND NOT EXISTS(SELECT 1 FROM contact_erasures e WHERE e.project_id=contacts.project_id AND e.contact_id=contacts.id)`).bind(contactId,projectId).first<any>()
 if(!row)return undefined
 if(!row.is_verified){
  const proven=await env.DB.prepare(`SELECT 1 FROM contacts c WHERE c.id=? AND c.project_id=? AND c.email IS NOT NULL AND ${nativeEmailProofSql}`).bind(contactId,projectId).first()
  return proven?{verified:true,contactId:row.id,email:row.email.trim().toLowerCase(),nativeEmail:true}:undefined
 }
 const email=row.email?.trim().toLowerCase(),provenEmail=email&&row.external_id?.trim().toLowerCase()===email&&!JSON.parse(row.metadata_json||'{}').email_unproven
 return {verified:true,contactId:row.id,...(provenEmail?{email}:{})}
}
export async function resolveHelpAccess(env:Env,projectId:string,request:Request):Promise<HelpAccess|undefined>{
 const cookie=request.headers.get('Cookie')||'',help=cookie.match(/(?:^|;\s*)h2h_help=([^;]+)/)?.[1]
 if(help){const helpSessionHash=await hashToken(help);const row=await env.DB.prepare(`SELECT email,contact_id FROM knowledge_help_sessions h WHERE token_hash=? AND project_id=? AND expires_at>? AND ${activeSourceProjectSql('h.project_id')} AND (contact_id IS NULL OR EXISTS(SELECT 1 FROM contacts c WHERE c.id=h.contact_id AND c.project_id=h.project_id AND coalesce(json_extract(c.metadata_json,'$.is_blocked'),0)<>1 AND coalesce(json_extract(c.metadata_json,'$.is_deleted'),0)<>1 AND coalesce(json_extract(c.metadata_json,'$.is_erasing'),0)<>1 AND coalesce(json_extract(c.metadata_json,'$.is_erased'),0)<>1 AND NOT EXISTS(SELECT 1 FROM contact_erasures e WHERE e.project_id=c.project_id AND e.contact_id=c.id)))`).bind(helpSessionHash,projectId,Date.now()).first<{email:string;contact_id:string|null}>();if(row)return {verified:true,helpSessionHash,email:row.email,...(row.contact_id?{contactId:row.contact_id}:{})}}
 const token=request.headers.get('Authorization')?.replace(/^Bearer /,'')||cookie.match(/(?:^|;\s*)h2h_session=([^;]+)/)?.[1]
 if(!token||token.startsWith('dev_'))return undefined
 const row=await env.DB.prepare("SELECT contact_id FROM sessions WHERE token_hash=? AND project_id=? AND role='contact' AND revoked_at IS NULL AND expires_at>?").bind(await hashToken(token),projectId,Date.now()).first<{contact_id:string}>()
 return row?accessForContact(env,projectId,row.contact_id):undefined
}

/** The same proof must still exist at write admission, after an erasure fence. */
export function helpAccessWriteGuard(projectId:string,access?:HelpAccess):{sql:string;args:(string|number|null)[]}{
 if(access?.nativeEmail)return {sql:`EXISTS(SELECT 1 FROM contacts c WHERE c.id=? AND c.project_id=? AND lower(trim(c.email))=? AND ${nativeEmailProofSql})`,args:[access.contactId!,projectId,access.email!]}
 if(access?.helpSessionHash)return {sql:`EXISTS(SELECT 1 FROM knowledge_help_sessions h WHERE h.token_hash=? AND h.project_id=? AND h.email=? AND h.expires_at>max(?,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)) AND (h.contact_id IS NULL OR EXISTS(SELECT 1 FROM contacts c WHERE c.id=h.contact_id AND c.project_id=h.project_id AND coalesce(json_extract(c.metadata_json,'$.is_erasing'),0)<>1 AND coalesce(json_extract(c.metadata_json,'$.is_erased'),0)<>1 AND coalesce(json_extract(c.metadata_json,'$.is_blocked'),0)<>1)))`,args:[access.helpSessionHash,projectId,access.email||'',Date.now()]}
 if(access?.contactId)return {sql:`EXISTS(SELECT 1 FROM contacts c WHERE c.id=? AND c.project_id=? AND c.is_verified=1 AND coalesce(json_extract(c.metadata_json,'$.is_erasing'),0)<>1 AND coalesce(json_extract(c.metadata_json,'$.is_erased'),0)<>1 AND coalesce(json_extract(c.metadata_json,'$.is_blocked'),0)<>1 AND coalesce(json_extract(c.metadata_json,'$.is_deleted'),0)<>1 AND NOT EXISTS(SELECT 1 FROM contact_erasures e WHERE e.project_id=c.project_id AND e.contact_id=c.id) AND (?='' OR (lower(trim(c.email))=? AND lower(trim(c.external_id))=? AND coalesce(json_extract(c.metadata_json,'$.email_unproven'),0)<>1)))`,args:[access.contactId,projectId,access.email||'',access.email||'',access.email||'']}
 return {sql:access?'0=1':'1=1',args:[]}
}

/** Retrieval scope is always derived from the ticket, never a model argument. */
export async function accessForKnowledgeConversation(env:Env,projectId:string,conversationId:string){
 const row=await env.DB.prepare('SELECT contact_id FROM conversations c WHERE id=? AND project_id=? AND NOT EXISTS(SELECT 1 FROM conversation_participants cp WHERE cp.conversation_id=c.id)').bind(conversationId,projectId).first<{contact_id:string}>()
 return row?accessForContact(env,projectId,row.contact_id):undefined
}
