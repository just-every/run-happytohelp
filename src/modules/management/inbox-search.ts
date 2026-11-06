import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'
export const INBOX_SEARCH_MAX_LENGTH=200
export const INBOX_SEARCH_TOO_LONG=`That search is too long. Search for a message phrase, customer name or email using at most ${INBOX_SEARCH_MAX_LENGTH} characters.`
/** Bound input before it reaches either the identity or full-text search. */
export function inboxSearchTerm(c:{req:{query:(name:string)=>string|undefined}}){
 const term=(c.req.query('q')||c.req.query('search')||'').trim()
 if(term.length>INBOX_SEARCH_MAX_LENGTH)throw new HTTPException(400,{message:INBOX_SEARCH_TOO_LONG})
 return term
}
/** Identity substrings are literal; indexed message words are all required.
 * Quoting prevents operators such as OR, * or column names becoming FTS syntax.
 * Membership/project conditions on the outer conversation query remain authoritative.
 */
function searchWords(term:string){
 const parts=Array.from(term.matchAll(/"([^"]*)"|([^"\s]+)/gu),match=>match[1]??match[2]).filter(part=>/[\p{L}\p{N}]/u.test(part))
 return parts.length&&!term.includes('\0')?parts.map(part=>'"'+part.replace(/"/g,'""')+'"').join(' AND '):null
}
/** A search result previews the newest message that matched, not whatever was said last. */
export async function attachMatchedMessages(env:Env,term:string,rows:{id:string;project_id:string;matched_message?:unknown}[]){
 const words=searchWords(term)
 if(!words||!rows.length)return
 const matched=await env.DB.prepare(`SELECT m.id,m.conversation_id,m.content,m.actor_role,m.created_at FROM messages m WHERE m.rowid IN (SELECT max(rowid) FROM inbox_message_search WHERE inbox_message_search MATCH ? AND conversation_id IN (${rows.map(()=>'?').join(',')}) GROUP BY conversation_id)`).bind(words,...rows.map(row=>row.id)).all<{conversation_id:string}>()
 const byConversation=new Map(matched.results.map(row=>[String(row.conversation_id),row]))
 for(const row of rows){const message=byConversation.get(String(row.id));if(message)row.matched_message=message}
}
export function inboxSearchCondition(term:string){
 const needle=term.replace(/[A-Z]/g,letter=>letter.toLowerCase())
 const fields=["t.name","t.email","json_extract(t.metadata_json,'$.provided_name')","json_extract(t.metadata_json,'$.provided_email')"]
 const source=`EXISTS(SELECT 1 FROM move_in_conversations imported WHERE imported.project_id=c.project_id AND imported.conversation_id=c.id AND imported.source_id=? AND imported.source_id<>'')`
 const sourceId=term.startsWith('#')?term.slice(1):term
 const identity=`EXISTS(SELECT 1 FROM contacts t WHERE t.id=c.contact_id AND t.project_id=c.project_id AND (${fields.map(field=>`instr(lower(coalesce(${field},'')),?)>0`).join(' OR ')}))`
 // Quotes group a phrase; other whitespace-separated terms may occur in any order.
 // Every part is quoted before joining, so user text can never introduce FTS syntax.
 const words=searchWords(term)
 // Punctuation-only queries have no indexed words; they can still match identity.
 if(!words)return {sql:`(${identity} OR ${source})`,params:[...fields.map(()=>needle),sourceId]}
 return {sql:`(${identity} OR ${source} OR c.id IN (SELECT conversation_id FROM inbox_message_search WHERE inbox_message_search MATCH ?))`,params:[...fields.map(()=>needle),sourceId,words]}
}
