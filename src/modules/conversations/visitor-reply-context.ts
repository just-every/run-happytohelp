import {customerMailboxHistorySql} from '../move-in/mailbox-privacy'

export interface VisitorReplyContext {id:string;inline_effects:0|1}

// Only a contact session's own conversation can supply reply context.
// Read it alongside that session so the widget send has one access read.
export const visitorReplyContextSql=`CASE WHEN s.role='contact' THEN (
 SELECT json_object('id',c.id,'inline_effects',
  EXISTS(SELECT 1 FROM conversation_ai WHERE conversation_id=c.id)
  OR EXISTS(SELECT 1 FROM triage_settings WHERE project_id=c.project_id AND enabled=1)
  OR EXISTS(SELECT 1 FROM workflow_rules WHERE project_id=c.project_id AND state='published' AND kind IN ('event','routing'))
  OR EXISTS(SELECT 1 FROM sla_policies WHERE project_id=c.project_id AND active=1))
 FROM conversations c WHERE c.id=? AND c.project_id=s.project_id AND c.contact_id=s.contact_id AND ${customerMailboxHistorySql()}
) END visitor_reply`
