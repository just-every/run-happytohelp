import type {Env} from '../../../platform/env'
export const CAMPAIGN_RETENTION_DAYS=30
/** Minimize consented identifiers. Cron removes bounded pages; reads also expire their own workspace. */
export async function purgeCampaignData(env:Env,now=Date.now(),projectId?:string){
 const cutoff=now-CAMPAIGN_RETENTION_DAYS*86400000
 return env.DB.batch(['widget_campaign_impressions','widget_campaign_visits'].map(table=>env.DB.prepare(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE created_at<? ${projectId?'AND project_id=?':''} ORDER BY created_at LIMIT 1000)`).bind(cutoff,...(projectId?[projectId]:[]))))
}
