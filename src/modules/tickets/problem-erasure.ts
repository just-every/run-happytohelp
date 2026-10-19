import type {Env} from '../../platform/env'
const owned='SELECT id FROM conversations WHERE project_id=?1 AND contact_id=?2'
const affected=`project_id=?1 AND (problem_id IN (${owned}) OR id IN (SELECT preview_id FROM ticket_problem_attempts WHERE project_id=?1 AND incident_id IN (${owned})) OR EXISTS(SELECT 1 FROM json_each(plan_json,'$.tickets') item WHERE json_extract(item.value,'$.destination.contact_id')=?2))`
export const problemErasureCount=`(SELECT count(*) FROM ticket_problem_previews WHERE state<>'erased' AND ${affected})+(SELECT count(*) FROM ticket_problem_attempts WHERE project_id=?1 AND state<>'erased' AND (incident_id IN (${owned}) OR problem_id IN (${owned}) OR preview_id IN (SELECT id FROM ticket_problem_previews WHERE ${affected})))+(SELECT count(*) FROM ticket_problem_incidents WHERE project_id=?1 AND (incident_id IN (${owned}) OR problem_id IN (${owned})))+(SELECT count(*) FROM ticket_problems WHERE project_id=?1 AND conversation_id IN (${owned}))`
/** Run before ordinary transcript redaction. Preserve attempt identity so erased
 * or interrupted sends can never become eligible for automatic replay. */
export function problemErasureStatements(env:Env,projectId:string,contactId:string){
 const statement=(sql:string)=>env.DB.prepare(sql).bind(projectId,contactId)
 return [
  statement(`UPDATE ticket_problem_previews SET plan_json='{"tickets":[]}',state='erased' WHERE ${affected}`),
  statement(`UPDATE ticket_problem_attempts SET state='erased',reason=NULL WHERE project_id=?1 AND (incident_id IN (${owned}) OR problem_id IN (${owned}) OR preview_id IN (SELECT id FROM ticket_problem_previews WHERE project_id=?1 AND state='erased'))`),
  statement(`DELETE FROM ticket_problem_incidents WHERE project_id=?1 AND (incident_id IN (${owned}) OR problem_id IN (${owned}))`),
  statement(`DELETE FROM ticket_problems WHERE project_id=?1 AND conversation_id IN (${owned})`),
 ]
}
