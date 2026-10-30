import type {Env} from '../../platform/env'
import {headerThreadKeys,messageIds,subjectThreadKeys,threadAddresses,vendorThreadHeaders,type ThreadKey} from './email-threading-keys'
export {nativeThreadSubject,messageIds} from './email-threading-keys'
export type {ThreadKey} from './email-threading-keys'
export interface ThreadEvidence {projectId:string;messageId?:string;inReplyTo?:string;references?:string;subject?:string;to?:unknown;headers?:unknown;mailbox?:string}
export interface ThreadCandidate {conversationId:string;kind:string;value:string;source:string;sourceRef:string}
/** A conflict must suspend routing, including a mismatch with a signed reply grant.
 * Even a single candidate still requires the ordinary sender authority checks. */
export async function resolveEmailThreadCandidates(env:Env,input:ThreadEvidence){
 const keys:ThreadKey[]=[...headerThreadKeys(input.headers,'received','headers'),
  ...[input.messageId,input.inReplyTo,input.references].flatMap(value=>messageIds(value).map(id=>({kind:'message_id' as const,value:id,source:'received',sourceRef:'message_headers'}))),
  ...subjectThreadKeys(input.subject).map(key=>({...key,sourceRef:'subject'})),
  ...threadAddresses(input.to).map(value=>({kind:'reply_address' as const,value,source:'received',sourceRef:'to'}))]
 const unique=[...new Map(keys.map(key=>[`${key.kind}:${key.value}`,key])).values()]
 if(unique.length>300)throw new Error('Email threading evidence limit exceeded')
 const rows=unique.length?(await env.DB.prepare(`SELECT k.conversation_id,k.key_kind,k.key_value,k.source,k.source_ref FROM json_each(?2) wanted CROSS JOIN email_threading_keys k ON k.project_id=?1 AND k.key_kind=json_extract(wanted.value,'$.kind') AND k.key_value=json_extract(wanted.value,'$.value') JOIN conversations c ON c.id=k.conversation_id AND c.project_id=k.project_id JOIN contacts ct ON ct.id=c.contact_id AND ct.project_id=c.project_id WHERE COALESCE(json_extract(ct.metadata_json,'$.is_erased'),0)!=1 AND COALESCE(json_extract(ct.metadata_json,'$.is_erasing'),0)!=1 AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=c.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL) ORDER BY k.conversation_id,k.key_kind,k.key_value LIMIT 301`).bind(input.projectId,JSON.stringify(unique)).all<{conversation_id:string;key_kind:string;key_value:string;source:string;source_ref:string}>()).results:[]
 if(rows.length>300)throw new Error('Email threading candidate limit exceeded')
 const candidates:ThreadCandidate[]=rows.map(row=>({conversationId:row.conversation_id,kind:row.key_kind,value:row.key_value,source:row.source,sourceRef:row.source_ref}))
 // Imported notification chains outrank subject numbers/tokens, which outrank
 // reply addresses. Never resolve an ambiguous key by falling back to another
 // key, and retain the stricter conflict rule for native signed-mail evidence.
 const rank=(candidate:ThreadCandidate)=>candidate.kind==='message_id'?0:candidate.kind==='subject_token'?1:candidate.kind==='reply_address'?2:3
 const priority=Math.min(...candidates.map(rank))
 const native=candidates.some(candidate=>candidate.source==='native')
 const selected=native?candidates:candidates.filter(candidate=>rank(candidate)===priority)
 const conversationIds=[...new Set(selected.map(candidate=>candidate.conversationId))]
 const matchedKeys=new Map<string,Set<string>>()
 for(const candidate of candidates){const key=`${candidate.kind}:${candidate.value}`,ids=matchedKeys.get(key)??new Set<string>();ids.add(candidate.conversationId);matchedKeys.set(key,ids)}
 const ambiguous=[...matchedKeys.values()].some(ids=>ids.size>1)
 // A bracketed customer reference is only vendor evidence when this workspace
 // actually holds imported keys from that vendor. Unknown native tokens do not
 // turn otherwise admissible customer mail into a suspended message either.
 const vendors=[...new Set(unique.flatMap(key=>key.kind==='vendor_header'?[vendorThreadHeaders[key.value.split(':',1)[0]]]:key.kind==='subject_token'&&key.source!=='native'?[key.source]:[]).filter(Boolean))]
 const importing=vendors.length?await env.DB.prepare(`SELECT 1 FROM email_threading_keys WHERE project_id=? AND source IN (SELECT value FROM json_each(?)) AND key_kind IN ('subject_token','vendor_header') LIMIT 1`).bind(input.projectId,JSON.stringify(vendors)).first():null
 // Undo removes routing keys, but its retained import journal still establishes
 // a migration context. Unmatched RFC reply chains or forwarded reply recipients
 // merit the same *possible* migration hint, never authority to an old ticket.
 const replyEvidence=messageIds(input.inReplyTo).length>0||messageIds(input.references).length>0||Boolean(input.mailbox&&threadAddresses(input.to).some(address=>address!==input.mailbox))
 const retainedImport=!candidates.length&&(vendors.length||replyEvidence)?await env.DB.prepare("SELECT 1 FROM move_in_runs WHERE project_id=? AND state IN ('completed','undone') AND (? OR vendor IN (SELECT value FROM json_each(?))) LIMIT 1").bind(input.projectId,replyEvidence?1:0,JSON.stringify(vendors)).first():null
 const possiblePreMigrationReply=!candidates.length&&Boolean(importing||retainedImport)
 return {candidates,conversationIds,conflict:ambiguous||conversationIds.length>1,possiblePreMigrationReply}
}
/** Include these in the same batch as the native message/notification claim. */
export function emailThreadingStatements(env:Env,input:{projectId:string;conversationId:string;keys:readonly ThreadKey[];createdAt:number}){
 if(input.keys.length>300)throw new Error('Email threading key limit exceeded')
 return input.keys.map(key=>env.DB.prepare(`INSERT OR IGNORE INTO email_threading_keys(project_id,conversation_id,key_kind,key_value,source,source_ref,created_at) SELECT c.project_id,c.id,?,?,?,?,? FROM conversations c JOIN contacts ct ON ct.id=c.contact_id AND ct.project_id=c.project_id WHERE c.id=? AND c.project_id=? AND COALESCE(json_extract(ct.metadata_json,'$.is_erased'),0)!=1 AND COALESCE(json_extract(ct.metadata_json,'$.is_erasing'),0)!=1`).bind(key.kind,key.value,key.source,key.sourceRef,input.createdAt,input.conversationId,input.projectId))
}
/** Thread identifiers and CC/BCC options are private portable data. Workspace
 * exports must include these tables; contact erasure must remove address matches
 * as well as records belonging to the requester's conversations. */
export function emailThreadErasureStatements(env:Env,projectId:string,contactId:string,emails:readonly string[]){
 const encoded=JSON.stringify(emails.map(address=>address.toLowerCase()))
 return [env.DB.prepare(`DELETE FROM email_threading_keys WHERE project_id=?1 AND (conversation_id IN (SELECT id FROM conversations WHERE project_id=?1 AND contact_id=?2) OR key_kind='reply_address' AND lower(key_value) IN (SELECT value FROM json_each(?3)))`).bind(projectId,contactId,encoded),
  env.DB.prepare(`DELETE FROM email_message_options WHERE project_id=?1 AND (conversation_id IN (SELECT id FROM conversations WHERE project_id=?1 AND contact_id=?2) OR lower(to_address) IN (SELECT value FROM json_each(?3)) OR EXISTS(SELECT 1 FROM json_each(cc_json) WHERE lower(value) IN (SELECT value FROM json_each(?3))) OR EXISTS(SELECT 1 FROM json_each(bcc_json) WHERE lower(value) IN (SELECT value FROM json_each(?3))))`).bind(projectId,contactId,encoded)]
}
