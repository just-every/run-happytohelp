import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {scope} from './common'
import {issuerGuard} from '../../platform/integration-authority'
import {requireStepUp} from '../identity/two-factor/step-up'
import {auditStatement} from '../audit/record'
import {endHandleTimers} from '../reports/timers'

export const memberErasure=new Hono<AppEnv>()
/** Erase an installation account only when this workspace owns its sole membership.
 * Owners must transfer ownership first. Cross-workspace accounts require separate
 * installation review; a workspace owner cannot erase another workspace's member.
 */
memberErasure.post('/projects/:projectId/agents/:userId/erase',async c=>{
 const actor=await scope(c,true),userId=c.req.param('userId')
 if(actor.role!=='owner'||actor.id===userId)throw new HTTPException(403)
 await requireStepUp(c,actor,'member.erase')
 const guard=await issuerGuard(c.env,{actor:{...actor,role:'owner'},sessionHash:c.get('sessionHash')}),now=Date.now()
 const eligible="EXISTS(SELECT 1 FROM memberships WHERE user_id=? AND project_id=? AND role<>'owner') AND (SELECT count(*) FROM memberships WHERE user_id=?)=1 AND NOT EXISTS(SELECT 1 FROM platform_admins WHERE user_id=?)"
 const args=[userId,actor.projectId,userId,userId]
 if(!await c.env.DB.prepare('SELECT 1 WHERE '+eligible).bind(...args).first())throw new HTTPException(409,{message:'Transfer ownership first; accounts shared with other workspaces or installation administrators require installation review'})
 const context:ErasureContext={env:c.env,project:actor.projectId,user:userId,actor:actor.id,now,guard:{sql:`EXISTS(${guard.sql}) AND ${eligible}`,params:[...guard.params,...args]}}
 await c.env.DB.batch(Object.values(memberErasureRegistry).flatMap(entry=>entry.statements?.(context)??[]))
 return c.json({erased:true,credentialsRevoked:true,eventsRetained:true})
})

interface ErasureContext {env:AppEnv['Bindings'];project:string;user:string;actor:string;now:number;guard:{sql:string;params:unknown[]}}
type RegistryEntry={level:'workspace'|'account'|'internal';statements?:(context:ErasureContext)=>D1PreparedStatement[]}
const accountDelete=(table:string):RegistryEntry=>({level:'account',statements:c=>[c.env.DB.prepare(`DELETE FROM ${table} WHERE user_id=?`).bind(c.user)]})
const workspaceDelete=(table:string):RegistryEntry=>({level:'workspace',statements:c=>[c.env.DB.prepare(`DELETE FROM ${table} WHERE project_id=? AND user_id=?`).bind(c.project,c.user)]})
/** This is the complete member-reference inventory. Historical workspace rows
 * retain opaque ids. No account-keyed deletion can select a workspace table. */
