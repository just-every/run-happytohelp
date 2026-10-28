/** Ticket-level containment is stricter than the latest cycle's AI authorship.
 * Keep unknown work in the participating denominator rather than improving the
 * rate by dropping unfinished, failed or incompletely observed conversations. */
export const containmentEvidenceSQL = `
 EXISTS(SELECT 1 FROM ai_generations g WHERE g.project_id=c.project_id AND g.conversation_id=c.id AND g.kind='reply')
 OR EXISTS(SELECT 1 FROM messages m JOIN message_authorship a ON a.message_id=m.id AND a.project_id=m.project_id WHERE m.project_id=c.project_id AND m.conversation_id=c.id AND a.kind='ai' AND COALESCE(a.source_kind,'')<>'insight') ai_participated,
 EXISTS(SELECT 1 FROM messages m JOIN message_authorship a ON a.message_id=m.id AND a.project_id=m.project_id WHERE m.project_id=c.project_id AND m.conversation_id=c.id AND m.actor_role NOT IN ('contact','system') AND a.kind IN ('human','assisted') AND COALESCE(a.source_kind,'')<>'insight') human_answer,
 EXISTS(SELECT 1 FROM messages m LEFT JOIN message_authorship a ON a.message_id=m.id AND a.project_id=m.project_id WHERE m.project_id=c.project_id AND m.conversation_id=c.id AND m.actor_role NOT IN ('contact','system') AND COALESCE(a.kind,'unknown') NOT IN ('ai','human','assisted') AND COALESCE(a.source_kind,'')<>'insight') unknown_answer,
 EXISTS(SELECT 1 FROM ai_generations g WHERE g.project_id=c.project_id AND g.conversation_id=c.id AND g.kind='reply' AND g.state<>'completed') incomplete_ai,
 c.imported imported,t.initial_history_complete history_complete,
 COALESCE(json_extract(ct.metadata_json,'$.is_erased'),0)=1 OR COALESCE(json_extract(ct.metadata_json,'$.is_erasing'),0)=1 erased`

// These aliases belong to the independently reduced per-ticket evidence CTE.
export const containmentClassificationSQL = `CASE
 WHEN NOT (ai_participated OR ai_handoff) THEN 'excluded'
 WHEN erased THEN 'unknown'
 WHEN human_answer OR handoff OR ai_handoff OR reopen_events>0 THEN 'not_contained'
 WHEN imported=0 AND history_complete=1 AND outcome='ai' AND unknown_answer=0 AND incomplete_ai=0 THEN 'contained'
 ELSE 'unknown' END`

export function containmentCounts(row:{contained:number;notContained:number;containmentUnknown:number;confirmedContained:number}) {
 const {contained,notContained,containmentUnknown:unknown,confirmedContained:customerConfirmed}=row
 const denominator=contained+notContained+unknown
 return {contained,notContained,unknown,denominator,rate:denominator?contained/denominator:null,customerConfirmed}
}

export type Containment = ReturnType<typeof containmentCounts>

export const containmentRule = 'AI containment uses tickets with an admitted automatic reply generation, confirmed AI answer or causal AI handoff in the creation cohort. Contained requires current AI-only closure, complete native history, no human/assisted answer, assignment handoff, reopen, unknown answer or unfinished/noncompleted automatic generation anywhere in the ticket. Observed human help, handoff or reopening is not contained. Other participating tickets, including open, failed, uncertain, erased and incomplete histories, remain unknown. Rate is contained / all participating tickets, including unknowns; no participation gives no rate. Customer-confirmed counts only contained tickets with explicit current-cycle recovery; containment alone is not verified customer resolution.'
