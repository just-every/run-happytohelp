import type {Env} from '../../../platform/env'
/** Counts stay in private pull custody. Machine results disclose only the invariant. */
const tables=['conversation_outbox','email_deliveries','operator_notifications','operator_notification_activity','native_integration_events','native_integration_intents','context_jobs','brand_generations','csat_surveys','workflow_events']
export async function scopedWork(env:Env,projectId:string){return (await env.DB.prepare('SELECT '+[...tables.map(table=>`(SELECT count(*) FROM ${table} WHERE project_id=?1) AS ${table}`),'(SELECT count(*) FROM integration_deliveries WHERE namespace=?1) AS integration_deliveries'].join(',')).bind(projectId).first<Record<string,number>>())!}
