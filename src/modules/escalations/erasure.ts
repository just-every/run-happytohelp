import type {Env} from '../../platform/env'
import {staged} from '../management/contact-erasure/scope'
const tickets='SELECT id FROM conversations WHERE project_id=?1 AND contact_id=?2'
export const escalationErasureCount=`(SELECT count(*) FROM escalation_links WHERE project_id=?1 AND conversation_id IN (${tickets}))+(SELECT count(*) FROM escalation_handoffs WHERE project_id=?1 AND conversation_id IN (${tickets}))+(SELECT count(*) FROM escalation_drafts WHERE project_id=?1 AND conversation_id IN (${tickets}))`
export function escalationErasureStatements(env:Env,projectId:string,contactId:string){
 const db=env.DB,bound=(sql:string)=>db.prepare(sql).bind(projectId,contactId)
 return [
  // External copies cannot honestly be recalled: retain an explicit deletion task
  // for each provider before removing the ticket's local links and shared grants.
  bound(`INSERT INTO erasure_requests(id,project_id,contact_id,store,destination_id,state,detail,requested_at,settled_at) SELECT lower(hex(randomblob(16))),?1,?2,'escalation:'||provider,'','unsupported','This provider may hold shared context or attachment copies for this customer. Check and remove their copies; local erasure cannot recall them.',unixepoch()*1000,unixepoch()*1000 FROM escalation_operations WHERE project_id=?1 AND ?2 IS NOT NULL GROUP BY provider`),
  // A participant can own media in somebody else's ticket. Revoke every staged
  // attachment's grant before the canonical erasure removes its media row.
  bound(`DELETE FROM escalation_attachment_grants WHERE project_id=?1 AND (conversation_id IN (${tickets}) OR media_id IN (${staged('media')}))`),
  ...['escalation_drafts','escalation_handoffs','escalation_operations','escalation_links'].map(table=>bound(`DELETE FROM ${table} WHERE project_id=?1 AND conversation_id IN (${tickets})`)),
  // An engineering issue may belong to several customers. Keep it only while
  // another ticket still links it; remove its delivery identities with the orphan.
  bound(`DELETE FROM escalation_deliveries WHERE issue_id IN (SELECT id FROM escalation_issues WHERE project_id=?1 AND NOT EXISTS(SELECT 1 FROM escalation_links l WHERE l.issue_id=escalation_issues.id)) AND ?2 IS NOT NULL`),
  bound(`DELETE FROM escalation_issues WHERE project_id=?1 AND NOT EXISTS(SELECT 1 FROM escalation_links l WHERE l.issue_id=escalation_issues.id) AND ?2 IS NOT NULL`),
 ]
}
