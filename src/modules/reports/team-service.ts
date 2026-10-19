import {statement,type TeamReportContext} from './team-scope'

type SlaRow={metric:string;met:number;breached:number;pending:number;total:number}
export async function teamSla(context:TeamReportContext){
 const bindings=[context.projectId,context.range.startAt,context.range.endAt,context.filters.teamId,context.filters.brandId,context.filters.includeImported?1:0,context.now]
 // R5 stores business-calendar due instants, completed cycles and pause state.
 // Reading an overdue active clock never mutates the workflow or assumes that
 // elapsed wall time equals business time. Completed clocks use their snapshot.
 const [cycles,coverage]=await Promise.all([
  statement(context,`, clocks AS (
   SELECT json_extract(j.value,'$.metric') metric,json_extract(j.value,'$.completed_at') completed_at,
   CASE WHEN json_extract(j.value,'$.breached')=1 OR (json_extract(j.value,'$.completed_at') IS NULL AND json_extract(s.state_json,'$.pause_reason') IS NULL AND json_extract(s.state_json,'$.status') NOT IN ('solved','closed') AND json_extract(j.value,'$.due_at')<=?7) THEN 1 ELSE 0 END breached
   FROM cohort c JOIN ticket_sla_state s ON s.project_id=c.project_id AND s.conversation_id=c.id,json_each(s.state_json,'$.clocks') j
   WHERE json_extract(j.value,'$.metric') IN ('first_response','next_response','resolution')
  ) SELECT metric,SUM(completed_at IS NOT NULL AND breached=0) met,SUM(breached) breached,SUM(completed_at IS NULL AND breached=0) pending,COUNT(*) total FROM clocks GROUP BY metric`).bind(...bindings).all<SlaRow>(),
  statement(context,`SELECT COUNT(*) tickets_with_snapshot,MIN(s.updated_at) oldest_snapshot_at,MAX(s.updated_at) newest_snapshot_at FROM cohort c JOIN ticket_sla_state s ON s.project_id=c.project_id AND s.conversation_id=c.id`).first<{tickets_with_snapshot:number;oldest_snapshot_at:number|null;newest_snapshot_at:number|null}>()
 ])
 const result=(metric:string)=>{const r=cycles.results.find(row=>row.metric===metric)??{met:0,breached:0,pending:0,total:0};const denominator=r.met+r.breached;return {met:r.met,breached:r.breached,pending:r.pending,total:r.total,denominator,rate:denominator?r.met/denominator:null}}
 return {first_response:result('first_response'),next_response:result('next_response'),resolution:result('resolution'),...coverage}
}

export async function teamReopens(context:TeamReportContext){
 const row=await statement(context,`, evidence AS (
 SELECT c.id,CASE WHEN c.resolved_at IS NOT NULL OR t.first_resolved_at IS NOT NULL OR EXISTS(SELECT 1 FROM ticket_history h WHERE h.project_id=c.project_id AND h.conversation_id=c.id AND (json_extract(h.changes_json,'$.status_category.to') IN ('solved','closed') OR json_extract(h.changes_json,'$.status_category.from') IN ('solved','closed'))) THEN 1 ELSE 0 END was_resolved,
 (SELECT COUNT(*) FROM ticket_history h WHERE h.project_id=c.project_id AND h.conversation_id=c.id AND json_extract(h.changes_json,'$.status_category.from') IN ('solved','closed') AND json_extract(h.changes_json,'$.status_category.to') IN ('new','open','pending','on_hold')) reopen_events,
 CASE WHEN c.imported=1 AND NOT EXISTS(SELECT 1 FROM ticket_history h WHERE h.project_id=c.project_id AND h.conversation_id=c.id) THEN 1 ELSE 0 END imported_without_native_history
 FROM cohort c LEFT JOIN conversation_tracking t ON t.project_id=c.project_id AND t.conversation_id=c.id
 ) SELECT COALESCE(SUM(was_resolved),0) resolved,COALESCE(SUM(was_resolved=1 AND imported_without_native_history=0),0) denominator,COALESCE(SUM(reopen_events>0),0) reopened,COALESCE(SUM(reopen_events),0) events,COALESCE(SUM(imported_without_native_history),0) imported_history_unknown FROM evidence`).first<{resolved:number;denominator:number;reopened:number;events:number;imported_history_unknown:number}>()
 return {...row!,rate:row!.denominator?row!.reopened/row!.denominator:null}
}
