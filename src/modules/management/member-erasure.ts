import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {scope} from './common'
import {issuerGuard} from '../../platform/integration-authority'
import {requireStepUp} from '../identity/two-factor/step-up'
import {auditStatement} from '../audit/record'

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
 const registry=await currentRegistry(c.env.DB)
 if(registry.errors.length)throw new HTTPException(503,{message:'Member erasure schema requires review'})
 await c.env.DB.batch(Object.values(registry.entries).flatMap(entry=>entry.statements?.(context)??[]))
 return c.json({erased:true,credentialsRevoked:true,eventsRetained:true})
})

// The isolate keeps the registry only for the schema it was derived from, and never keeps a failed derivation.
const schemaFingerprint="SELECT group_concat(name||char(31)||coalesce(sql,''),char(30)) fingerprint FROM (SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name)"
let isolateRegistry:{fingerprint:string;registry:Awaited<ReturnType<typeof memberErasureRegistry>>}|undefined
async function currentRegistry(db:D1Database){
 const fingerprint=(await db.prepare(schemaFingerprint).first<{fingerprint:string}>())?.fingerprint??''
 if(isolateRegistry?.fingerprint===fingerprint)return isolateRegistry.registry
 const registry=await memberErasureRegistry(db)
 isolateRegistry=registry.errors.length?undefined:{fingerprint,registry}
 return registry
}
interface ErasureContext {env:AppEnv['Bindings'];project:string;user:string;actor:string;now:number;guard:{sql:string;params:unknown[]}}
type ErasePlan={column:string;nullable?:boolean;through?:string;predicate?:string;args?:(c:ErasureContext)=>unknown[]}
type ScopedEffect={prefix:string;source?:string;where:string;before?:(c:ErasureContext)=>unknown[];after:(c:ErasureContext)=>unknown[]}
type RegistryEntry={internal?:'guard'|'cleanup';registration?:true;anonymize?:true;effects?:ScopedEffect[];audit?:true;reset?:true;erase?:ErasePlan;accountOnly?:boolean;statements?:(context:ErasureContext)=>D1PreparedStatement[]}
const accountDelete=():RegistryEntry=>({accountOnly:true,erase:{column:'user_id'}})
const workspaceDelete=():RegistryEntry=>({erase:{column:'user_id'}})
/** This is the complete member-reference inventory. Historical workspace rows
 * retain opaque ids. No account-keyed deletion can select a workspace table. */
const memberPolicies:Record<string,RegistryEntry>={
 ik_d1_assertions:{internal:'guard'},
 registrations:{accountOnly:true,registration:true},
 identity_tokens:{reset:true,erase:{column:'user_id',predicate:"kind='invite' AND (user_id=? OR lower(email)=(SELECT lower(email) FROM users WHERE id=?))",args:c=>[c.user,c.user]}},
 native_integration_audit:{effects:[{prefix:"INSERT INTO native_integration_audit(id,project_id,actor_id,action,resource_id,created_at) SELECT lower(hex(randomblob(16))),namespace,?,'token.revoke',id,? FROM api_credentials",source:'api_credentials',where:'issuer_id=? AND revoked_at IS NULL',before:c=>[c.actor,c.now],after:c=>[c.user]}]},
 integration_token_events:{effects:[{prefix:"INSERT INTO integration_token_events(namespace,id,token_id,at,action,feature) SELECT namespace,lower(hex(randomblob(16))),id,?,'revoked','integrations.tokens' FROM api_credentials",source:'api_credentials',where:'issuer_id=? AND revoked_at IS NULL',before:c=>[c.now],after:c=>[c.user]}]},
 integration_tokens:{effects:[{prefix:"UPDATE integration_tokens SET revoked_at=coalesce(revoked_at,?),token_hash='erased:'||id",where:'credential_id IN (SELECT id FROM api_credentials WHERE namespace=? AND issuer_id=?)',before:c=>[c.now],after:c=>[c.project,c.user]}]},
 api_credentials:{effects:[{prefix:'UPDATE api_credentials SET issuer_id=NULL,revoked_at=coalesce(revoked_at,?)',where:'issuer_id=?',before:c=>[c.now],after:c=>[c.user]}]},
 users:{accountOnly:true,anonymize:true},
 ...Object.fromEntries(['credentials','user_settings','user_factors','recovery_codes','session_factors','webauthn_challenges'].map(table=>[table,accountDelete()])),
 ...Object.fromEntries(['user_project_preferences','member_roles','operator_presence','support_channel_members','support_channel_link_codes','memberships'].map(table=>[table,workspaceDelete()])),
 magic_signins:{erase:{column:'user_id',nullable:true}},
 sessions:{erase:{column:'actor_id',nullable:true,predicate:"actor_id=? AND role<>'contact'",args:c=>[c.user]}},
 conversation_followers:{erase:{column:'user_id',through:'conversation_id'}},
 ticket_handle_sessions:{effects:[{prefix:'UPDATE ticket_handle_sessions SET ended_at=max(started_at,?)',where:'user_id=? AND ended_at IS NULL',before:c=>[c.now],after:c=>[c.user]}]},
 audit_events:{audit:true},
 ...Object.fromEntries(['macros','conversation_reads','conversation_notes','github_oauth_states','move_in_runs','local_pairings','local_grants','local_authorizations','local_devices','operator_notifications','ticket_group_members','ticket_views','notification_preferences','notification_inbox','conversation_note_mentions','routing_operators','mailbox_oauth_states','email_sender_rules','email_message_options','operator_ticket_commands','report_schedules','report_schedule_recipients','report_schedule_deliveries','customer_identity_links','customer_identity_link_history','voice_context_links','api_notes'].map(table=>[table,{}])),
 platform_admins:{accountOnly:true},owner_recoveries:{accountOnly:true},
 assertion_cleanup:{internal:'cleanup'},
}
/** Derive tenant scope from all live schema columns and transitive foreign keys.
 * Policies choose what to erase or retain, never a table's scope. Account-wide
 * writers cannot run on a workspace-bearing table. identity_tokens is explicitly
 * split by kind: reset is an account capability; invites belong to a workspace. */
