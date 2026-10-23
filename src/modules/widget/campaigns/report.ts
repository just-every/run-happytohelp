import {purgeCampaignData,CAMPAIGN_RETENTION_DAYS} from './retention'
import type {Env} from '../../../platform/env'
/** Impression cohorts in the report range. A conversation requires an actual visitor message after opening, including a native linked follow-up. */
export async function campaignReport(env:Env,projectId:string,start:number,end:number){
 await purgeCampaignData(env,Date.now(),projectId)
 start=Math.max(start,Date.now()-CAMPAIGN_RETENTION_DAYS*86400000)
 return (await env.DB.prepare(`SELECT w.id,json_extract(w.config_json,'$.name') name,
 count(DISTINCT CASE WHEN i.shown_at IS NOT NULL THEN i.id END) impressions,count(DISTINCT CASE WHEN i.opened_at IS NOT NULL THEN i.id END) opens,count(DISTINCT CASE WHEN i.dismissed_at IS NOT NULL THEN i.id END) dismissals,
 count(DISTINCT CASE WHEN EXISTS(SELECT 1 FROM messages m WHERE m.conversation_id=c.id AND m.actor_role='contact' AND m.created_at>=i.opened_at) THEN c.id END) conversations,
 count(DISTINCT CASE WHEN EXISTS(SELECT 1 FROM messages m WHERE m.conversation_id=c.id AND m.actor_role='contact' AND m.created_at>=i.opened_at) AND EXISTS(SELECT 1 FROM conversation_resolutions r WHERE r.project_id=i.project_id AND r.conversation_id=c.id AND r.resolved_at>=i.opened_at AND r.reopened_at IS NULL) THEN c.id END) resolutions
 FROM widget_campaigns w LEFT JOIN widget_campaign_impressions i ON i.project_id=w.project_id AND i.campaign_id=w.id AND i.created_at>=? AND i.created_at<? LEFT JOIN ticket_followups f ON f.project_id=i.project_id AND f.original_id=i.conversation_id AND f.created_at>=i.opened_at LEFT JOIN conversations c ON c.project_id=i.project_id AND c.contact_id=i.contact_id AND (c.id=i.conversation_id OR c.id=f.conversation_id) WHERE w.project_id=? GROUP BY w.id ORDER BY name,w.id`).bind(start,end,projectId).all()).results
}
