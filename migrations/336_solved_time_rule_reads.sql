-- The solved-at time-rule selector uses this exact expression to exclude every
-- other status. Seek only the due cohort before checking current authority and
-- eligibility; scanning all solved history grows even when no ticket is due.
-- Index only: retain ticket rows, cursor order and rule episode semantics.
CREATE INDEX conversations_solved_time_rule_due
ON conversations(project_id,(CASE WHEN status_category='solved' THEN resolved_at END),id);
