import {statement,type TeamReportContext} from './team-scope'
import {teamDimensionsSQL} from './team-workload'
import {teamDurations,teamDimensionSla,dimensionKey} from './team-distributions'
import {containmentEvidenceSQL,containmentClassificationSQL,containmentCounts,type Containment} from './team-containment'

type Dimension='agent'|'team'|'channel'|'brand'|'account'|'tag'
interface Breakdown {
 id:string|null;label:string;tickets:number
 firstResponse:{count:number;median:number|null;p90:number|null}
 firstResolution:{count:number;median:number|null;p90:number|null}
 recovery:{recovered:number;notRecovered:number;answered:number;unknown:number;rate:number|null}
 csat:{rated:number;positive:number;rate:number|null}
 reopens:{resolved:number;denominator:number;reopened:number;events:number;historyUnknown:number;rate:number|null}
 ai:{closed:number;handedOff:number;assignmentHandoffs:number;failed:number;uncertain:number;outcomeUnknown:number;containment:Containment}
 sla:Record<string,{met:number;breached:number;pending:number;denominator:number;rate:number|null}>
}

/** Reduce each source independently before joining it to dimensions. Joining raw
 * replies, cycles, ratings and clocks would multiply both counts and timings. */
export async function teamBreakdowns(context:TeamReportContext){
 const [counts,responses,resolutions,services]=await Promise.all([
  statement(context,`, raw_evidence AS MATERIALIZED (
 SELECT c.*,
 CASE WHEN c.resolved_at IS NOT NULL OR t.first_resolved_at IS NOT NULL OR EXISTS(SELECT 1 FROM ticket_history h WHERE h.project_id=c.project_id AND h.conversation_id=c.id AND (json_extract(h.changes_json,'$.status_category.to') IN ('solved','closed') OR json_extract(h.changes_json,'$.status_category.from') IN ('solved','closed'))) THEN 1 ELSE 0 END was_resolved,
 (SELECT COUNT(*) FROM ticket_history h WHERE h.project_id=c.project_id AND h.conversation_id=c.id AND json_extract(h.changes_json,'$.status_category.from') IN ('solved','closed') AND json_extract(h.changes_json,'$.status_category.to') IN ('new','open','pending','on_hold')) reopen_events,
 CASE WHEN c.imported=1 AND NOT EXISTS(SELECT 1 FROM ticket_history h WHERE h.project_id=c.project_id AND h.conversation_id=c.id AND json_extract(h.changes_json,'$.status_category.from') IS NOT json_extract(h.changes_json,'$.status_category.to') AND (json_extract(h.changes_json,'$.status_category.from') IN ('solved','closed') OR json_extract(h.changes_json,'$.status_category.to') IN ('solved','closed')) AND (h.actor_id IS NOT NULL OR h.source NOT IN ('legacy','import','move-in'))) THEN 1 ELSE 0 END history_unknown,
 COALESCE((SELECT COUNT(*) FROM conversation_handoffs h WHERE h.project_id=c.project_id AND h.conversation_id=c.id),0)>0 handoff,
 COALESCE((SELECT COUNT(*) FROM ai_handoff_receipts h WHERE h.project_id=c.project_id AND h.conversation_id=c.id),0)>0 ai_handoff,
 (SELECT COUNT(*) FROM ai_generations g WHERE g.project_id=c.project_id AND g.conversation_id=c.id AND g.state='failed') failed,
 (SELECT COUNT(*) FROM ai_generations g WHERE g.project_id=c.project_id AND g.conversation_id=c.id AND g.state IN ('uncertain','running')) uncertain,
 CASE WHEN c.status_category IN ('solved','closed') THEN r.outcome END outcome,
 CASE WHEN r.reopened_at IS NULL AND c.status_category IN ('solved','closed') AND COALESCE(json_extract(ct.metadata_json,'$.is_erased'),0)!=1 AND COALESCE(json_extract(ct.metadata_json,'$.is_erasing'),0)!=1 THEN COALESCE(v.recovery,'unknown') ELSE 'unknown' END recovery,
 COALESCE(v.scale,'thumbs') scale,COALESCE(v.score,legacy.value) score,
 ${containmentEvidenceSQL}
 FROM cohort c LEFT JOIN contacts ct ON ct.project_id=c.project_id AND ct.id=c.contact_id LEFT JOIN conversation_tracking t ON t.project_id=c.project_id AND t.conversation_id=c.id
 LEFT JOIN conversation_resolutions r ON r.project_id=c.project_id AND r.conversation_id=c.id AND r.ordinal=(SELECT MAX(ordinal) FROM conversation_resolutions WHERE project_id=c.project_id AND conversation_id=c.id)
 LEFT JOIN csat_responses v ON v.project_id=c.project_id AND v.resolution_id=r.id LEFT JOIN conversation_ratings legacy ON legacy.resolution_id=r.id
 ), evidence AS MATERIALIZED (SELECT *,${containmentClassificationSQL} containment FROM raw_evidence)
 ${teamDimensionsSQL('evidence',',c.was_resolved,c.history_unknown,c.reopen_events,c.recovery,c.score,c.scale,c.outcome,c.handoff,c.ai_handoff,c.failed,c.uncertain,c.containment')}
 SELECT d.dimension,d.key id,d.label,COUNT(*) tickets,
 SUM(d.was_resolved) resolved,COALESCE(SUM(d.was_resolved=1 AND d.history_unknown=0),0) reopenDenominator,SUM(d.reopen_events>0 AND d.history_unknown=0) reopened,SUM(d.reopen_events) reopenEvents,SUM(d.history_unknown) historyUnknown,
 SUM(d.recovery='recovered') recovered,SUM(d.recovery='not_recovered') notRecovered,SUM(d.recovery='unknown') recoveryUnknown,
 SUM(d.score IS NOT NULL) rated,COALESCE(SUM(d.scale='thumbs' AND d.score=1 OR d.scale='five' AND d.score>=4),0) positive,
 COALESCE(SUM(d.outcome='ai'),0) closed,COALESCE(SUM(d.handoff),0) assignmentHandoffs,COALESCE(SUM(d.ai_handoff),0) handedOff,COALESCE(SUM(d.failed),0) failed,COALESCE(SUM(d.uncertain),0) uncertain,COALESCE(SUM(d.outcome IS NULL OR d.outcome='unknown'),0) outcomeUnknown,
 SUM(d.containment='contained') contained,SUM(d.containment='not_contained') notContained,SUM(d.containment='unknown') containmentUnknown,SUM(d.containment='contained' AND d.recovery='recovered') confirmedContained
 FROM dimensions d GROUP BY d.dimension,d.key,d.label ORDER BY d.dimension,tickets DESC,d.label,d.key`)
 .all<any>(),
  teamDurations(context,'response'),teamDurations(context,'resolution'),teamDimensionSla(context)
 ])
 const breakdowns:Record<Dimension,Breakdown[]>={agent:[],team:[],channel:[],brand:[],account:[],tag:[]}
 for(const row of counts.results){
  const key=dimensionKey(row.dimension,row.id)
  const distribution=(values:Map<string,{count:number;median:number|null;p90:number|null}>)=>values.get(key)??{count:0,median:null,p90:null}
  const sla=services.get(key)??[]
  const service=Object.fromEntries(['first_response','next_response','resolution'].map(metric=>{const r=sla.find(r=>r.metric===metric)??{met:0,breached:0,pending:0},denominator=r.met+r.breached;return [metric,{met:r.met,breached:r.breached,pending:r.pending,denominator,rate:denominator?r.met/denominator:null}]}))
  breakdowns[row.dimension as Dimension].push({id:row.id,label:row.label,tickets:row.tickets,firstResponse:distribution(responses),firstResolution:distribution(resolutions),reopens:{resolved:row.resolved,denominator:row.reopenDenominator,reopened:row.reopened,events:row.reopenEvents,historyUnknown:row.historyUnknown,rate:row.reopenDenominator?row.reopened/row.reopenDenominator:null},recovery:{recovered:row.recovered,notRecovered:row.notRecovered,answered:row.recovered+row.notRecovered,unknown:row.recoveryUnknown,rate:row.recovered+row.notRecovered?row.recovered/(row.recovered+row.notRecovered):null},csat:{rated:row.rated,positive:row.positive,rate:row.rated?row.positive/row.rated:null},ai:{closed:row.closed,handedOff:row.handedOff,assignmentHandoffs:row.assignmentHandoffs,failed:row.failed,uncertain:row.uncertain,outcomeUnknown:row.outcomeUnknown,containment:containmentCounts(row)},sla:service})
 }
 return breakdowns
}