export async function memberErasureRegistry(db:D1Database){
 const tables=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all<{name:string}>()
 const schema=new Map<string,{workspace:boolean;member:boolean;scope?:string;parents:string[]}>()
 for(const {name} of tables.results){
  const quoted='"'+name.replaceAll('"','""')+'"',columns=await db.prepare(`PRAGMA table_info(${quoted})`).all<any>(),refs=await db.prepare(`PRAGMA foreign_key_list(${quoted})`).all<any>()
  schema.set(name,{scope:columns.results.find(column=>['project_id','namespace'].includes(column.name))?.name,workspace:columns.results.some(column=>['project_id','namespace'].includes(column.name)),member:columns.results.some(column=>['user_id','issuer_id'].includes(column.name))||refs.results.some(ref=>ref.table==='users'),parents:refs.results.map(ref=>ref.table)})
 }
 let changed=true
 while(changed){changed=false;for(const row of schema.values())if(!row.workspace&&row.parents.some(parent=>schema.get(parent)?.workspace)){row.workspace=true;changed=true}}
 const errors:string[]=[],entries:Record<string,RegistryEntry&{level:'workspace'|'account'|'internal'}>={}
 // Preserve policy order: guards first, email matching before anonymization,
 // credential audit before revocation, and assertion cleanup last.
 for(const [name,policy] of Object.entries(memberPolicies)){
  const table=schema.get(name)
  if(policy.accountOnly&&table?.workspace)errors.push(name)
  const erase=policy.erase
  let generated:((c:ErasureContext)=>D1PreparedStatement[])|undefined
  if(erase){
   if(table&&!table.workspace&&policy.accountOnly)generated=c=>[c.env.DB.prepare(`DELETE FROM ${name} WHERE ${erase.column}=?`).bind(c.user)]
   else if(!table?.workspace||(!table.scope&&!erase.through))errors.push(name)
   else {
    const scope=table.scope?`${table.scope}=?`: `${erase.through} IN (SELECT id FROM conversations WHERE project_id=?)`
    const scoped=erase.nullable?`(${table.scope} IS NULL OR ${scope})`:scope
    generated=c=>[c.env.DB.prepare(`DELETE FROM ${name} WHERE ${scoped} AND (${erase.predicate??`${erase.column}=?`})`).bind(c.project,...(erase.args?.(c)??[c.user]))]
   }
  }
  // No policy can supply handwritten D1 statements. Account policies cannot
  // hide a workspace delete either; all statements come from the derived level.
  if(policy.statements)errors.push(name)
  const effects:((c:ErasureContext)=>D1PreparedStatement)[]=[]
  for(const effect of policy.effects??[]){
   const source=schema.get(effect.source??name)
   if(!table?.workspace||!source?.scope)errors.push(name)
   else effects.push(c=>c.env.DB.prepare(`${effect.prefix} WHERE ${source.scope}=? AND (${effect.where})`).bind(...(effect.before?.(c)??[]),c.project,...effect.after(c)))
  }
  if(policy.audit){
   if(!table?.workspace)errors.push(name)
   effects.push(c=>auditStatement(c.env.DB,{projectId:c.project,category:'erasure',action:'member.erased',actor:{type:'user',id:c.actor},source:'dashboard',target:{type:'member',id:c.user}},c.now))
  }
  if(policy.internal==='guard')effects.push(c=>c.env.DB.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT CASE WHEN ${c.guard.sql} THEN 1 ELSE 0 END`).bind(...c.guard.params))
  if(policy.internal==='cleanup')effects.push(c=>c.env.DB.prepare('DELETE FROM ik_d1_assertions'))
  if(policy.registration||policy.anonymize){
   if(table?.workspace||!policy.accountOnly)errors.push(name)
   if(policy.registration)effects.push(c=>c.env.DB.prepare('DELETE FROM registrations WHERE lower(email)=(SELECT lower(email) FROM users WHERE id=?)').bind(c.user))
   if(policy.anonymize)effects.push(c=>c.env.DB.prepare("UPDATE users SET name='Former teammate',email='erased:'||id WHERE id=?").bind(c.user))
  }
  // Reset links are account capabilities even when they name a workspace.
  if(policy.reset){
   if(name!=='identity_tokens')errors.push(name)
   effects.push(c=>c.env.DB.prepare("DELETE FROM identity_tokens WHERE kind='reset' AND user_id=?").bind(c.user))
  }
  entries[name]={...policy,statements:c=>[...effects.map(effect=>effect(c)),...(generated?.(c)??[])],level:table?(table.workspace?'workspace':'account'):'internal'}
 }
 for(const [name,table] of schema){
  if(table.member&&!memberPolicies[name])errors.push(name)
  entries[name]??={level:table.workspace?'workspace':'account'}
 }
 return {entries,errors:[...new Set(errors)]}
}
