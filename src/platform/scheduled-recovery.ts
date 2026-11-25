import type {Env} from './env'
import {siteReadRecoveryDue} from '../modules/management/site-read/recovery-window'

const probes=(now:string)=>({
 context:"SELECT 1 FROM context_jobs WHERE state IN ('queued','running')",
 tickets:"SELECT 1 FROM ticket_batch_jobs WHERE state='pending'",
 training:"SELECT 1 FROM training_runs WHERE status IN ('planning','queued','running') UNION ALL SELECT 1 FROM training_cases WHERE status='running'",
 local:"SELECT 1 FROM local_result_effects WHERE state='pending'",
 brand:"SELECT 1 FROM brand_generations WHERE state IN ('queued','running')",
 site:`SELECT 1 FROM project_settings WHERE ${siteReadRecoveryDue(now)}`,
})
export const recoveryDueSql=(now:string)=>Object.values(probes(now)).map(sql=>`EXISTS(${sql})`).join(' OR ')

/** These recovery stages can wake existing jobs but do not produce work for
 * each other. Discover their inputs together, before running any effects. */
export async function scheduledRecoveryWork(env:Env){
 const columns=Object.entries(probes('?1')).map(([name,sql])=>`EXISTS(${sql}) AS ${name}`).join(',')
 return (await env.DB.prepare(`SELECT ${columns}`).bind(Date.now()).first<{context:number;tickets:number;training:number;local:number;brand:number;site:number}>())!
}
