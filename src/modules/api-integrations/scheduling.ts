import type {Env} from '../../platform/env'
/** Empty widget conversations do not consume the bounded preparation page. */
export const readyIntentSql=`e.erased_at IS NULL AND (d.kind<>'slack' OR e.event<>'conversation.created' OR EXISTS(SELECT 1 FROM messages m JOIN contacts ct ON ct.id=e.contact_id AND ct.project_id=e.project_id WHERE m.project_id=e.project_id AND m.conversation_id=e.conversation_id AND m.actor_role='contact' AND m.erased_at IS NULL AND COALESCE(json_extract(ct.metadata_json,'$.is_erasing'),0)!=1 AND COALESCE(json_extract(ct.metadata_json,'$.is_erased'),0)!=1))`
const intentJoins=`JOIN native_integration_events e ON e.id=i.event_id AND e.project_id=i.project_id JOIN native_integration_destinations d ON d.id=i.destination_id AND d.project_id=i.project_id`
/** Workspaces with an intent to prepare, or a delivery due for a retry or a claim
 * recovery. Each half walks a partial index of live work only, so discovery costs
 * the same however many settled intents and deliveries a workspace keeps. */
const due=`SELECT project_id FROM (SELECT DISTINCT i.project_id FROM native_integration_intents i INDEXED BY native_integration_intents_unprepared ${intentJoins} WHERE i.project_id>?1 AND i.prepared_at IS NULL AND ${readyIntentSql}
 UNION SELECT DISTINCT v.namespace FROM integration_deliveries v INDEXED BY integration_deliveries_live JOIN native_integration_intents i ON i.id=v.id AND i.project_id=v.namespace ${intentJoins} WHERE v.namespace>?1 AND v.state IN ('queued','sending') AND (v.state='queued' AND v.next_at<=?2 OR v.state='sending' AND v.claim_until<=?2) AND ${readyIntentSql})
 ORDER BY project_id LIMIT ?3`
export async function scheduledProjects(env:Env,limit=4){
 const cursor=await env.DB.prepare('SELECT project_id FROM native_integration_dispatch_cursor WHERE id=1').first<{project_id:string}>()
 const select=async(after:string)=>(await env.DB.prepare(due).bind(after,Date.now(),limit).all<{project_id:string}>()).results
 const projects=await select(cursor?.project_id||'');return projects.length||!cursor?.project_id?projects:select('')
}
export async function advanceDispatchCursor(env:Env,project:string){await env.DB.prepare('INSERT INTO native_integration_dispatch_cursor(id,project_id) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id').bind(project).run()}
