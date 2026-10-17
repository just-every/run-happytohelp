import type {Env} from '../../platform/env'

const owned='SELECT id FROM erasure_tickets'
const rules='SELECT id FROM erasure_rules'
const policies='SELECT id FROM erasure_policies'
const calendars='SELECT id FROM erasure_calendars'
const linked=`project_id=?1 AND conversation_id IN (${owned})`
// Share these sets once per statement. Expanding their UNIONs inside every
// counter/predicate exceeds D1's compound-SELECT limit even for an empty contact.
const containsIdentity=(expression:string)=>`EXISTS(SELECT 1 FROM erasure_identity identity WHERE identity.value<>'' AND instr(lower(${expression}),lower(identity.value))>0)`
const containsPersonal=(expression:string)=>`(EXISTS(SELECT 1 FROM erasure_values personal WHERE personal.value<>'' AND lower(${expression})=lower(personal.value)) OR ${containsIdentity(expression)})`
const personalJson=(expression:string)=>`EXISTS(SELECT 1 FROM json_tree(${expression}) j WHERE j.type='text' AND ${containsPersonal('j.atom')})`
const identityJson=(expression:string)=>`EXISTS(SELECT 1 FROM json_tree(${expression}) j WHERE j.type='text' AND ${containsIdentity('j.atom')})`
// Materialization also keeps each deletion's affected configuration set stable
// while SQLite removes dependent rows and immutable published versions.
const scope=`WITH
 erasure_tickets AS MATERIALIZED (SELECT id FROM conversations WHERE project_id=?1 AND contact_id=?2),
 erasure_identity AS MATERIALIZED (SELECT ?2 value UNION SELECT name FROM contacts WHERE project_id=?1 AND id=?2 UNION SELECT email FROM contacts WHERE project_id=?1 AND id=?2 UNION SELECT external_id FROM contacts WHERE project_id=?1 AND id=?2),
 erasure_values AS MATERIALIZED (SELECT value FROM erasure_identity UNION SELECT subject FROM conversations WHERE id IN (${owned}) UNION SELECT j.atom FROM contacts c,json_tree(c.metadata_json) j WHERE c.project_id=?1 AND c.id=?2 AND j.type='text' UNION SELECT j.atom FROM ticket_field_values f,json_tree(f.value_json) j WHERE f.project_id=?1 AND f.conversation_id IN (${owned}) AND j.type='text'),
 erasure_calendars AS MATERIALIZED (SELECT cal.id FROM workflow_calendars cal WHERE cal.project_id=?1 AND ${containsIdentity('cal.name')}),
 erasure_policies AS MATERIALIZED (SELECT sp.id FROM sla_policies sp WHERE sp.project_id=?1 AND (sp.calendar_id IN (${calendars}) OR ${containsIdentity('sp.name')} OR ${identityJson('sp.conditions_json')})),
 erasure_rules AS MATERIALIZED (SELECT r.id FROM workflow_rules r WHERE r.project_id=?1 AND (${containsPersonal('r.name')} OR ${personalJson('r.draft_json')} OR EXISTS(SELECT 1 FROM workflow_rule_versions v WHERE v.project_id=?1 AND v.rule_id=r.id AND ${personalJson('v.definition_json')})))`
const ruleLinked=`project_id=?1 AND (conversation_id IN (${owned}) OR rule_id IN (${rules}))`
const tables=[
 ['workflow_events',`${linked} OR (project_id=?1 AND (${personalJson('before_json')} OR ${personalJson('after_json')}))`],
 ['ticket_followups',`project_id=?1 AND (original_id IN (${owned}) OR conversation_id IN (${owned}))`],
 ['sla_alerts',`project_id=?1 AND (conversation_id IN (${owned}) OR policy_id IN (${policies}))`],
 ['ticket_sla_state',`project_id=?1 AND (conversation_id IN (${owned}) OR policy_id IN (${policies}) OR ${identityJson('policy_json')} OR ${identityJson('calendar_json')})`],
 ['workflow_runs',ruleLinked],['workflow_action_receipts',`${linked} OR (project_id=?1 AND ${personalJson('changes_json')})`],
 ['workflow_notifications',`${linked} OR (project_id=?1 AND ${containsPersonal("coalesce(message,'')||coalesce(detail,'')")})`],
 ['workflow_time_state',ruleLinked],['routing_decisions',`${linked} OR (project_id=?1 AND rule_id IN (${rules}))`],
 ['workflow_schedules',linked],
 ['workflow_rule_versions',`project_id=?1 AND rule_id IN (${rules})`],
 ['routing_state',`project_id=?1 AND rule_id IN (${rules})`],
 ['workflow_scheduler_cursors',`project_id=?1 AND rule_id IN (${rules})`],
 ['workflow_rules',`project_id=?1 AND id IN (${rules})`],
 ['routing_operators',`project_id=?1 AND ${identityJson('skills_json')}`],
 ['sla_policies',`project_id=?1 AND id IN (${policies})`],
 ['workflow_calendars',`project_id=?1 AND id IN (${calendars})`],
] as const

/** Included in the existing erasure receipt's ticket_records before any delete.
 * Count cascade children once using the same predicates as their parent delete. */
export const workflowErasureCount=`(${scope} SELECT sum(column1) FROM (VALUES ${tables.map(([table,where])=>`((SELECT count(*) FROM ${table} WHERE ${where}))`).join(',')}))`
export function workflowErasureStatements(env:Env,projectId:string,contactId:string){
 // Published versions still identify affected rules until the parent deletion.
 // Remove policies before calendars to respect their workspace-scoped FK.
 const cascaded=['workflow_rule_versions','routing_state','workflow_scheduler_cursors']
 return tables.filter(([table])=>!cascaded.includes(table)).map(([table,where])=>env.DB.prepare(`${scope} DELETE FROM ${table} WHERE ${where}`).bind(projectId,contactId))
}
