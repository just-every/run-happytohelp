import {voiceErasureCount,voiceErasureStatements} from '../../voice/erasure'
import {triageErasureCount,triageErasureStatements} from '../../triage/erasure'
import {customerErasureStatements,customerErasureCount} from '../../customers/index'
import {escalationErasureStatements,escalationErasureCount} from '../../escalations/erasure'
import {csvCustomerErasureStatements} from '../../import-kit/csv/erasure'
import {problemErasureCount,problemErasureStatements} from '../../tickets/problem-erasure'
import {reportTimerErasureCount,reportTimerErasureStatements} from '../../reports/timers'
import {eraseFormStatements} from '../../forms/erasure'
import {portalErasureStatements} from '../../portal/privacy'
import {importErasureStatements} from '../../move-in/erasure'
import {eraseSurveyStatements} from '../../outcomes/survey-store'
import {ticketErasureCount,ticketErasureStatements} from '../../tickets/erasure'
import {collaborationRecordsCount,collaborationRecordsStatements} from './collaboration'
import {emailErasureStatements} from '../../integrations/email-erasure'
import {workflowErasureCount,workflowErasureStatements} from '../../workflows/erasure'
import type {Env} from '../../../platform/env'
import {legacyArchiveRedaction} from './archive'
import {erasureInboundEvidenceStatements} from './inbound-evidence'
import {attempts,contextJobs,contextTables,conversations,generations,localJobs,messages,projectConversations,staged,subject,trackedTables} from './scope'

export interface ErasureRequest {projectId: string; contactId: string; actorId: string; now: number; emails: string[];csvIdentities?:string[]}

const count = (table: string, where: string) => `(SELECT count(*) FROM ${table} WHERE ${where})`
const sum = (parts: string[]) => parts.join('+')
const ACTIVE_LOCAL = "('queued','running','needs_input')"

/**
 * Operator assist options hold the operator's draft (`message`) and instruction text.
 * Only the fields ai-support/presentation.ts reads for a settled generation remain:
 * the editing tool and the client's request identity. `loading_message` is shown only
 * while a generation is queued or running, and erasure cancels those. A merge patch
 * drops the null members of fields that were never set.
 */
const generationOptions = `CASE WHEN json_valid(options_json) THEN json_patch('{}',json_object(
 'tool',json_extract(options_json,'$.tool'),
 'client_request_id',json_extract(options_json,'$.client_request_id'),
 'display_request_version',json_extract(options_json,'$.display_request_version'))) ELSE '{}' END`

/**
 * A message's local id is client-supplied free text unless the server minted it. Two
 * server ids stay because code reads them after erasure: the `email:<sha-256>` id an
 * inbound claim shares with its message (inbound-origin.ts, inbound-service.ts) and an
 * AI reply's `generation:<generation id>` (ai-support/recovery.ts). Every other id
 * becomes `erased:<message id>`: unique per conversation because message ids are, and
 * no client can hold it because admission reserves the prefix.
 */
const erasedLocalId = `CASE
 WHEN local_id GLOB 'email:*' AND length(local_id)=70 AND substr(local_id,7) NOT GLOB '*[^0-9a-f]*' THEN local_id
 WHEN actor_role='ai' AND EXISTS(SELECT 1 FROM ai_generations g WHERE g.conversation_id=messages.conversation_id AND messages.local_id='generation:'||g.id) THEN local_id
 ELSE 'erased:'||id END`

/**
 * The audit row is written first so its counts see the data before removal; the whole
 * batch is one D1 transaction. Repeated erasure adds only what was newly removed.
 */
