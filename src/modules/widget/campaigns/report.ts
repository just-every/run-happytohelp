import type {Env} from '../../../platform/env'
/** Impression cohorts in the report range. A conversation requires an actual visitor message after opening. */
export async function campaignReport(env:Env,projectId:string,start:number,end:number){
 return (await env.DB.prepare(`SELECT w.id,json_extract(w.config_json,'$.name') name,
 count(i.shown_at) impressions,count(i.opened_at) opens,count(i.dismissed_at) dismissals,
 count(DISTINCT CASE WHEN EXISTS(SELECT 1 FROM messages m WHERE m.conversation_id=i.conversation_id AND m.actor_role='contact' AND m.created_at>=i.opened_at) THEN i.conversation_id END) conversations,
 count(DISTINCT CASE WHEN EXISTS(SELECT 1 FROM messages m WHERE m.conversation_id=i.conversation_id AND m.actor_role='contact' AND m.created_at>=i.opened_at) AND EXISTS(SELECT 1 FROM conversation_resolutions r WHERE r.project_id=i.project_id AND r.conversation_id=i.conversation_id AND r.resolved_at>=i.opened_at AND r.reopened_at IS NULL) THEN i.conversation_id END) resolutions
 FROM widget_campaigns w LEFT JOIN widget_campaign_impressions i ON i.project_id=w.project_id AND i.campaign_id=w.id AND i.created_at>=? AND i.created_at<? WHERE w.project_id=? GROUP BY w.id ORDER BY name,w.id`).bind(start,end,projectId).all()).results
}
