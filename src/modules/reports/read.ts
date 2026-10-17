import type {Env} from '../../platform/env'
import {addDays,calendarBoundary,type ReportRange} from './calendar'
export interface DailyReportRow{date:string;conversations:number;resolved:number;ai:number;rated:number;positive:number}
export interface ReportRow{id:string;created_at:number;resolved_at:number|null;latest_resolved_at:number|null;first_reply_at:number|null;first_visitor_at:number|null;first_resolved_at:number|null;outcome:string|null;value:number|null;comment:string|null;rating_updated_at:number|null;resolution_id:string|null}
/** The database reduces the full cohort; no conversation-count cutoff or row loop. The workspace's own away reply
 * (actor_role 'system') is not a reply. */
export const cohortSQL=`WITH cohort AS (
 SELECT c.* FROM conversations c WHERE c.project_id=? AND c.created_at>=? AND c.created_at<?
 AND EXISTS(SELECT 1 FROM messages m WHERE m.project_id=c.project_id AND m.conversation_id=c.id)
 AND NOT EXISTS(SELECT 1 FROM conversation_merges merged WHERE merged.project_id=c.project_id AND merged.source_id=c.id AND merged.undone_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM move_in_conversations i WHERE i.project_id=c.project_id AND i.conversation_id=c.id)
 AND NOT EXISTS(SELECT 1 FROM reporting_legacy_conversations i WHERE i.project_id=c.project_id AND i.conversation_id=c.id)
), visitors AS (
 SELECT m.conversation_id,MIN(m.revision) first_revision FROM messages m JOIN cohort c ON c.id=m.conversation_id AND c.project_id=m.project_id
 WHERE m.actor_role='contact' GROUP BY m.conversation_id
), replies AS (
 SELECT m.conversation_id,MIN(m.revision) reply_revision FROM messages m JOIN visitors v ON v.conversation_id=m.conversation_id AND m.revision>v.first_revision
 LEFT JOIN message_authorship a ON a.message_id=m.id WHERE m.actor_role NOT IN ('contact','system') AND COALESCE(a.source_kind,'')<>'insight' GROUP BY m.conversation_id
), rows AS (
 SELECT c.id,c.created_at,CASE WHEN c.status_category IN ('solved','closed') THEN c.resolved_at END resolved_at,c.status_category,t.first_resolved_at,f.created_at first_visitor_at,m.created_at first_reply_at,
 r.outcome,r.id resolution_id,r.resolved_at latest_resolved_at,v.value,v.comment,v.updated_at rating_updated_at
 FROM cohort c LEFT JOIN conversation_tracking t ON t.conversation_id=c.id AND t.project_id=c.project_id
 LEFT JOIN visitors q ON q.conversation_id=c.id LEFT JOIN messages f ON f.conversation_id=c.id AND f.revision=q.first_revision
 LEFT JOIN replies p ON p.conversation_id=c.id LEFT JOIN messages m ON m.conversation_id=c.id AND m.revision=p.reply_revision
 LEFT JOIN conversation_resolutions r ON r.conversation_id=c.id AND r.project_id=c.project_id AND r.ordinal=(SELECT MAX(ordinal) FROM conversation_resolutions WHERE conversation_id=c.id)
 LEFT JOIN conversation_ratings v ON v.resolution_id=r.id
)`
export async function readReport(env:Env,projectId:string,range:ReportRange){
 const boundaries=Array.from({length:range.days+1},(_,i)=>calendarBoundary(addDays(range.start,i),range.timezone))
 const days=Array.from({length:range.days},(_,i)=>({date:addDays(range.start,i),start:boundaries[i],end:boundaries[i+1]}))
 const result=await env.DB.prepare(`${cohortSQL}, durations AS (
 SELECT 'response' kind,first_reply_at-first_visitor_at value FROM rows WHERE first_reply_at>=first_visitor_at
 UNION ALL SELECT 'resolution',first_resolved_at-created_at FROM rows WHERE first_resolved_at>=created_at
), ranked AS (SELECT kind,value,ROW_NUMBER() OVER(PARTITION BY kind ORDER BY value) rank,COUNT(*) OVER(PARTITION BY kind) n FROM durations),
 distributions AS (SELECT kind,COUNT(*) count,AVG(CASE WHEN rank IN ((n+1)/2,(n+2)/2) THEN value END) median,MAX(CASE WHEN rank=(9*n+9)/10 THEN value END) p90 FROM ranked GROUP BY kind),
 daily AS (SELECT json_extract(d.value,'$.date') date,COUNT(r.id) conversations,COUNT(r.resolved_at) resolved,COALESCE(SUM(r.resolved_at IS NOT NULL AND r.outcome='ai'),0) ai,COUNT(CASE WHEN r.resolved_at IS NOT NULL THEN r.value END) rated,COALESCE(SUM(r.resolved_at IS NOT NULL AND r.value=1),0) positive FROM json_each(?) d LEFT JOIN rows r ON r.created_at>=json_extract(d.value,'$.start') AND r.created_at<json_extract(d.value,'$.end') GROUP BY d.key ORDER BY d.key),
 comments AS (SELECT id conversationId,value,comment,rating_updated_at updatedAt FROM rows WHERE resolved_at IS NOT NULL AND trim(COALESCE(comment,''))<>'' ORDER BY rating_updated_at DESC,id LIMIT 10)
 SELECT COUNT(*) volume,COUNT(resolved_at) resolved,COALESCE(SUM(resolved_at IS NOT NULL AND outcome='ai'),0) ai,COUNT(CASE WHEN resolved_at IS NOT NULL THEN value END) rated,COALESCE(SUM(resolved_at IS NOT NULL AND value=1),0) positive,
 (SELECT json_group_array(json_object('kind',kind,'count',count,'median',median,'p90',p90)) FROM distributions) distributions,
 (SELECT json_group_array(json_object('date',date,'conversations',conversations,'resolved',resolved,'ai',ai,'rated',rated,'positive',positive)) FROM daily) daily,
 (SELECT json_group_array(json_object('conversationId',conversationId,'value',value,'comment',comment,'updatedAt',updatedAt)) FROM comments) comments FROM rows`).bind(projectId,range.startAt,range.endAt,JSON.stringify(days)).first<any>()
 const distributions=JSON.parse(result.distributions),empty={count:0,median:null,p90:null}
 const distribution=(kind:string)=>{const value=distributions.find((x:any)=>x.kind===kind);return value?{count:value.count,median:value.median,p90:value.p90}:empty}
 return {range,volume:result.volume,firstResponse:distribution('response'),firstResolution:distribution('resolution'),aiResolution:{count:result.ai,total:result.resolved,rate:result.resolved?result.ai/result.resolved:null},satisfaction:{positive:result.positive,total:result.rated,rate:result.rated?result.positive/result.rated:null},daily:JSON.parse(result.daily) as DailyReportRow[],comments:JSON.parse(result.comments).map((r:any)=>({...r,updatedAt:new Date(r.updatedAt).toISOString()}))}
}
/** Keyset pages bound both D1 result size and Worker memory while exporting every row. */
export async function* cohortPages(env:Env,projectId:string,range:ReportRange){
 let timestamp=range.startAt,id=''
 for(;;){const {results}=await env.DB.prepare(`${cohortSQL} SELECT * FROM rows WHERE created_at>? OR (created_at=? AND id>?) ORDER BY created_at,id LIMIT 500`).bind(projectId,range.startAt,range.endAt,timestamp,timestamp,id).all<ReportRow>();if(!results.length)return;yield results;const last=results[results.length-1];timestamp=last.created_at;id=last.id;if(results.length<500)return}
}
export type Report=Awaited<ReturnType<typeof readReport>>
