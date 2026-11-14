import {HTTPException} from 'hono/http-exception'
import {ticketScopeSql} from '../access/ticket-scope'
import type {Env} from '../../platform/env'
import {addDays,calendarBoundary,type ReportRange} from './calendar'
import {calendarDaySQL} from './read-calendar'
export interface DailyReportRow{date:string;conversations:number;resolved:number;ai:number;rated:number;positive:number}
export interface ReportRow{id:string;created_at:number;resolved_at:number|null;latest_resolved_at:number|null;first_reply_at:number|null;first_visitor_at:number|null;first_resolved_at:number|null;outcome:string|null;value:number|null;comment:string|null;rating_updated_at:number|null;resolution_id:string|null}
/** All evidence is looked up from the date-indexed, message-bearing cohort. */
export const reportCohortSQL=`WITH cohort AS (
 SELECT c.* FROM reporting_conversations eligible CROSS JOIN conversations c ON c.id=eligible.conversation_id
 WHERE eligible.project_id=?1 AND eligible.created_at>=?2 AND eligible.created_at<?3 AND (?4 IS NULL OR ${ticketScopeSql('?4')})
 AND NOT EXISTS(SELECT 1 FROM conversation_merges merged WHERE merged.project_id=c.project_id AND merged.source_id=c.id AND merged.undone_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM move_in_conversations i WHERE i.project_id=c.project_id AND i.conversation_id=c.id)
 AND NOT EXISTS(SELECT 1 FROM reporting_legacy_conversations i WHERE i.project_id=c.project_id AND i.conversation_id=c.id)
)`
export const latestResolutionSQL=`LEFT JOIN conversation_resolutions r ON r.conversation_id=c.id AND r.project_id=c.project_id AND r.ordinal=(SELECT MAX(ordinal) FROM conversation_resolutions WHERE conversation_id=c.id)
 LEFT JOIN conversation_ratings v ON v.resolution_id=r.id`
export const firstMessagesSQL=`LEFT JOIN messages f ON f.conversation_id=c.id AND f.revision=(SELECT MIN(revision) FROM messages WHERE conversation_id=c.id AND project_id=c.project_id AND actor_role='contact')
 LEFT JOIN messages m ON m.conversation_id=c.id AND m.revision=(SELECT MIN(answer.revision) FROM messages answer LEFT JOIN message_authorship a ON a.message_id=answer.id WHERE answer.conversation_id=c.id AND answer.revision>f.revision AND answer.actor_role NOT IN ('contact','system') AND COALESCE(a.source_kind,'')<>'insight')`
export const cohortSQL=`${reportCohortSQL}, rows AS (
 SELECT c.id,c.created_at,CASE WHEN c.status_category IN ('solved','closed') THEN c.resolved_at END resolved_at,c.status_category,t.first_resolved_at,f.created_at first_visitor_at,m.created_at first_reply_at,
 r.outcome,r.id resolution_id,r.resolved_at latest_resolved_at,v.value,v.comment,v.updated_at rating_updated_at
 FROM cohort c LEFT JOIN conversation_tracking t ON t.conversation_id=c.id AND t.project_id=c.project_id
 ${firstMessagesSQL} ${latestResolutionSQL}
)`
export type ReportScopeCheck=()=>Promise<void>
/** Only ordinary report entries acquire this guard. A stream must stop when its
 * membership, role or stored selection changes; ticket filtering uses S1's SQL.
 * Keep the optional actor on shared readers so other reporting custody is unchanged. */
