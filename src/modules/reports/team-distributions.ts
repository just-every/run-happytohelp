import {firstMessagesSQL} from './read'
import {statement,type TeamReportContext} from './team-scope'
import {teamDimensionsSQL} from './team-workload'

export const dimensionKey=(dimension:string,id:string|null)=>JSON.stringify([dimension,id])
type Distribution={count:number;median:number|null;p90:number|null}
export async function teamDurations(context:TeamReportContext,metric:'response'|'resolution'){
 const value=metric==='response'?'m.created_at-f.created_at':'t.first_resolved_at-c.created_at'
 const joins=metric==='response'?firstMessagesSQL:'JOIN conversation_tracking t ON t.project_id=c.project_id AND t.conversation_id=c.id'
 const valid=metric==='response'?'m.created_at>=f.created_at':'t.first_resolved_at>=c.created_at'
 const {results}=await statement(context,`${teamDimensionsSQL()}, samples AS MATERIALIZED (
  SELECT c.id,${value} value FROM cohort c ${joins} WHERE ${valid}
 ), ranked AS (
  SELECT d.dimension,d.key,s.value,ROW_NUMBER() OVER(PARTITION BY d.dimension,d.key ORDER BY s.value) rank,
   COUNT(*) OVER(PARTITION BY d.dimension,d.key) n FROM dimensions d JOIN samples s ON s.id=d.conversation_id
 ) SELECT dimension,key id,COUNT(*) count,AVG(CASE WHEN rank IN ((n+1)/2,(n+2)/2) THEN value END) median,
  MAX(CASE WHEN rank=(9*n+9)/10 THEN value END) p90 FROM ranked GROUP BY dimension,key`).all<Distribution&{dimension:string;id:string|null}>()
 return new Map(results.map(({dimension,id,...row})=>[dimensionKey(dimension,id),row]))
}

type Service={metric:string;met:number;breached:number;pending:number}
export async function teamDimensionSla(context:TeamReportContext){
 const {results}=await statement(context,`${teamDimensionsSQL()}, clocks AS (
  SELECT c.id,json_extract(j.value,'$.metric') metric,json_extract(j.value,'$.completed_at') completed_at,
  CASE WHEN json_extract(j.value,'$.breached')=1 OR (json_extract(j.value,'$.completed_at') IS NULL AND json_extract(s.state_json,'$.pause_reason') IS NULL AND json_extract(s.state_json,'$.status') NOT IN ('solved','closed') AND json_extract(j.value,'$.due_at')<=?7) THEN 1 ELSE 0 END breached
  FROM cohort c JOIN ticket_sla_state s ON s.project_id=c.project_id AND s.conversation_id=c.id,json_each(s.state_json,'$.clocks') j
  WHERE json_extract(j.value,'$.metric') IN ('first_response','next_response','resolution')
 ) SELECT d.dimension,d.key id,s.metric,SUM(s.completed_at IS NOT NULL AND s.breached=0) met,SUM(s.breached) breached,
  SUM(s.completed_at IS NULL AND s.breached=0) pending FROM dimensions d JOIN clocks s ON s.id=d.conversation_id GROUP BY d.dimension,d.key,s.metric`)
 .bind(context.projectId,context.range.startAt,context.range.endAt,context.filters.teamId,context.filters.brandId,context.filters.includeImported?1:0,context.now).all<Service&{dimension:string;id:string|null}>()
 const services=new Map<string,Service[]>()
 for(const {dimension,id,...row} of results){const key=dimensionKey(dimension,id),rows=services.get(key)??[];rows.push(row);services.set(key,rows)}
 return services
}
