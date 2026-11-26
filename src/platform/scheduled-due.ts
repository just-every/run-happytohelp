import type {Env} from './env'
import {workflowScopeSql,workflowDueBindings} from '../modules/workflows/scheduled-work'
import {expiredCounterSql,recoveryDueSql} from './scheduled-recovery'
import {maintenanceDueSql} from './scheduled-maintenance-due'
import {surveyWalkDueSql} from '../modules/outcomes/survey-walk-due'
import {reportDueSql} from '../modules/reports/schedule-due'
import {readyIntentSql} from '../modules/api-integrations/scheduling'
import {legacyMailS3Config} from '../modules/integrations/legacy-mail-s3/config'
import {teammateNoticeDueSql} from '../modules/integrations/teammate-notice-work'
import {emailConfigured} from '../modules/integrations/email-config'
import {surveySigningConfigured} from '../modules/outcomes/survey-links'
import {rerMail} from '../modules/integrations/rer-mail-contract'

const now='?6'
const intents=`JOIN native_integration_events e ON e.id=i.event_id AND e.project_id=i.project_id
 JOIN native_integration_destinations d ON d.id=i.destination_id AND d.project_id=i.project_id`

// Existence probes use the same active rows as the consumers. Effects stay in
// the original ordered pass: one consumer can produce work for the next.
// CASE stops discovery at the first due consumer.
// Queue candidates share the same active workspace check. Stale running claims
// need recovery even after their project is deleted.
const projectJobs=`SELECT 1 FROM (
 SELECT o.project_id FROM conversation_outbox o WHERE o.delivered_at IS NULL
 UNION ALL SELECT CASE WHEN state='queued' THEN project_id END FROM ai_generations
  WHERE state='queued' OR state='running' AND updated_at<?7
 UNION ALL SELECT CASE WHEN status='processing' AND coalesce(ingest_started_at,-1)<${now}-1200000 THEN NULL ELSE project_id END FROM knowledge_datasets
  WHERE status='processing' AND coalesce(ingest_started_at,-1)<${now}-1200000
   OR claim_token IS NOT NULL AND status IN ('ingesting','crawling')
   OR next_refresh_at<=${now} AND claim_token IS NULL AND source_input IS NOT NULL
 UNION ALL SELECT CASE WHEN status='queued' THEN project_id END FROM knowledge_imports
  WHERE status='processing' AND coalesce(processing_started_at,-1)<${now}-1200000 OR status='queued'
) jobs WHERE jobs.project_id IS NULL OR EXISTS(SELECT 1 FROM projects p WHERE p.id=jobs.project_id
 AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=p.id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL))`

