import {customerMailboxHistorySql} from '../move-in/mailbox-privacy'

export interface VisitorReplyContext {id:string;inline_effects:0|1}

// Only a contact session's own conversation can supply reply context.
// Read it alongside that session so the widget send has one access read.
export const visitorReplyContextSql=`CASE WHEN s.role='contact' THEN (
 SELECT json_object('id',c.id,'inline_effects',
  EXISTS(SELECT 1 FROM conversation_ai WHERE conversation_id=c.id)
  OR EXISTS(SELECT 1 FROM triage_settings WHERE project_id=c.project_id AND enabled=1)
  OR EXISTS(SELECT 1 FROM workflow_rules WHERE project_id=c.project_id AND state='published' AND kind IN ('event','routing'))
  OR EXISTS(SELECT 1 FROM sla_policies WHERE project_id=c.project_id AND active=1)
  OR EXISTS(SELECT 1 FROM project_settings WHERE project_id=c.project_id AND (
   json_type(settings_json,'$.is_available')='false' OR json_extract(settings_json,'$.is_availability_schedule_enabled')=1))
  OR EXISTS(SELECT 1 FROM teammate_teams_consent WHERE project_id=c.project_id)
  OR EXISTS(SELECT 1 FROM teammate_slack_consent WHERE project_id=c.project_id)
  OR c.assigned_to IS NOT NULL OR c.group_id IS NOT NULL
  OR EXISTS(SELECT 1 FROM conversation_followers WHERE conversation_id=c.id))
 FROM conversations c WHERE c.id=? AND c.project_id=s.project_id AND c.contact_id=s.contact_id AND ${customerMailboxHistorySql()}
) END visitor_reply`
