import type {Env} from '../../platform/env'
import {emailThreadErasureStatements} from './email-threading'

const held=`s.project_id=?1 AND (s.candidate_conversation_id IN (SELECT id FROM conversations WHERE project_id=?1 AND contact_id=?2)
 OR lower(s.from_address) IN (SELECT value FROM json_each(?3))
 OR EXISTS(SELECT 1 FROM json_each(s.to_json) a WHERE lower(a.value) IN (SELECT value FROM json_each(?3)))
 OR EXISTS(SELECT 1 FROM json_each(s.input_json,'$.cc') a WHERE lower(a.value) IN (SELECT value FROM json_each(?3))))`
/** Enter suspended objects into the existing resumable erasure delete stage;
 * every object is removed before its identifying D1 row can disappear. */
export function emailErasureObjectStatements(env:Env,projectId:string,contactId:string,emails:readonly string[]){
 return [env.DB.prepare(`INSERT OR IGNORE INTO contact_erasure_objects(project_id,contact_id,kind,source_id,object_key)
  SELECT ?1,?2,'media','suspended:'||s.id||':'||file.key,json_extract(file.value,'$.objectKey') FROM suspended_emails s CROSS JOIN json_each(s.input_json,'$.attachments') file
  WHERE ${held} AND json_extract(file.value,'$.objectKey') IS NOT NULL`).bind(projectId,contactId,JSON.stringify(emails))]
}
export function emailErasureStatements(env:Env,projectId:string,contactId:string,emails:readonly string[]){
 const values=JSON.stringify(emails)
 return [
  ...emailThreadErasureStatements(env,projectId,contactId,emails),
  env.DB.prepare('DELETE FROM email_followup_links WHERE project_id=? AND (conversation_id IN (SELECT id FROM conversations WHERE project_id=? AND contact_id=?) OR parent_id IN (SELECT id FROM conversations WHERE project_id=? AND contact_id=?))').bind(projectId,projectId,contactId,projectId,contactId),
  env.DB.prepare(`DELETE FROM suspended_emails AS s WHERE ${held}`).bind(projectId,contactId,values),
  env.DB.prepare('DELETE FROM email_sender_rules WHERE project_id=? AND address IN (SELECT value FROM json_each(?))').bind(projectId,values),
 ]
}
