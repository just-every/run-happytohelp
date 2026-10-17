import type {Env} from '../../platform/env'

const owned='SELECT id FROM conversations WHERE project_id=?1 AND contact_id=?2'
const affected=`project_id=?1 AND (conversation_id IN (${owned}) OR recipient IN (SELECT lower(email) FROM contacts WHERE project_id=?1 AND id=?2 UNION SELECT lower(json_extract(metadata_json,'$.provided_email')) FROM contacts WHERE project_id=?1 AND id=?2))`
const forwards=`SELECT id FROM partner_forwards WHERE ${affected}`
export const conversationActionErasureObjects=`SELECT object_key FROM partner_reply_files WHERE project_id=?1 AND reply_id IN (SELECT id FROM partner_replies WHERE forward_id IN (${forwards}))`
export const conversationActionErasureStage=`INSERT OR IGNORE INTO contact_erasure_objects(project_id,contact_id,kind,source_id,object_key) SELECT ?1,?2,'media','partner-file:'||id,object_key FROM partner_reply_files WHERE project_id=?1 AND reply_id IN (SELECT id FROM partner_replies WHERE forward_id IN (${forwards}))`
export const conversationActionErasureCount=`(SELECT count(*) FROM partner_reply_files WHERE project_id=?1 AND reply_id IN (SELECT id FROM partner_replies WHERE forward_id IN (${forwards})))+(SELECT count(*) FROM partner_replies WHERE forward_id IN (${forwards}))+(SELECT count(*) FROM partner_forwards WHERE ${affected} AND recipient<>'')+(SELECT count(*) FROM conversation_merges WHERE project_id=?1 AND (source_id IN (${owned}) OR target_id IN (${owned})))`

/** Read conversationActionErasureObjects BEFORE this batch and remove those R2
 * objects using the existing erasure cleanup queue. Retain revoked hash tombstones
 * so an old partner reply can never fall through to customer ingestion. */
export function conversationActionErasureStatements(env:Env,projectId:string,contactId:string){
 const bound=(sql:string)=>env.DB.prepare(sql).bind(projectId,contactId)
 return [
  bound(`DELETE FROM partner_reply_files WHERE project_id=?1 AND reply_id IN (SELECT id FROM partner_replies WHERE forward_id IN (${forwards}))`),
  bound(`DELETE FROM partner_replies WHERE forward_id IN (${forwards})`),
  bound(`UPDATE partner_forwards SET recipient='',subject='',content='',message_ids_json='[]',command_key='erased:'||id,intent_hash='',revoked_at=coalesce(revoked_at,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)),state='erased' WHERE ${affected}`),
  bound(`DELETE FROM conversation_merges WHERE project_id=?1 AND (source_id IN (${owned}) OR target_id IN (${owned}))`),
 ]
}

/** Portable export includes every journal, grant tombstone and private reply;
 * partner_reply_files.object_key is part of the attachment byte inventory. */
export function conversationActionExportStatements(env:Env,projectId:string){
 return ['conversation_merges','partner_forwards','partner_replies','partner_reply_files'].map(table=>({table,statement:env.DB.prepare(`SELECT * FROM ${table} WHERE project_id=? ORDER BY id`).bind(projectId)}))
}
