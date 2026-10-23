import type {Env} from '../../platform/env'
// Selected quotes can belong to a participant in another requester's ticket.
const affected=`project_id=?1 AND (contact_id=?2 OR message_id IN (SELECT id FROM messages WHERE project_id=?1 AND actor_id=?2 AND actor_role='contact') OR conversation_id IN (SELECT id FROM conversations WHERE project_id=?1 AND contact_id=?2))`
export const feedbackErasureCount=`(SELECT count(*) FROM feedback_sources WHERE ${affected})`
export function feedbackErasureStatements(env:Env,projectId:string,contactId:string){return [
 env.DB.prepare(`INSERT OR IGNORE INTO erasure_requests(id,project_id,contact_id,store,destination_id,state,detail,requested_at,settled_at) SELECT lower(hex(randomblob(16))),?1,?2,'feedback:linked_records','','unsupported','Linked Penny and engineering records are not recalled. Review and request deletion with those providers.',?3,?3 WHERE EXISTS(SELECT 1 FROM feedback_sources WHERE ${affected})`).bind(projectId,contactId,Date.now()),
 env.DB.prepare(`DELETE FROM feedback_updates WHERE source_id IN (SELECT id FROM feedback_sources WHERE ${affected})`).bind(projectId,contactId),
 env.DB.prepare(`DELETE FROM feedback_sources WHERE ${affected}`).bind(projectId,contactId),
]}
