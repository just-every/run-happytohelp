import {statement,type TeamReportContext} from './team-scope'
import {teamDimensionsSQL} from './team-workload'

type Dimension='agent'|'team'|'channel'|'brand'|'account'|'tag'
interface Breakdown {
 id:string|null;label:string;tickets:number
 firstResponse:{count:number;median:number|null;p90:number|null}
 firstResolution:{count:number;median:number|null;p90:number|null}
 csat:{rated:number;positive:number;rate:number|null}
 reopens:{resolved:number;denominator:number;reopened:number;events:number;historyUnknown:number;rate:number|null}
 ai:{closed:number;handedOff:number;assignmentHandoffs:number;failed:number;uncertain:number;outcomeUnknown:number}
 sla:Record<string,{met:number;breached:number;pending:number;denominator:number;rate:number|null}>
}

/** Reduce each source independently before joining it to dimensions. Joining raw
 * replies, cycles, ratings and clocks would multiply both counts and timings. */
export async function teamBreakdowns(context:TeamReportContext){
 const {results}=await statement(context,`${teamDimensionsSQL},
 visitors AS (SELECT m.conversation_id,MIN(m.revision) revision FROM messages m JOIN cohort c ON c.id=m.conversation_id AND c.project_id=m.project_id WHERE m.actor_role='contact' GROUP BY m.conversation_id),
 replies AS (SELECT m.conversation_id,MIN(m.revision) revision FROM messages m JOIN visitors v ON v.conversation_id=m.conversation_id AND m.revision>v.revision LEFT JOIN message_authorship a ON a.message_id=m.id WHERE m.actor_role NOT IN ('contact','system') AND COALESCE(a.source_kind,'')<>'insight' GROUP BY m.conversation_id),
 evidence AS (
 SELECT c.id,c.created_at,
 CASE WHEN c.resolved_at IS NOT NULL OR t.first_resolved_at IS NOT NULL OR EXISTS(SELECT 1 FROM ticket_history h WHERE h.project_id=c.project_id AND h.conversation_id=c.id AND (json_extract(h.changes_json,'$.status_category.to') IN ('solved','closed') OR json_extract(h.changes_json,'$.status_category.from') IN ('solved','closed'))) THEN 1 ELSE 0 END was_resolved,
 (SELECT COUNT(*) FROM ticket_history h WHERE h.project_id=c.project_id AND h.conversation_id=c.id AND json_extract(h.changes_json,'$.status_category.from') IN ('solved','closed') AND json_extract(h.changes_json,'$.status_category.to') IN ('new','open','pending','on_hold')) reopen_events,
 CASE WHEN c.imported=1 AND NOT EXISTS(SELECT 1 FROM ticket_history h WHERE h.project_id=c.project_id AND h.conversation_id=c.id AND json_extract(h.changes_json,'$.status_category.from') IS NOT json_extract(h.changes_json,'$.status_category.to') AND (json_extract(h.changes_json,'$.status_category.from') IN ('solved','closed') OR json_extract(h.changes_json,'$.status_category.to') IN ('solved','closed')) AND (h.actor_id IS NOT NULL OR h.source NOT IN ('legacy','import','move-in'))) THEN 1 ELSE 0 END history_unknown,
 CASE WHEN answer.created_at>=question.created_at THEN answer.created_at-question.created_at END response_ms,
 CASE WHEN t.first_resolved_at>=c.created_at THEN t.first_resolved_at-c.created_at END resolution_ms,
 COALESCE((SELECT COUNT(*) FROM conversation_handoffs h WHERE h.project_id=c.project_id AND h.conversation_id=c.id),0)>0 handoff,
 COALESCE((SELECT COUNT(*) FROM ai_handoff_receipts h WHERE h.project_id=c.project_id AND h.conversation_id=c.id),0)>0 ai_handoff,
 (SELECT COUNT(*) FROM ai_generations g WHERE g.project_id=c.project_id AND g.conversation_id=c.id AND g.state='failed') failed,
 (SELECT COUNT(*) FROM ai_generations g WHERE g.project_id=c.project_id AND g.conversation_id=c.id AND g.state IN ('uncertain','running')) uncertain,
 CASE WHEN c.status_category IN ('solved','closed') THEN r.outcome END outcome,
 COALESCE(v.scale,'thumbs') scale,COALESCE(v.score,legacy.value) score
 FROM cohort c LEFT JOIN visitors q ON q.conversation_id=c.id LEFT JOIN messages question ON question.project_id=c.project_id AND question.conversation_id=c.id AND question.revision=q.revision
 LEFT JOIN replies a ON a.conversation_id=c.id LEFT JOIN messages answer ON answer.project_id=c.project_id AND answer.conversation_id=c.id AND answer.revision=a.revision
 LEFT JOIN conversation_tracking t ON t.project_id=c.project_id AND t.conversation_id=c.id
 LEFT JOIN conversation_resolutions r ON r.project_id=c.project_id AND r.conversation_id=c.id AND r.ordinal=(SELECT MAX(ordinal) FROM conversation_resolutions WHERE project_id=c.project_id AND conversation_id=c.id)
 LEFT JOIN csat_responses v ON v.project_id=c.project_id AND v.resolution_id=r.id LEFT JOIN conversation_ratings legacy ON legacy.resolution_id=r.id
 ), samples AS (
 SELECT d.dimension,d.key,d.label,'response' metric,e.response_ms value FROM dimensions d JOIN evidence e ON e.id=d.conversation_id WHERE e.response_ms IS NOT NULL
 UNION ALL SELECT d.dimension,d.key,d.label,'resolution',e.resolution_ms FROM dimensions d JOIN evidence e ON e.id=d.conversation_id WHERE e.resolution_ms IS NOT NULL
 ), ranked AS (SELECT *,ROW_NUMBER() OVER(PARTITION BY dimension,key,metric ORDER BY value) rank,COUNT(*) OVER(PARTITION BY dimension,key,metric) n FROM samples),
 distributions AS (SELECT dimension,key,metric,COUNT(*) count,AVG(CASE WHEN rank IN ((n+1)/2,(n+2)/2) THEN value END) median,MAX(CASE WHEN rank=(9*n+9)/10 THEN value END) p90 FROM ranked GROUP BY dimension,key,metric),
 clocks AS (
 SELECT d.dimension,d.key,json_extract(j.value,'$.metric') metric,json_extract(j.value,'$.completed_at') completed_at,
 CASE WHEN json_extract(j.value,'$.breached')=1 OR (json_extract(j.value,'$.completed_at') IS NULL AND json_extract(s.state_json,'$.pause_reason') IS NULL AND json_extract(s.state_json,'$.status') NOT IN ('solved','closed') AND json_extract(j.value,'$.due_at')<=?7) THEN 1 ELSE 0 END breached
 FROM dimensions d JOIN cohort c ON c.id=d.conversation_id JOIN ticket_sla_state s ON s.project_id=c.project_id AND s.conversation_id=c.id,json_each(s.state_json,'$.clocks') j
 WHERE json_extract(j.value,'$.metric') IN ('first_response','next_response','resolution')
 ), service AS (SELECT dimension,key,metric,SUM(completed_at IS NOT NULL AND breached=0) met,SUM(breached) breached,SUM(completed_at IS NULL AND breached=0) pending FROM clocks GROUP BY dimension,key,metric)
 SELECT d.dimension,d.key id,d.label,COUNT(*) tickets,
 SUM(e.was_resolved) resolved,COALESCE(SUM(e.was_resolved=1 AND e.history_unknown=0),0) reopenDenominator,SUM(e.reopen_events>0 AND e.history_unknown=0) reopened,SUM(e.reopen_events) reopenEvents,SUM(e.history_unknown) historyUnknown,
 SUM(e.score IS NOT NULL) rated,COALESCE(SUM(e.scale='thumbs' AND e.score=1 OR e.scale='five' AND e.score>=4),0) positive,
 COALESCE(SUM(e.outcome='ai'),0) closed,COALESCE(SUM(e.handoff),0) assignmentHandoffs,COALESCE(SUM(e.ai_handoff),0) handedOff,COALESCE(SUM(e.failed),0) failed,COALESCE(SUM(e.uncertain),0) uncertain,COALESCE(SUM(e.outcome IS NULL OR e.outcome='unknown'),0) outcomeUnknown,
 (SELECT json_group_array(json_object('metric',metric,'count',count,'median',median,'p90',p90)) FROM distributions s WHERE s.dimension=d.dimension AND s.key IS d.key) durations,
 (SELECT json_group_array(json_object('metric',metric,'met',met,'breached',breached,'pending',pending)) FROM service s WHERE s.dimension=d.dimension AND s.key IS d.key) sla
 FROM dimensions d JOIN evidence e ON e.id=d.conversation_id GROUP BY d.dimension,d.key,d.label ORDER BY d.dimension,tickets DESC,d.label,d.key`)
 .bind(context.projectId,context.range.startAt,context.range.endAt,context.filters.teamId,context.filters.brandId,context.filters.includeImported?1:0,context.now).all<any>()
 const breakdowns:Record<Dimension,Breakdown[]>={agent:[],team:[],channel:[],brand:[],account:[],tag:[]}
 for(const row of results){
  const durations=JSON.parse(row.durations),sla=JSON.parse(row.sla)
  const distribution=(metric:string)=>{const r=durations.find((r:any)=>r.metric===metric);return r?{count:r.count,median:r.median,p90:r.p90}:{count:0,median:null,p90:null}}
  const service=Object.fromEntries(['first_response','next_response','resolution'].map(metric=>{const r=sla.find((r:any)=>r.metric===metric)??{met:0,breached:0,pending:0},denominator=r.met+r.breached;return [metric,{met:r.met,breached:r.breached,pending:r.pending,denominator,rate:denominator?r.met/denominator:null}]}))
  breakdowns[row.dimension as Dimension].push({id:row.id,label:row.label,tickets:row.tickets,firstResponse:distribution('response'),firstResolution:distribution('resolution'),reopens:{resolved:row.resolved,denominator:row.reopenDenominator,reopened:row.reopened,events:row.reopenEvents,historyUnknown:row.historyUnknown,rate:row.reopenDenominator?row.reopened/row.reopenDenominator:null},csat:{rated:row.rated,positive:row.positive,rate:row.rated?row.positive/row.rated:null},ai:{closed:row.closed,handedOff:row.handedOff,assignmentHandoffs:row.assignmentHandoffs,failed:row.failed,uncertain:row.uncertain,outcomeUnknown:row.outcomeUnknown},sla:service})
 }
 return breakdowns
}
