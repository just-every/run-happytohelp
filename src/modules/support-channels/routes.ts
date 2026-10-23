import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {sharedRoutes} from './shared'
import {templateRoutes} from './templates'
import {attachmentRoutes} from './media'
import {settings} from './settings'
import {inbound} from './inbound'
import {access,prefix,thread} from './model'
import {blocker} from './outbound'
export const channels=new Hono<AppEnv>()
channels.route('/',sharedRoutes);channels.route('/',templateRoutes);channels.route('/',attachmentRoutes);channels.route('/',settings);channels.route('/',inbound)
channels.get(prefix+'/conversations/:conversationId',async c=>{const actor=await access(c),id=c.req.param('conversationId')!,t=await thread(c.env,actor.projectId,id);if(!t)return c.json({data:null});const consent=await c.env.DB.prepare('SELECT event_id,kind,at,received_at FROM support_channel_consent WHERE connection_id=? AND identity_hash=? AND channel_id=? ORDER BY received_at DESC LIMIT 30').bind(t.connection_id,t.identity_hash,t.channel_id).all();const sends=await c.env.DB.prepare('SELECT message_id,state,error_code,created_at FROM support_channel_sends WHERE project_id=? AND conversation_id=? ORDER BY created_at DESC LIMIT 30').bind(actor.projectId,id).all();const changes=await c.env.DB.prepare(`SELECT ch.message_id,ch.kind,ch.content,ch.at,m.actor_id,coalesce(ct.name,u.name,'Customer') actor_name FROM support_channel_changes ch JOIN messages m ON m.id=ch.message_id AND m.erased_at IS NULL LEFT JOIN contacts ct ON ct.id=m.actor_id AND ct.project_id=m.project_id LEFT JOIN users u ON u.id=m.actor_id WHERE ch.connection_id=? AND ch.conversation_id=? ORDER BY ch.at DESC LIMIT 30`).bind(t.connection_id,id).all();const actions=await c.env.DB.prepare('SELECT state,created_at FROM support_channel_actions WHERE project_id=? AND conversation_id=? ORDER BY created_at DESC LIMIT 10').bind(actor.projectId,id).all();return c.json({data:{connection_id:t.connection_id,consent:consent.results,changes:changes.results,actions:actions.results,provider:t.provider,channel:t.channel_id,blocked:blocker(t),template_consent:!!t.template_consent,sends:sends.results}})})
channels.get(prefix+'/report',async c=>{const actor=await access(c,'reports.view');const rows=await c.env.DB.prepare('SELECT c.provider,s.state,s.error_code,count(*) count FROM support_channel_sends s JOIN support_channel_connections c ON c.id=s.connection_id WHERE s.project_id=? GROUP BY c.provider,s.state,s.error_code').bind(actor.projectId).all();return c.json({data:rows.results})})
// Consent cannot be overridden by a teammate toggle. A new verified provider consent flow is required.
channels.post(prefix+'/conversations/:conversationId/consent',async c=>{await access(c,'conversations.manage');throw new HTTPException(409,{message:'Operator consent override is unavailable. Obtain fresh customer consent through the provider; opt-out remains in force.'})})