const minuteWork=(maintenance:string)=>`SELECT coalesce((${workflowScopeSql}),CASE
 WHEN EXISTS(${projectJobs}) THEN 1
 WHEN EXISTS(SELECT 1 FROM operator_notifications WHERE state='pending') THEN 1
 WHEN EXISTS(SELECT 1 FROM operator_notification_activity a JOIN conversations c ON c.id=a.conversation_id AND c.project_id=a.project_id
   WHERE a.batch_id IS NULL AND c.updated_at<=${now}-60000 AND NOT EXISTS(SELECT 1 FROM messages m WHERE m.conversation_id=c.id AND m.created_at>${now}-60000)) THEN 1
 WHEN EXISTS(SELECT 1 FROM notification_inbox WHERE state='sending' OR state='pending' OR (?8 AND state='awaiting_provider')) THEN 1
 WHEN EXISTS(${reportDueSql(now)}) THEN 1
 WHEN EXISTS(SELECT 1 FROM (
  SELECT i.id,i.project_id,i.event_id,i.destination_id FROM native_integration_intents i WHERE i.prepared_at IS NULL
  UNION ALL SELECT i.id,i.project_id,i.event_id,i.destination_id FROM integration_deliveries v
   JOIN native_integration_intents i ON i.id=v.id AND i.project_id=v.namespace
   WHERE v.state IN ('queued','sending') AND (v.state='queued' AND v.next_at<=${now} OR v.state='sending' AND v.claim_until<=${now})
 ) i ${intents} WHERE ${readyIntentSql}) THEN 1
 WHEN EXISTS(SELECT 1 FROM ai_attempts a JOIN ai_generations g ON g.id=a.generation_id WHERE a.state='running' AND g.state NOT IN ('queued','running') AND (g.state='completed' OR g.updated_at<?7)) THEN 1
 WHEN EXISTS(SELECT 1 FROM followup_obligations o WHERE o.state='open' AND
   (o.due_at<=${now}+86400000 OR o.dependency_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM escalation_issues i JOIN escalation_deliveries d ON d.issue_id=i.id AND d.provider_updated_at=i.provider_updated_at WHERE i.id=o.dependency_id AND i.project_id=o.project_id AND d.received_at>=${now}-86400000))
   AND NOT EXISTS(SELECT 1 FROM notification_inbox n WHERE n.id='followup:'||o.id||':'||o.version)) THEN 1
 WHEN EXISTS(SELECT 1 FROM triage_jobs WHERE state='pending') THEN 1
 WHEN EXISTS(SELECT 1 FROM knowledge_upgrade_reports r LEFT JOIN knowledge_upgrade_progress p ON p.project_id=r.project_id
   WHERE r.completed_at IS NULL AND (p.queued_at IS NULL OR p.queued_at<=${now}-120000) AND (p.lease_token IS NULL OR p.lease_expires_at<=${now})) THEN 1
 WHEN (${recoveryDueSql(now)}) THEN 1
 WHEN EXISTS(SELECT 1 FROM email_deliveries WHERE state='sending' AND (+id GLOB 'message:*:notification' OR +id GLOB 'message:*:notification:*') AND updated_at<${now}-120000 AND error IS NOT 'Sending authority is being restored; this email will be sent again automatically') THEN 1
 WHEN EXISTS(SELECT 1 FROM mailbox_connections m WHERE m.status='connected' AND m.provider<>'forwarding'
   AND coalesce(json_extract(m.cursor_json,'$.mode'),'live')<>'history' AND (m.sync_lock_until IS NULL OR m.sync_lock_until<${now})
   AND (m.error_code IS NULL OR m.updated_at<=${now}-300000)
   AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=m.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL)) THEN 1
 WHEN (?9 AND (
   EXISTS(SELECT 1 FROM projects p WHERE NOT EXISTS(SELECT 1 FROM rer_mailboxes WHERE project_id=p.id)
    AND NOT EXISTS(SELECT 1 FROM project_settings WHERE project_id=p.id AND json_extract(settings_json,'$.deleted_at') IS NOT NULL))
   OR EXISTS(SELECT 1 FROM rer_mailbox_outbox WHERE state='pending' AND next_at<=${now} OR state='processing' AND claimed_at<${now}-60000)
   OR EXISTS(SELECT 1 FROM rer_mailboxes WHERE state='active' AND route_check_next_at<=${now}))) THEN 1
 WHEN ?10 THEN 1
 WHEN EXISTS(${surveyWalkDueSql(now)}) THEN 1
 -- Pending email invitations also need cancellation checks before their send slot.
 WHEN EXISTS(SELECT 1 FROM csat_surveys WHERE state='pending' AND channel='email') THEN 1
 WHEN EXISTS(SELECT 1 FROM csat_surveys survey WHERE state IN ('pending','sending')
  AND channel IN ('sms','whatsapp','instagram','messenger') AND (
   EXISTS(SELECT 1 FROM support_channel_sends d WHERE d.message_id='csat:'||survey.id)
   OR (?11 AND state='pending' AND due_at<=${now}))) THEN 1
 WHEN EXISTS(SELECT 1 FROM support_channel_sends WHERE state='sending' AND message_id LIKE 'csat:%') THEN 1
 WHEN EXISTS(${teammateNoticeDueSql('slack',now)}) THEN 1
 WHEN EXISTS(${teammateNoticeDueSql('teams',now)}) THEN 1
 ${maintenance}
 ELSE 0 END) AS work, EXISTS(SELECT 1 FROM abuse_counters WHERE ${expiredCounterSql(now)}) AS counters`
const queries=maintenanceDueSql(now).map(minuteWork)

export async function scheduledWork(env:Env,at:number,workflowAt:number,minute:number){
 // With external SES enabled, only listing the bucket can tell us if it has new objects.
 const ses=Boolean(legacyMailS3Config(env))
 return (await env.DB.prepare(queries[minute%queries.length]!).bind(
  ...workflowDueBindings(workflowAt),at,new Date(at-240000).toISOString(),
  Number(emailConfigured(env)),Number(rerMail(env)),Number(ses),Number(surveySigningConfigured(env)),
 ).first<{work:0|1|'all'|'time';counters:number}>())!
}
