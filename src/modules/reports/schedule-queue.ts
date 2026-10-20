import type {Env} from '../../platform/env'
import {boundedDatabase} from '../../platform/d1-budget'

/** Cron only discovers work. Complete exports run in a queue invocation with
 * their own statement budget; persisted per-recipient windows fence duplicates. */
export async function enqueueScheduledReports(env:Env,now=Date.now()){
 const meter=boundedDatabase(env.DB,3)
 const due=await meter.database.prepare(`SELECT 1 FROM report_schedules s LEFT JOIN project_settings ps ON ps.project_id=s.project_id WHERE s.paused=0 AND json_extract(coalesce(ps.settings_json,'{}'),'$.deleted_at') IS NULL AND (s.next_run_at<=? OR s.timezone<>coalesce(json_extract(ps.settings_json,'$.timezone'),'UTC')) LIMIT 1`).bind(now).first()
 if(due)await env.JOBS.send({type:'reports.schedule',id:'scheduled-reports',projectId:'installation'})
}
