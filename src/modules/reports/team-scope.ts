import {ticketScopeSql} from '../access/ticket-scope'
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
export const teamScopeSQL=`WITH candidates AS (
 SELECT c.*,CASE WHEN EXISTS(SELECT 1 FROM move_in_conversations i WHERE i.project_id=c.project_id AND i.conversation_id=c.id)
 OR EXISTS(SELECT 1 FROM reporting_legacy_conversations i WHERE i.project_id=c.project_id AND i.conversation_id=c.id) THEN 1 ELSE 0 END imported
 FROM conversations c WHERE c.project_id=?1 AND c.created_at<?3 AND (?9 IS NULL OR ${ticketScopeSql('?9')})
 AND (?4 IS NULL OR c.group_id=?4) AND (?5 IS NULL OR COALESCE(c.brand_id,c.project_id)=?5)
 AND EXISTS(SELECT 1 FROM messages m WHERE m.project_id=c.project_id AND m.conversation_id=c.id)
 AND NOT EXISTS(SELECT 1 FROM conversation_merges merged WHERE merged.project_id=c.project_id AND merged.source_id=c.id AND merged.undone_at IS NULL)
), scoped AS (SELECT * FROM candidates WHERE ?6=1 OR imported=0),
cohort AS (SELECT * FROM scoped WHERE created_at>=?2)`

export function teamStatement(env:Env,projectId:string,range:ReportRange,filters:TeamReportFilters,sql:string,userId:string|null=null,now=Date.now(),accessRole:string|null=null){
 return env.DB.prepare(`${teamScopeSQL} ${sql}`).bind(projectId,range.startAt,range.endAt,filters.teamId,filters.brandId,filters.includeImported?1:0,now,accessRole,userId)
}
export type TeamReportContext={env:Env;projectId:string;range:ReportRange;filters:TeamReportFilters;now:number;accessRole:string|null;userId:string|null}
export const statement=(context:TeamReportContext,sql:string)=>teamStatement(context.env,context.projectId,context.range,context.filters,sql,context.userId,context.now,context.accessRole)
