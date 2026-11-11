import type {Env} from '../../platform/env'
import {literal,readerSet,type Readers,type Reader} from './door'

/** Addresses never establish identity. Prefer the requester, otherwise require
 * exactly one current contact; unknown/ambiguous addresses are anonymous. */
// SQLite does not permit correlated FROM subqueries. Keep the conversation as
// scalar expressions when compiling a relation outside its own INSERT SELECT.
export function currentTicketReaders(projectId:string,conversationId:string,extra:{contacts?:readonly string[];addresses?:readonly string[];localId?:string}):Readers{
 const option=extra.localId===undefined?`opt.rowid=(SELECT latest.rowid FROM email_message_options latest WHERE latest.project_id=opt.project_id AND latest.conversation_id=opt.conversation_id ORDER BY latest.created_at DESC,latest.rowid DESC LIMIT 1)`:`opt.local_id=${literal(extra.localId)}`
 // Every arm filters by the literal workspace and conversation, so each reads
 // only that conversation's rows (by key) and the statement names few relations.
 const project=literal(projectId),conversation=literal(conversationId),audience=`audience.project_id=${project} AND audience.id=${conversation}`,options=`opt.project_id=${project} AND opt.conversation_id=${conversation} AND ${option}`
 const destinations=`SELECT value address FROM json_each(${literal(JSON.stringify(extra.addresses||[]))}) UNION SELECT opt.to_address FROM email_message_options opt WHERE ${options} UNION SELECT value FROM email_message_options opt,json_each(opt.cc_json) WHERE ${options} UNION SELECT value FROM email_message_options opt,json_each(opt.bcc_json) WHERE ${options}`
 return {sql:`SELECT 'contact' kind,audience.contact_id id FROM conversations audience WHERE ${audience} UNION SELECT 'contact',cp.contact_id FROM conversations audience JOIN conversation_participants cp ON cp.conversation_id=audience.id WHERE ${audience} UNION SELECT 'contact',value FROM json_each(${literal(JSON.stringify(extra.contacts||[]))}) UNION SELECT CASE WHEN max(CASE WHEN ct.id=audience.contact_id THEN ct.id END) IS NOT NULL OR count(ct.id)=1 THEN 'contact' ELSE 'anonymous' END,coalesce(max(CASE WHEN ct.id=audience.contact_id THEN ct.id END),CASE count(ct.id) WHEN 1 THEN min(ct.id) END,destination.address) FROM (${destinations}) destination CROSS JOIN conversations audience LEFT JOIN contacts ct ON ct.project_id=audience.project_id AND lower(trim(ct.email))=lower(trim(destination.address)) WHERE ${audience} AND destination.address IS NOT NULL AND trim(destination.address)<>'' GROUP BY destination.address`}
}
export async function describeReaders(env:Env,projectId:string,readers:Readers):Promise<Reader[]>{
 const rows=await env.DB.prepare(`SELECT r.kind,r.id,coalesce(ct.name,ct.email,u.name,CASE WHEN r.kind='anonymous' THEN r.id END,'Unknown recipient') label FROM (${readers.sql}) r LEFT JOIN contacts ct ON ct.project_id=? AND ct.id=r.id AND r.kind='contact' LEFT JOIN users u ON u.id=r.id AND r.kind='member'`).bind(projectId).all<Reader>()
 return rows.results
}
export function envelopeReaders(projectId:string,conversationId:string|undefined,addresses:readonly string[]):Readers{
 if(conversationId)return currentTicketReaders(projectId,conversationId,{addresses})
 return {sql:`SELECT CASE WHEN count(ct.id)=1 THEN 'contact' ELSE 'anonymous' END kind,CASE WHEN count(ct.id)=1 THEN min(ct.id) ELSE address.value END id FROM json_each(${literal(JSON.stringify(addresses))}) address LEFT JOIN contacts ct ON ct.project_id=${literal(projectId)} AND lower(trim(ct.email))=lower(trim(address.value)) GROUP BY address.key`}
}
export const combineReaders=(...sets:Readers[]):Readers=>({sql:sets.map(set=>`SELECT * FROM (${set.sql})`).join(' UNION ')})
