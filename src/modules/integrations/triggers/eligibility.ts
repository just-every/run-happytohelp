import type {Env} from '../../../platform/env'
import {contactAvailableSql} from '../../conversations/contact-privacy'
export const notificationTicketSql=`SELECT c.*,CASE WHEN EXISTS(SELECT 1 FROM inbound_emails e WHERE e.project_id=c.project_id AND e.conversation_id=c.id) THEN 'email' ELSE c.channel END notification_channel,ct.name requester_name,p.name brand_name FROM conversations c
 JOIN contacts ct ON ct.id=c.contact_id AND ct.project_id=c.project_id JOIN projects p ON p.id=c.project_id
 WHERE c.id=? AND c.project_id=? AND ${contactAvailableSql()}
 AND coalesce(json_extract(ct.metadata_json,'$.unverified_sender'),0)!=1
 AND coalesce(json_extract(ct.metadata_json,'$.unusable_from'),0)!=1
 AND coalesce(json_extract(ct.metadata_json,'$.is_blocked'),0)!=1
 AND coalesce(json_extract(ct.metadata_json,'$.is_deleted'),0)!=1
 AND NOT EXISTS(SELECT 1 FROM project_settings s WHERE s.project_id=c.project_id AND json_extract(s.settings_json,'$.deleted_at') IS NOT NULL)
 AND NOT EXISTS(SELECT 1 FROM inbound_emails e WHERE e.project_id=c.project_id AND e.conversation_id=c.id AND e.automatic=1)
 AND NOT EXISTS(SELECT 1 FROM messages first_request JOIN inbound_emails proof ON proof.project_id=first_request.project_id
 AND (proof.message_id=first_request.id OR proof.local_id=first_request.local_id) WHERE first_request.id=(
 SELECT first_message.id FROM messages first_message WHERE first_message.project_id=c.project_id AND first_message.conversation_id=c.id AND first_message.actor_role='contact' ORDER BY first_message.revision,first_message.id LIMIT 1)
 AND json_extract(proof.evidence_json,'$.sender_verified')=0 AND json_extract(proof.evidence_json,'$.grant.recipient') IS NULL)
 AND c.ticket_source NOT IN ('import','merge','legacy-import')
 AND NOT EXISTS(SELECT 1 FROM reporting_legacy_conversations s WHERE s.project_id=c.project_id AND s.conversation_id=c.id)
 AND NOT EXISTS(SELECT 1 FROM move_in_conversations s WHERE s.project_id=c.project_id AND s.conversation_id=c.id)`
/** Historical and machine origins remain inert even when callers omit source. */
export async function notificationTicket(env:Env,projectId:string,conversationId:string){
 return env.DB.prepare(notificationTicketSql).bind(conversationId,projectId).first<any>()
}