export const memberErasureRegistry:Record<string,RegistryEntry>={
 ik_d1_assertions:{level:'internal',statements:c=>[c.env.DB.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT CASE WHEN ${c.guard.sql} THEN 1 ELSE 0 END`).bind(...c.guard.params)]},
 registrations:{level:'account',statements:c=>[c.env.DB.prepare('DELETE FROM registrations WHERE lower(email)=(SELECT lower(email) FROM users WHERE id=?)').bind(c.user)]},
 identity_tokens:{level:'workspace',statements:c=>[c.env.DB.prepare("DELETE FROM identity_tokens WHERE ((kind='invite' AND project_id=? OR kind='reset' AND (project_id IS NULL OR project_id=?))) AND (user_id=? OR lower(email)=(SELECT lower(email) FROM users WHERE id=?))").bind(c.project,c.project,c.user,c.user)]},
 native_integration_audit:{level:'workspace',statements:c=>[c.env.DB.prepare("INSERT INTO native_integration_audit(id,project_id,actor_id,action,resource_id,created_at) SELECT lower(hex(randomblob(16))),namespace,?,'token.revoke',id,? FROM api_credentials WHERE namespace=? AND issuer_id=? AND revoked_at IS NULL").bind(c.actor,c.now,c.project,c.user)]},
 integration_token_events:{level:'workspace',statements:c=>[c.env.DB.prepare("INSERT INTO integration_token_events(namespace,id,token_id,at,action,feature) SELECT namespace,lower(hex(randomblob(16))),id,?,'revoked','integrations.tokens' FROM api_credentials WHERE namespace=? AND issuer_id=? AND revoked_at IS NULL").bind(c.now,c.project,c.user)]},
 integration_tokens:{level:'workspace',statements:c=>[c.env.DB.prepare("UPDATE integration_tokens SET revoked_at=coalesce(revoked_at,?),token_hash='erased:'||id WHERE namespace=? AND credential_id IN (SELECT id FROM api_credentials WHERE namespace=? AND issuer_id=?)").bind(c.now,c.project,c.project,c.user)]},
 api_credentials:{level:'workspace',statements:c=>[c.env.DB.prepare('UPDATE api_credentials SET issuer_id=NULL,revoked_at=coalesce(revoked_at,?) WHERE namespace=? AND issuer_id=?').bind(c.now,c.project,c.user)]},
 users:{level:'account',statements:c=>[c.env.DB.prepare("UPDATE users SET name='Former teammate',email='erased:'||id WHERE id=?").bind(c.user)]},
 ...Object.fromEntries(['credentials','user_settings','user_factors','recovery_codes','session_factors','webauthn_challenges','magic_signins'].map(table=>[table,accountDelete(table)])),
 ...Object.fromEntries(['user_project_preferences','member_roles','operator_presence','memberships'].map(table=>[table,workspaceDelete(table)])),
 sessions:{level:'account',statements:c=>[c.env.DB.prepare("DELETE FROM sessions WHERE actor_id=? AND role<>'contact' AND (project_id IS NULL OR project_id=?)").bind(c.user,c.project)]},
 conversation_followers:{level:'workspace',statements:c=>[c.env.DB.prepare('DELETE FROM conversation_followers WHERE user_id=? AND conversation_id IN (SELECT id FROM conversations WHERE project_id=?)').bind(c.user,c.project)]},
 ticket_handle_sessions:{level:'workspace',statements:c=>[endHandleTimers(c.env.DB,c.project,c.user,c.now)]},
 audit_events:{level:'workspace',statements:c=>[auditStatement(c.env.DB,{projectId:c.project,category:'erasure',action:'member.erased',actor:{type:'user',id:c.actor},source:'dashboard',target:{type:'member',id:c.user}},c.now)]},
 ...Object.fromEntries(['macros','conversation_reads','conversation_notes','github_oauth_states','move_in_runs','local_pairings','local_grants','local_authorizations','local_devices','operator_notifications','ticket_group_members','ticket_views','notification_preferences','notification_inbox','conversation_note_mentions','routing_operators','mailbox_oauth_states','email_sender_rules','email_message_options','operator_ticket_commands','report_schedules','report_schedule_recipients','report_schedule_deliveries','customer_identity_links','customer_identity_link_history','api_notes'].map(table=>[table,{level:'workspace' as const}])),
 platform_admins:{level:'account'},owner_recoveries:{level:'account'},
 assertion_cleanup:{level:'internal',statements:c=>[c.env.DB.prepare('DELETE FROM ik_d1_assertions')]},
}
export async function unclassifiedMemberTables(db:D1Database){
 const tables=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all<{name:string}>(),missing=[]
 for(const {name} of tables.results){
  const quoted='"'+name.replaceAll('"','""')+'"',columns=await db.prepare(`PRAGMA table_info(${quoted})`).all<any>(),refs=await db.prepare(`PRAGMA foreign_key_list(${quoted})`).all<any>()
  if((columns.results.some(column=>['user_id','issuer_id'].includes(column.name))||refs.results.some(ref=>ref.table==='users'))&&!memberErasureRegistry[name])missing.push(name)
 }
 return missing
}
