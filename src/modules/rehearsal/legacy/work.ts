import type {Env} from '../../../platform/env'
// Historical mapping cannot create native accounts, leads or lead jobs. Every
// possible workspace work effect is measured without exposing other tenants.
const tables=['conversation_outbox','email_deliveries','magic_signins','operator_notifications','operator_notification_activity','native_integration_events','native_integration_intents','context_jobs','brand_generations','csat_surveys','workflow_events']
export async function countScopedWork(env:Env,projectId:string){
 return (await env.DB.prepare('SELECT '+[...tables.map(t=>`(SELECT count(*) FROM ${t} WHERE project_id=?1) AS ${t}`),'(SELECT count(*) FROM integration_deliveries WHERE namespace=?1) AS integration_deliveries','(SELECT count(*) FROM knowledge_datasets WHERE project_id=?1 AND next_refresh_at IS NOT NULL) AS knowledge_datasets'].join(',')).bind(projectId).first<Record<string,number>>())!
}