const tombstone = `INSERT INTO contact_erasures(project_id,contact_id,erased_by,erased_at,last_erased_at,runs,conversations,messages,attachments,tracked_events,context_records,sessions,ticket_records)
SELECT ?1,?2,?3,?4,?4,1,
 ${count('conversations', 'project_id=?1 AND contact_id=?2')},
 ${count('messages', `${messages} AND erased_at IS NULL`)},
 ${count('contact_erasure_objects', 'project_id=?1 AND contact_id=?2')},
 ${sum(trackedTables.map(table => count(table, subject)))},
 ${sum(contextTables.map(table => count(table, subject)))},
 ${count('sessions', 'project_id=?1 AND contact_id=?2')},
 ${voiceErasureCount}+${triageErasureCount}+${customerErasureCount}+${ticketErasureCount}+(${collaborationRecordsCount})+${workflowErasureCount}+${problemErasureCount}+${reportTimerErasureCount}+${escalationErasureCount}
WHERE EXISTS(SELECT 1 FROM contacts WHERE project_id=?1 AND id=?2)
ON CONFLICT(project_id,contact_id) DO UPDATE SET last_erased_at=excluded.last_erased_at,runs=runs+1,conversations=excluded.conversations,
 messages=messages+excluded.messages,attachments=attachments+excluded.attachments,tracked_events=tracked_events+excluded.tracked_events,
 context_records=context_records+excluded.context_records,sessions=sessions+excluded.sessions,ticket_records=ticket_records+excluded.ticket_records`

/** Email delivery logs keep their idempotency identity; the recipient address is removed. */
function emailDeliveries(env: Env, request: Pick<ErasureRequest,'projectId'|'contactId'|'emails'>) {
  return env.DB.prepare(`UPDATE email_deliveries SET recipient='' WHERE project_id=?1 AND recipient<>'' AND (
   id IN (SELECT 'message:'||id||':notification' FROM messages WHERE ${messages}) OR lower(recipient) IN (SELECT value FROM json_each(?3)))`)
    .bind(request.projectId, request.contactId, JSON.stringify(request.emails))
}
export function emailEvidenceStatements(env:Env,request:Pick<ErasureRequest,'projectId'|'contactId'|'emails'>){return [emailDeliveries(env,request),...erasureInboundEvidenceStatements(env.DB,request)]}

