import {statement,type TeamReportContext} from './team-scope'

type HandleRow={dimension:'agent'|'form'|'intent';id:string|null;label:string;duration_ms:number;sessions:number}
export async function teamHandleTime(context:TeamReportContext){
 // Attribute all work performed in the interval, including older tickets. The
 // session owner is the agent who did the work, regardless of later assignment.
 const {results}=await statement(context,`, sessions AS (
 SELECT s.id,s.user_id,s.conversation_id,
 CASE WHEN s.adjusted_duration_ms IS NULL THEN MAX(0,MIN(COALESCE(s.ended_at,?7),?3,?7)-MAX(s.started_at,?2))
 WHEN s.ended_at=s.started_at THEN CASE WHEN s.started_at>=?2 AND s.started_at<?3 THEN s.adjusted_duration_ms ELSE 0 END
 ELSE s.adjusted_duration_ms*1.0*MAX(0,MIN(s.ended_at,?3,?7)-MAX(s.started_at,?2))/(s.ended_at-s.started_at) END duration_ms
 FROM ticket_handle_sessions s JOIN scoped c ON c.project_id=s.project_id AND c.id=s.conversation_id
 WHERE s.started_at<?3 AND s.started_at<=?7 AND (COALESCE(s.ended_at,?7)>?2 OR (s.ended_at=s.started_at AND s.started_at>=?2))
 ), dimensions AS (
 SELECT s.id session_id,'agent' dimension,s.user_id key,COALESCE(u.name,s.user_id) label,s.duration_ms FROM sessions s LEFT JOIN users u ON u.id=s.user_id
 UNION ALL SELECT s.id,'form',f.form_id,COALESCE(json_extract(r.config_json,'$.name'),json_extract(r.config_json,'$.title'),f.form_id,'No form'),s.duration_ms FROM sessions s LEFT JOIN request_form_submissions f ON f.project_id=?1 AND f.conversation_id=s.conversation_id LEFT JOIN request_forms r ON r.project_id=f.project_id AND r.id=f.form_id
 UNION ALL SELECT s.id,'intent',CAST(json_extract(v.value_json,'$') AS TEXT),COALESCE(CAST(json_extract(v.value_json,'$') AS TEXT),'Unknown intent'),s.duration_ms FROM sessions s
 LEFT JOIN ticket_field_values v ON v.project_id=?1 AND v.conversation_id=s.conversation_id AND v.field_id=(SELECT f.id FROM ticket_fields f WHERE f.project_id=?1 AND lower(trim(f.name))='intent' AND (json_array_length(f.read_roles_json)=0 OR EXISTS(SELECT 1 FROM json_each(f.read_roles_json) allowed WHERE allowed.value=?8)) ORDER BY f.id LIMIT 1)
 ) SELECT dimension,key id,label,SUM(duration_ms) duration_ms,COUNT(*) sessions FROM dimensions GROUP BY dimension,key,label ORDER BY dimension,duration_ms DESC,label,key`).bind(context.projectId,context.range.startAt,context.range.endAt,context.filters.teamId,context.filters.brandId,context.filters.includeImported?1:0,context.now,context.accessRole,context.userId).all<HandleRow>()
 const byAgent:Omit<HandleRow,'dimension'>[]=[],byForm:Omit<HandleRow,'dimension'>[]=[],byIntent:Omit<HandleRow,'dimension'>[]=[]
 for(const {dimension,...row} of results)({agent:byAgent,form:byForm,intent:byIntent})[dimension].push(row)
 return {total_ms:byAgent.reduce((n,row)=>n+row.duration_ms,0),session_count:byAgent.reduce((n,row)=>n+row.sessions,0),byAgent,byForm,byIntent}
}
