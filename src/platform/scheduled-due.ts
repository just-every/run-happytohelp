import type {Env} from './env'
import {workflowScopeSql,workflowDueBindings} from '../modules/workflows/scheduled-work'
import {recoveryDueSql} from './scheduled-recovery'
import {surveyWalkDueSql} from '../modules/outcomes/survey-walk-due'
import {reportDueSql} from '../modules/reports/schedule-due'
import {auditDueSql} from '../modules/audit/retention-due'
import {readyIntentSql} from '../modules/api-integrations/scheduling'
import {MAILGUN_CLAIM_RETENTION_MS} from '../modules/integrations/mailgun-window'
import {legacyMailS3Config} from '../modules/integrations/legacy-mail-s3/config'
import {teammateNoticeDueSql} from '../modules/integrations/teammate-notice-work'
import {emailConfigured} from '../modules/integrations/email-config'
import {surveySigningConfigured} from '../modules/outcomes/survey-links'
import {rerMail} from '../modules/integrations/rer-mail-contract'

const now='?6', consumerNow='?12', dbNow="CAST(unixepoch('subsec')*1000 AS INTEGER)"
const activeProject=(alias:string)=>`EXISTS(SELECT 1 FROM projects p WHERE p.id=${alias}.project_id
 AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=p.id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL))`
const intents=`JOIN native_integration_events e ON e.id=i.event_id AND e.project_id=i.project_id
 JOIN native_integration_destinations d ON d.id=i.destination_id AND d.project_id=i.project_id`

