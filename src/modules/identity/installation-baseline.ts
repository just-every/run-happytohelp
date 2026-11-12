/** Counts only. Shared with import diagnostics so setup and import use one definition. */
export const workTables=['conversation_outbox','email_deliveries','magic_signins','operator_notifications','operator_notification_activity','native_integration_events','native_integration_intents','integration_deliveries','context_jobs','lead_jobs','leads','brand_generations','csat_surveys','workflow_events']
const workCounts=[...workTables.map(table=>[table,`(SELECT count(*) FROM ${table})`]),['knowledge_datasets',"(SELECT count(*) FROM knowledge_datasets WHERE next_refresh_at IS NOT NULL)"]]
export const workCountSelect='SELECT '+workCounts.map(([table,sql])=>`${sql} AS ${table}`).join(',')
/** Runs in the existing guarded first-owner batch, before provisioning effects.
 * No account/claim/session mutation and no upgrade backfill. */
export function installationBaselineStatement(db:D1Database,claim:string,userId:string,at:number){
 const counts='json_object('+workCounts.flatMap(([table,sql])=>["'"+table+"'",sql]).join(',')+')'
 return db.prepare(`INSERT OR IGNORE INTO installation_work_baseline(singleton,captured_at,counts_json) SELECT 1,?,${counts} WHERE EXISTS(${claim})`).bind(at,userId)
}
export async function readInstallationBaseline(db:D1Database){
 const row=await db.prepare('SELECT captured_at,counts_json FROM installation_work_baseline WHERE singleton=1').first<{captured_at:number;counts_json:string}>()
 return row?{kind:'installation-setup',at:row.captured_at,counts:JSON.parse(row.counts_json)}:null
}
