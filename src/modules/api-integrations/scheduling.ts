import type {Env} from '../../platform/env'
/** Empty widget conversations do not consume the bounded preparation page. */
export const readyIntentSql=`e.erased_at IS NULL AND (d.kind<>'slack' OR e.event<>'conversation.created' OR EXISTS(SELECT 1 FROM messages m JOIN contacts ct ON ct.id=e.contact_id AND ct.project_id=e.project_id WHERE m.project_id=e.project_id AND m.conversation_id=e.conversation_id AND m.actor_role='contact' AND m.erased_at IS NULL AND COALESCE(json_extract(ct.metadata_json,'$.is_erasing'),0)!=1 AND COALESCE(json_extract(ct.metadata_json,'$.is_erased'),0)!=1))`
export async function scheduledProjects(env:Env,limit=4){
 const cursor=await env.DB.prepare('SELECT project_id FROM native_integration_dispatch_cursor WHERE id=1').first<{project_id:string}>()
 const select=async(after:string)=>(await env.DB.prepare(`SELECT DISTINCT i.project_id FROM native_integration_intents i JOIN native_integration_events e ON e.id=i.event_id AND e.project_id=i.project_id JOIN native_integration_destinations d ON d.id=i.destination_id AND d.project_id=i.project_id LEFT JOIN integration_deliveries v ON v.id=i.id AND v.namespace=i.project_id WHERE i.project_id>? AND ${readyIntentSql} AND (i.prepared_at IS NULL OR v.state='queued' AND v.next_at<=? OR v.state='sending' AND v.claim_until<=?) ORDER BY i.project_id LIMIT ?`).bind(after,Date.now(),Date.now(),limit).all<{project_id:string}>()).results
 const projects=await select(cursor?.project_id||'');return projects.length||!cursor?.project_id?projects:select('')
}
export async function advanceDispatchCursor(env:Env,project:string){await env.DB.prepare('INSERT INTO native_integration_dispatch_cursor(id,project_id) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id').bind(project).run()}
