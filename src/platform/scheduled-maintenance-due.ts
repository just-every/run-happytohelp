import {auditDueSql} from '../modules/audit/retention-due'
import {MAILGUN_CLAIM_RETENTION_MS} from '../modules/integrations/mailgun-window'

const dbNow="CAST(unixepoch('subsec')*1000 AS INTEGER)"

// An idle tick looks for one group of housekeeping and recovery work. Rotate
// the groups so every query stays within D1's table-reference budget. The usual
// queue and request paths still hand off urgent work immediately.
export const maintenanceDueSql=(now:string)=>[
 `WHEN EXISTS(SELECT 1 ${auditDueSql(now)}) THEN 1
  WHEN EXISTS(SELECT 1 FROM widget_campaign_impressions WHERE created_at<${now}-2592000000) THEN 1
  WHEN EXISTS(SELECT 1 FROM widget_campaign_visits WHERE created_at<${now}-2592000000) THEN 1
  WHEN EXISTS(SELECT 1 FROM agent_door_calls WHERE expires_at<=${now}) THEN 1
  WHEN EXISTS(SELECT 1 FROM voice_calls WHERE media_expires_at<=${now} AND (recording_cipher IS NOT NULL OR transcript IS NOT NULL OR summary LIKE 'Transcript highlights%')) THEN 1`,
 `WHEN EXISTS(SELECT 1 FROM api_uploads WHERE expires_at<=${now}) THEN 1
  WHEN EXISTS(SELECT 1 FROM api_upload_disposals) THEN 1
  WHEN EXISTS(SELECT 1 FROM mailgun_inbound_tokens WHERE received_at<${now}-${MAILGUN_CLAIM_RETENTION_MS}) THEN 1
  WHEN EXISTS(SELECT 1 FROM suspended_emails WHERE expires_at<=${now}) THEN 1
  WHEN (?9 AND EXISTS(SELECT 1 FROM rer_mail_raw_objects r JOIN rer_mail_ingress i ON i.delivery_id=r.delivery_id
   WHERE (i.state='complete' AND i.updated_at<${now}-60000) OR i.updated_at<${now}-604800000)) THEN 1
  WHEN EXISTS(SELECT 1 FROM legacy_mail_s3_receipts WHERE raw_key IS NOT NULL AND updated_at<${now}-60000 AND (state IN ('complete','held') OR updated_at<${now}-604800000)) THEN 1`,
 `WHEN NOT EXISTS(SELECT 1 FROM legacy_package_v1_inventory WHERE singleton=1 AND complete=1) THEN 1
  WHEN EXISTS(SELECT 1 FROM legacy_package_scope_fences WHERE cleanup_done=0) THEN 1
  WHEN EXISTS(SELECT 1 FROM legacy_package_custody WHERE status IN ('admitting','ready') AND expires_at<=${dbNow}) THEN 1
  WHEN EXISTS(SELECT 1 FROM legacy_package_custody WHERE status IN ('invalidated','purging','purged') AND next_cleanup_at<=${dbNow} AND (cleanup_until IS NULL OR cleanup_until<=${dbNow})) THEN 1
  WHEN EXISTS(SELECT 1 FROM legacy_import_worker_runs WHERE state IN ('queued','running') AND next_at<=${dbNow} AND (lease_until IS NULL OR lease_until<=${dbNow})) THEN 1`,
 `WHEN EXISTS(SELECT 1 FROM lead_jobs WHERE state='queued' OR state='running' AND started_at<${now}-180000) THEN 1
  WHEN EXISTS(SELECT 1 FROM leads l WHERE status='processing' AND EXISTS(SELECT 1 FROM lead_jobs j WHERE j.lead_id=l.id AND j.state IN ('uncertain','failed'))) THEN 1`,
]
