import type {Env} from './env'
import {siteReadRecoveryDue} from '../modules/management/site-read/job'

/** These recovery stages can wake existing jobs but do not produce work for
 * each other. Discover their inputs together, before running any effects. */
export async function scheduledRecoveryWork(env:Env){
 return (await env.DB.prepare(`SELECT
  EXISTS(SELECT 1 FROM context_jobs WHERE state IN ('queued','running')) AS context,
  EXISTS(SELECT 1 FROM ticket_batch_jobs WHERE state='pending') AS tickets,
  EXISTS(SELECT 1 FROM training_runs WHERE status IN ('planning','queued','running')
   UNION ALL SELECT 1 FROM training_cases WHERE status='running') AS training,
  EXISTS(SELECT 1 FROM local_result_effects WHERE state='pending') AS local,
  EXISTS(SELECT 1 FROM brand_generations WHERE state IN ('queued','running')) AS brand,
  EXISTS(SELECT 1 FROM project_settings WHERE ${siteReadRecoveryDue}) AS site
 `).bind(Date.now()).first<{context:number;tickets:number;training:number;local:number;brand:number;site:number}>())!
}
