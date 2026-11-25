import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'
import type {ReportRange} from './calendar'

export type TeamReportFilters={teamId:string|null;brandId:string|null;includeImported:boolean}
export function teamReportFilters(query:Record<string,string>):TeamReportFilters{
 if(query.includeImported!==undefined&&!['true','false'].includes(query.includeImported))throw new HTTPException(400,{message:'includeImported must be true or false'})
 for(const key of ['teamId','brandId'])if(query[key]&&query[key].length>120)throw new HTTPException(400,{message:`Invalid ${key}`})
 return {teamId:query.teamId||null,brandId:query.brandId||null,includeImported:query.includeImported==='true'}
}

/** All scans are tenant scoped and complete. The date cohort is distinct from the
 * current backlog, which also includes tickets older than the selected start. */
type Population='cohort'|'backlog'|'sessions'
/** Handle sessions that overlap [?2,?3) up to ?7 (generatedAt): those started in the
 * interval, those started earlier that ended after its start, and those still running.
 * Each branch reads its own index range, so the cost follows the interval's sessions,
 * never every session the workspace has recorded. */
const overlapsSQL='s.started_at<?3 AND s.started_at<=?7 AND (COALESCE(s.ended_at,?7)>?2 OR (s.ended_at=s.started_at AND s.started_at>=?2))'
const handledSQL=`handled AS MATERIALIZED (
 SELECT s.* FROM ticket_handle_sessions s INDEXED BY ticket_handle_report WHERE s.project_id=?1 AND s.started_at>=?2 AND ${overlapsSQL}
 UNION ALL SELECT s.* FROM ticket_handle_sessions s INDEXED BY ticket_handle_ended WHERE s.project_id=?1 AND s.ended_at>?2 AND s.started_at<?2 AND ${overlapsSQL}
 UNION ALL SELECT s.* FROM ticket_handle_sessions s INDEXED BY ticket_handle_running WHERE s.project_id=?1 AND s.ended_at IS NULL AND s.started_at<?2 AND ${overlapsSQL}
)`
const teamScopeSQL=(population:Population)=>`WITH ${population==='sessions'?`${handledSQL},`:''} candidates AS (
 SELECT c.*,CASE WHEN EXISTS(SELECT 1 FROM move_in_conversations i WHERE i.project_id=c.project_id AND i.conversation_id=c.id)
 OR EXISTS(SELECT 1 FROM reporting_legacy_conversations i WHERE i.project_id=c.project_id AND i.conversation_id=c.id) THEN 1 ELSE 0 END imported
 FROM ${population==='sessions'?'(SELECT DISTINCT conversation_id FROM handled) worked CROSS JOIN reporting_conversations eligible ON eligible.conversation_id=worked.conversation_id':'reporting_conversations eligible'} CROSS JOIN conversations c ON c.id=eligible.conversation_id
 WHERE eligible.project_id=?1 AND eligible.created_at<?3
 ${population==='cohort'?'AND eligible.created_at>=?2':population==='backlog'?"AND eligible.status_category NOT IN ('solved','closed')":''}
 AND (?4 IS NULL OR c.group_id=?4) AND (?5 IS NULL OR COALESCE(c.brand_id,c.project_id)=?5)

 AND NOT EXISTS(SELECT 1 FROM conversation_merges merged WHERE merged.project_id=c.project_id AND merged.source_id=c.id AND merged.undone_at IS NULL)
), scoped AS (SELECT * FROM candidates WHERE ?6=1 OR imported=0),
cohort AS (SELECT * FROM scoped WHERE created_at>=?2)`

export function teamStatement(env:Env,projectId:string,range:ReportRange,filters:TeamReportFilters,sql:string,population:Population='cohort'){
 return env.DB.prepare(`${teamScopeSQL(population)} ${sql}`).bind(projectId,range.startAt,range.endAt,filters.teamId,filters.brandId,filters.includeImported?1:0)
}
export type TeamReportContext={env:Env;projectId:string;range:ReportRange;filters:TeamReportFilters;now:number;accessRole:string|null}
export const statement=(context:TeamReportContext,sql:string,population:Population='cohort')=>teamStatement(context.env,context.projectId,context.range,context.filters,sql,population)