// Existence probes use the same active rows as the consumers. Effects stay in
// the original ordered pass: one consumer can produce work for the next.
// CASE stops discovery at the first due consumer.
const minuteWork=`SELECT 1 WHERE CASE
 WHEN (${workflowScopeSql}) IS NOT NULL THEN 1
 WHEN EXISTS(SELECT 1 FROM conversation_outbox o WHERE delivered_at IS NULL AND ${activeProject('o')}) THEN 1
 WHEN EXISTS(SELECT 1 FROM operator_notifications WHERE state='pending') THEN 1
 WHEN EXISTS(SELECT 1 FROM operator_notification_activity a JOIN conversations c ON c.id=a.conversation_id AND c.project_id=a.project_id
   WHERE a.batch_id IS NULL AND c.updated_at<=${consumerNow}-60000 AND NOT EXISTS(SELECT 1 FROM messages m WHERE m.conversation_id=c.id AND m.created_at>${consumerNow}-60000)) THEN 1
 WHEN EXISTS(SELECT 1 FROM notification_inbox WHERE state='sending' OR state='pending' OR (?8 AND state='awaiting_provider')) THEN 1
 WHEN EXISTS(${reportDueSql(consumerNow)}) THEN 1
 WHEN EXISTS(SELECT 1 ${auditDueSql(consumerNow)}) THEN 1
 WHEN EXISTS(SELECT 1 FROM widget_campaign_impressions WHERE created_at<${consumerNow}-2592000000) THEN 1
 WHEN EXISTS(SELECT 1 FROM widget_campaign_visits WHERE created_at<${consumerNow}-2592000000) THEN 1
 WHEN EXISTS(SELECT 1 FROM agent_door_calls WHERE expires_at<=${consumerNow}) THEN 1
 WHEN EXISTS(SELECT 1 FROM api_uploads WHERE expires_at<=${now}) THEN 1
 WHEN EXISTS(SELECT 1 FROM api_upload_disposals) THEN 1
 WHEN EXISTS(SELECT 1 FROM native_integration_intents i ${intents} WHERE i.prepared_at IS NULL AND ${readyIntentSql}) THEN 1
 WHEN EXISTS(SELECT 1 FROM integration_deliveries v JOIN native_integration_intents i ON i.id=v.id AND i.project_id=v.namespace ${intents}
   WHERE v.state IN ('queued','sending') AND (v.state='queued' AND v.next_at<=${now} OR v.state='sending' AND v.claim_until<=${now}) AND ${readyIntentSql}) THEN 1
 WHEN EXISTS(SELECT 1 FROM voice_calls WHERE media_expires_at<=${now} AND (recording_cipher IS NOT NULL OR transcript IS NOT NULL OR summary LIKE 'Transcript highlights%')) THEN 1
 WHEN EXISTS(SELECT 1 FROM ai_generations g WHERE state='queued' AND ${activeProject('g')} OR state='running' AND updated_at<?7) THEN 1
 WHEN EXISTS(SELECT 1 FROM ai_attempts a JOIN ai_generations g ON g.id=a.generation_id WHERE a.state='running' AND g.state NOT IN ('queued','running') AND (g.state='completed' OR g.updated_at<?7)) THEN 1
 WHEN EXISTS(SELECT 1 FROM followup_obligations o WHERE o.state='open' AND
   (o.due_at<=${now}+86400000 OR o.dependency_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM escalation_issues i JOIN escalation_deliveries d ON d.issue_id=i.id AND d.provider_updated_at=i.provider_updated_at WHERE i.id=o.dependency_id AND i.project_id=o.project_id AND d.received_at>=${now}-86400000))
   AND NOT EXISTS(SELECT 1 FROM notification_inbox n WHERE n.id='followup:'||o.id||':'||o.version)) THEN 1
 WHEN EXISTS(SELECT 1 FROM triage_jobs WHERE state='pending') THEN 1
 WHEN EXISTS(SELECT 1 FROM knowledge_upgrade_reports r LEFT JOIN knowledge_upgrade_progress p ON p.project_id=r.project_id
   WHERE r.completed_at IS NULL AND (p.queued_at IS NULL OR p.queued_at<=${now}-120000) AND (p.lease_token IS NULL OR p.lease_expires_at<=${now})) THEN 1
 WHEN EXISTS(SELECT 1 FROM knowledge_datasets d WHERE
   status='processing' AND coalesce(ingest_started_at,-1)<${now}-1200000
   OR (claim_token IS NOT NULL AND status IN ('ingesting','crawling') OR next_refresh_at<=${now} AND claim_token IS NULL AND source_input IS NOT NULL) AND ${activeProject('d')}) THEN 1
 WHEN EXISTS(SELECT 1 FROM knowledge_imports i WHERE status='processing' AND coalesce(processing_started_at,-1)<${now}-1200000 OR status='queued' AND ${activeProject('i')}) THEN 1
 WHEN (${recoveryDueSql(now)}) THEN 1
 WHEN EXISTS(SELECT 1 FROM lead_jobs WHERE state='queued' OR state='running' AND started_at<${now}-180000) THEN 1
 WHEN EXISTS(SELECT 1 FROM leads l WHERE status='processing' AND EXISTS(SELECT 1 FROM lead_jobs j WHERE j.lead_id=l.id AND j.state IN ('uncertain','failed'))) THEN 1
 WHEN EXISTS(SELECT 1 FROM email_deliveries WHERE state='sending' AND (+id GLOB 'message:*:notification' OR +id GLOB 'message:*:notification:*') AND updated_at<${now}-120000 AND error IS NOT 'Sending authority is being restored; this email will be sent again automatically') THEN 1
 WHEN EXISTS(SELECT 1 FROM mailgun_inbound_tokens WHERE received_at<${now}-${MAILGUN_CLAIM_RETENTION_MS}) THEN 1
 WHEN EXISTS(SELECT 1 FROM suspended_emails WHERE expires_at<=${now}) THEN 1
 WHEN EXISTS(SELECT 1 FROM mailbox_connections m WHERE m.status='connected' AND m.provider<>'forwarding'
   AND coalesce(json_extract(m.cursor_json,'$.mode'),'live')<>'history' AND (m.sync_lock_until IS NULL OR m.sync_lock_until<${now})
   AND (m.error_code IS NULL OR m.updated_at<=${now}-300000)
   AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=m.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL)) THEN 1
 WHEN (?9 AND (
   EXISTS(SELECT 1 FROM projects p WHERE NOT EXISTS(SELECT 1 FROM rer_mailboxes WHERE project_id=p.id)
    AND NOT EXISTS(SELECT 1 FROM project_settings WHERE project_id=p.id AND json_extract(settings_json,'$.deleted_at') IS NOT NULL))
   OR EXISTS(SELECT 1 FROM rer_mailbox_outbox WHERE state='pending' AND next_at<=${now} OR state='processing' AND claimed_at<${now}-60000)
   OR EXISTS(SELECT 1 FROM rer_mailboxes WHERE state='active' AND route_check_next_at<=${now})
   OR EXISTS(SELECT 1 FROM rer_mail_raw_objects r JOIN rer_mail_ingress i ON i.delivery_id=r.delivery_id
    WHERE (i.state='complete' AND i.updated_at<${now}-60000) OR i.updated_at<${now}-604800000))) THEN 1
 WHEN ?10 THEN 1
 WHEN EXISTS(SELECT 1 FROM legacy_mail_s3_receipts WHERE raw_key IS NOT NULL AND updated_at<${now}-60000 AND (state IN ('complete','held') OR updated_at<${now}-604800000)) THEN 1
 WHEN EXISTS(${surveyWalkDueSql(now)}) THEN 1
 -- Pending email invitations also need cancellation checks before their send slot.
 WHEN EXISTS(SELECT 1 FROM csat_surveys WHERE state='pending' AND channel='email') THEN 1
 WHEN EXISTS(SELECT 1 FROM csat_surveys survey WHERE state IN ('pending','sending')
  AND channel IN ('sms','whatsapp','instagram','messenger') AND (
   EXISTS(SELECT 1 FROM support_channel_sends d WHERE d.message_id='csat:'||survey.id)
   OR (?13 AND state='pending' AND due_at<=${now}))) THEN 1
 WHEN EXISTS(SELECT 1 FROM support_channel_sends WHERE state='sending' AND message_id LIKE 'csat:%') THEN 1
 WHEN EXISTS(${teammateNoticeDueSql('slack',consumerNow)}) THEN 1
 WHEN EXISTS(${teammateNoticeDueSql('teams',consumerNow)}) THEN 1
 WHEN NOT EXISTS(SELECT 1 FROM legacy_package_v1_inventory WHERE singleton=1 AND complete=1) THEN 1
 WHEN EXISTS(SELECT 1 FROM legacy_package_scope_fences WHERE cleanup_done=0) THEN 1
 WHEN EXISTS(SELECT 1 FROM legacy_package_custody WHERE status IN ('admitting','ready') AND expires_at<=${dbNow}) THEN 1
 WHEN EXISTS(SELECT 1 FROM legacy_package_custody WHERE status IN ('invalidated','purging','purged') AND next_cleanup_at<=${dbNow} AND (cleanup_until IS NULL OR cleanup_until<=${dbNow})) THEN 1
 WHEN EXISTS(SELECT 1 FROM legacy_import_worker_runs WHERE state IN ('queued','running') AND next_at<=${dbNow} AND (lease_until IS NULL OR lease_until<=${dbNow})) THEN 1
 WHEN (?11 AND EXISTS(SELECT 1 FROM abuse_counters WHERE expires_at<=${now})) THEN 1
 ELSE 0 END`

export async function hasScheduledWork(env:Env,at:number,workflowAt:number,maintenance:boolean,consumerAt:number){
 const managed=rerMail(env)
 // With external SES enabled, only listing the bucket can tell us if it has new objects.
 const ses=Boolean(legacyMailS3Config(env))
 return Boolean(await env.DB.prepare(minuteWork).bind(
  ...workflowDueBindings(workflowAt),at,new Date(at-240000).toISOString(),
  Number(emailConfigured(env)),Number(managed),Number(ses||managed&&maintenance),Number(maintenance),consumerAt,Number(surveySigningConfigured(env)),
 ).first())
}
