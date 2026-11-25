import {reportDueSql} from './schedule-due'
import type {Env} from '../../platform/env'
import {boundedDatabase} from '../../platform/d1-budget'

/** Cron only discovers work. Complete exports run in a queue invocation with
 * their own statement budget; persisted per-recipient windows fence duplicates. */
export async function enqueueScheduledReports(env:Env,now=Date.now()){
 const meter=boundedDatabase(env.DB,3)
 const due=await meter.database.prepare(`${reportDueSql('?')} LIMIT 1`).bind(now).first()
 if(due)await env.JOBS.send({type:'reports.schedule',id:'scheduled-reports',projectId:'installation'})
}