export async function ordinaryReportGuard(env:Env,projectId:string,userId:string){
 const current=()=>env.DB.prepare(`SELECT m.role,CASE WHEN m.role<>'owner' THEN mr.role_key END role_key,
 CASE WHEN m.role<>'owner' THEN pr.ticket_scope_json END ticket_scope_json,
 CASE WHEN m.role<>'owner' THEN pr.permissions_json END permissions_json
 FROM memberships m LEFT JOIN member_roles mr ON mr.project_id=m.project_id AND mr.user_id=m.user_id
 LEFT JOIN project_roles pr ON pr.project_id=mr.project_id AND pr.id=mr.role_key
 WHERE m.project_id=? AND m.user_id=?`).bind(projectId,userId).first<{role:string;role_key:string|null;ticket_scope_json:string|null;permissions_json:string|null}>()
 const initial=await current(),signature=JSON.stringify(initial)
 if(!initial)throw new HTTPException(403,{message:'Your report access changed. Start a new report.'})
 const check:ReportScopeCheck=async()=>{if(JSON.stringify(await current())!==signature)throw new HTTPException(403,{message:'Your report access changed. Start a new report.'})}
 return {check,scoped:initial.ticket_scope_json!==null}
}
export async function readReport(env:Env,projectId:string,range:ReportRange,userId:string|null=null){
 const boundaries=Array.from({length:range.days+1},(_,i)=>calendarBoundary(addDays(range.start,i),range.timezone))
 const days=Array.from({length:range.days},(_,i)=>({date:addDays(range.start,i),start:boundaries[i],end:boundaries[i+1]}))
 const query=(sql:string)=>env.DB.prepare(`${reportCohortSQL} ${sql}`).bind(projectId,range.startAt,range.endAt,userId)
 const [dailyResult,firstResponse,firstResolution,comments]=await Promise.all([
  query(`SELECT ${calendarDaySQL(days.length)} date,COUNT(*) conversations,
   COUNT(CASE WHEN c.status_category IN ('solved','closed') THEN c.resolved_at END) resolved,
   COALESCE(SUM(c.status_category IN ('solved','closed') AND c.resolved_at IS NOT NULL AND r.outcome='ai'),0) ai,
   COUNT(CASE WHEN c.status_category IN ('solved','closed') AND c.resolved_at IS NOT NULL THEN v.value END) rated,
   COALESCE(SUM(c.status_category IN ('solved','closed') AND c.resolved_at IS NOT NULL AND v.value=1),0) positive
   FROM cohort c ${latestResolutionSQL} GROUP BY date ORDER BY date`).bind(projectId,range.startAt,range.endAt,userId,JSON.stringify(days)).all<DailyReportRow>(),
  query(`, samples AS (SELECT m.created_at-f.created_at value FROM cohort c ${firstMessagesSQL} WHERE m.created_at>=f.created_at) ${distributionSQL}`).first<Distribution>(),
  query(`, samples AS (SELECT t.first_resolved_at-c.created_at value FROM cohort c JOIN conversation_tracking t ON t.conversation_id=c.id AND t.project_id=c.project_id WHERE t.first_resolved_at>=c.created_at) ${distributionSQL}`).first<Distribution>(),
  query(`SELECT c.id conversationId,v.value,v.comment,v.updated_at updatedAt FROM cohort c ${latestResolutionSQL}
   WHERE c.status_category IN ('solved','closed') AND c.resolved_at IS NOT NULL AND trim(COALESCE(v.comment,''))<>'' ORDER BY v.updated_at DESC,c.id LIMIT 10`).all<{conversationId:string;value:number;comment:string;updatedAt:number}>()
 ])
 const byDate=new Map(dailyResult.results.map(row=>[row.date,row])),daily=days.map(({date})=>byDate.get(date)??{date,conversations:0,resolved:0,ai:0,rated:0,positive:0}),totals=daily.reduce((a,r)=>({volume:a.volume+r.conversations,resolved:a.resolved+r.resolved,ai:a.ai+r.ai,rated:a.rated+r.rated,positive:a.positive+r.positive}),{volume:0,resolved:0,ai:0,rated:0,positive:0})
 return {range,volume:totals.volume,firstResponse:firstResponse!,firstResolution:firstResolution!,aiResolution:{count:totals.ai,total:totals.resolved,rate:totals.resolved?totals.ai/totals.resolved:null},satisfaction:{positive:totals.positive,total:totals.rated,rate:totals.rated?totals.positive/totals.rated:null},daily,comments:comments.results.map(r=>({...r,updatedAt:new Date(r.updatedAt).toISOString()}))}
}
type Distribution={count:number;median:number|null;p90:number|null}
const distributionSQL=`, ranked AS (SELECT value,ROW_NUMBER() OVER(ORDER BY value) rank,COUNT(*) OVER() n FROM samples)
 SELECT COUNT(*) count,AVG(CASE WHEN rank IN ((n+1)/2,(n+2)/2) THEN value END) median,MAX(CASE WHEN rank=(9*n+9)/10 THEN value END) p90 FROM ranked`
/** Keyset pages bound both D1 result size and Worker memory while exporting every row. */
export async function* cohortPages(env:Env,projectId:string,range:ReportRange,userId:string|null=null){
 let timestamp=range.startAt,id=''
 for(;;){const {results}=await env.DB.prepare(`${cohortSQL} SELECT * FROM rows WHERE created_at>? OR (created_at=? AND id>?) ORDER BY created_at,id LIMIT 500`).bind(projectId,range.startAt,range.endAt,userId,timestamp,timestamp,id).all<ReportRow>();if(!results.length)return;yield results;const last=results[results.length-1];timestamp=last.created_at;id=last.id;if(results.length<500)return}
}
export type Report=Awaited<ReturnType<typeof readReport>>
