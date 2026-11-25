/** A finished lap rests this long before the next, unless a policy or calendar changes first. */
export const SLA_BACKSTOP_REST=3600000
export const slaSettingsChanged=`EXISTS(SELECT 1 FROM sla_policies policy WHERE policy.project_id=p.id AND policy.updated_at>k.updated_at)
  OR EXISTS(SELECT 1 FROM workflow_calendars cal WHERE cal.project_id=p.id AND cal.updated_at>k.updated_at)`
/** Workspaces whose rolling lap is due: one is mid-lap, has never run, rested a full
 * interval, or changed a policy or calendar since its last page. `rested` is the rest cutoff. */
export const slaBackstopDueSql=(rested:string)=>`SELECT p.id FROM projects p LEFT JOIN sla_scheduler_cursors k ON k.id='tickets:'||p.id
 LEFT JOIN workflow_queue_turns q ON q.queue='sla-backstop' AND q.project_id=p.id
 WHERE (EXISTS(SELECT 1 FROM sla_policies policy WHERE policy.project_id=p.id AND policy.active=1) OR EXISTS(SELECT 1 FROM ticket_sla_state state WHERE state.project_id=p.id))
 AND (k.id IS NULL OR k.after_id<>'' OR k.updated_at<=${rested}
  OR ${slaSettingsChanged})`