export function erasureStatements(env: Env, request: ErasureRequest) {
  const {projectId, contactId, actorId, now} = request
  const iso = new Date(now).toISOString()
  const bound = (sql: string) => env.DB.prepare(sql).bind(projectId, contactId)
  const withTime = (sql: string, time: number | string) => env.DB.prepare(sql).bind(projectId, contactId, time)
  return [
    env.DB.prepare(tombstone).bind(projectId, contactId, actorId, now),
    ...voiceErasureStatements(env,projectId,contactId),
    ...escalationErasureStatements(env,projectId,contactId),
    ...collaborationRecordsStatements(env,projectId,contactId),
    ...workflowErasureStatements(env,projectId,contactId),
    ...problemErasureStatements(env,projectId,contactId),
    ...reportTimerErasureStatements(env,projectId,contactId),
    ...triageErasureStatements(env,projectId,contactId),
    ...ticketErasureStatements(env,projectId,contactId),
    ...emailErasureStatements(env,projectId,contactId,request.emails),
    ...eraseFormStatements(env,projectId,contactId),
    ...customerErasureStatements(env,projectId,contactId),
    ...csvCustomerErasureStatements(env,projectId,contactId,request.csvIdentities??request.emails),
    ...portalErasureStatements(env,projectId,contactId,request.emails),
    // Copies of the contact's data held outside the canonical rows, removed while those rows still identify them.
    bound(legacyArchiveRedaction),
    ...importErasureStatements(env,projectId,contactId),
    ...eraseSurveyStatements(env,projectId,contactId),
    ...['conversation_ratings','conversation_rating_history'].map(table=>bound(`UPDATE ${table} SET comment='' WHERE resolution_id IN (SELECT id FROM conversation_resolutions WHERE project_id=?1 AND (contact_id=?2 OR conversation_id IN (${conversations}))) AND comment<>''`)),
    env.DB.prepare(`DELETE FROM email_reply_grants WHERE project_id=?1 AND (conversation_id IN (${conversations}) OR lower(recipient) IN (SELECT value FROM json_each(?3)))`).bind(projectId,contactId,JSON.stringify(request.emails)),
    // Inbound email claims keep only the classifier's rule names; sender, subject and headers go.
    ...emailEvidenceStatements(env, request),
    // AI work on these conversations: stop active generations, keep usage accounting, remove generated text.
    bound(`UPDATE ai_attempt_events SET event_json=json_object('type',type,'erased',1) WHERE attempt_id IN (${attempts}) AND type<>'cost_update' AND event_json<>json_object('type',type,'erased',1)`),
    withTime(`UPDATE ai_generations SET state=CASE WHEN state IN ('queued','running') THEN 'cancelled' ELSE state END,instruction='',
     output_json=CASE WHEN json_valid(output_json) THEN json_remove(output_json,'$.result') ELSE NULL END,
     options_json=${generationOptions},updated_at=?3 WHERE id IN (${generations})`, iso),
    // Imported bucket summaries describe the conversation; bucket ids and times keep transcript grouping.
    bound(`UPDATE conversation_buckets SET metadata_json='{}' WHERE conversation_id IN (${conversations}) AND metadata_json<>'{}'`),
    // Delegated local work on these conversations: cancel active jobs and remove transcript context and results.
    bound(`UPDATE local_events SET payload='{}' WHERE job_id IN (${localJobs}) AND payload<>'{}'`),
    bound(`UPDATE local_result_effects SET payload='{}',state=CASE WHEN state='pending' THEN 'cancelled' ELSE state END WHERE job_id IN (${localJobs})`),
    bound(`UPDATE local_receipts SET review_message=NULL WHERE job_id IN (${localJobs}) AND review_message IS NOT NULL`),
    bound(`DELETE FROM local_attachment_grants WHERE attachment_id IN (${staged('local_attachment')})`),
    bound(`DELETE FROM local_attachments WHERE id IN (${staged('local_attachment')}) AND job_id IN (${localJobs})`),
    withTime(`UPDATE local_jobs SET instructions='',context=NULL,result=NULL,
     cancel_requested=CASE WHEN status IN ${ACTIVE_LOCAL} THEN 1 ELSE cancel_requested END,
     completed_at=CASE WHEN status IN ${ACTIVE_LOCAL} THEN ?3 ELSE completed_at END,
     status=CASE WHEN status IN ${ACTIVE_LOCAL} THEN 'cancelled' ELSE status END
     WHERE id IN (${localJobs})`, iso),
    // Transcript: message identity, revision and frontier stay; content, client local ids and attachments go.
    bound(`DELETE FROM media WHERE project_id=?1 AND id IN (${staged('media')})`),
    withTime(`UPDATE messages SET content='',intent_hash=NULL,local_id=${erasedLocalId},erased_at=?3 WHERE ${messages} AND erased_at IS NULL`, now),
    bound(`DELETE FROM conversation_notes WHERE conversation_id IN (${conversations})`),
    bound(`DELETE FROM conversation_participants WHERE contact_id=?2 AND conversation_id IN (${projectConversations})`),
    bound(`DELETE FROM conversation_reads WHERE user_id=?2 AND conversation_id IN (${projectConversations})`),
    // Widget identity: sessions and customer-context records derived from the contact's activity.
    bound('DELETE FROM sessions WHERE project_id=?1 AND contact_id=?2'),
    bound(`DELETE FROM context_job_events WHERE job_id IN (${contextJobs})`),
    ...[...trackedTables, ...contextTables].map(table => bound(`DELETE FROM ${table} WHERE ${subject}`)),
    bound(`UPDATE contacts SET name=NULL,email=NULL,external_id=NULL,is_verified=0,
     metadata_json=json_object('is_deleted',1,'is_blocked',1,'is_erased',1,'erased_at',(SELECT erased_at FROM contact_erasures WHERE project_id=?1 AND contact_id=?2))
     WHERE project_id=?1 AND id=?2`),
    bound(`UPDATE contacts SET name=NULL,email=NULL,external_id=NULL,is_verified=0,metadata_json=json_object('is_deleted',1,'is_blocked',1,'is_erased',1) WHERE project_id=?1 AND id IN (SELECT contact_id FROM mailbox_contact_aliases WHERE project_id=?1 AND canonical_id=?2)`),
    bound('DELETE FROM mailbox_contact_aliases WHERE project_id=?1 AND canonical_id=?2'),
    bound('DELETE FROM contact_erasure_objects WHERE project_id=?1 AND contact_id=?2'),
  ]
}
