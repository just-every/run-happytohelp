import type {Actor,Env} from '../../platform/env'
import {teamAvailability} from './live-availability'
import {emailMode} from '../integrations/email-provider'
import {publicAppearance} from '../widget/appearance.js'
import {backAt,humanResponseTime} from '../widget/availability-text.js'
import {workflowNow} from '../workflows/clock'

/** The away reply's author, and its local id: one per conversation, since a conversation's local ids are unique,
 * even when the outbox replays the visitor's message. Clients may not mint `away:` ids (admission.ts). */
export const AWAY_AUTHOR='away',AWAY_REPLY='away:reply'

/** Outside the workspace's hours, with "Accept new conversations" off, or with no teammate online while no assistant
 * answers the workspace's visitors (presence-based away), a visitor's chat message that no assistant will answer earns
 * the workspace's away message, once per conversation (legacy chat sendMessage.js behaviour). It is the workspace
 * speaking, not a teammate or the AI: it is not emailed, earns no AI reply, and does not count as a reply in reports,
 * outcomes or automations (migration 241, workflows/time-rules.ts and rule-model.ts).
 * It is posted only directly after the message that earned it, judged by the schedule at that message's time and by
 * presence when its effects run. */
export async function postAwayReply(env:Env,message:Record<string,unknown>,actor:Actor){
 if(actor.role!=='contact'||String(message.local_id||'').startsWith('email:'))return null
 const row=await env.DB.prepare(`SELECT c.revision,c.last_message_id,p.name,s.settings_json,ct.email,json_extract(ct.metadata_json,'$.provided_email') provided_email,
  (c.assigned_to IS NULL AND EXISTS(SELECT 1 FROM conversation_ai ca JOIN ai_profiles a ON a.id=ca.ai_id AND a.project_id=c.project_id AND a.is_enabled=1 WHERE ca.conversation_id=c.id)) assistant
  FROM conversations c JOIN projects p ON p.id=c.project_id JOIN contacts ct ON ct.id=c.contact_id AND ct.project_id=c.project_id LEFT JOIN project_settings s ON s.project_id=c.project_id
  WHERE c.id=? AND c.project_id=?`).bind(message.conversation_id,actor.projectId).first<any>()
 if(!row||row.assistant||row.last_message_id!==message.id)return null
 const settings=JSON.parse(row.settings_json||'{}'),sentAt=Number(message.created_at),state=await teamAvailability(env,actor.projectId,settings,sentAt)
 if(state.available)return null
 const configured=String(state.message||'').trim(),mail=emailMode(env)!=='unavailable',known=Boolean(row.email||row.provided_email)
 const back=state.opensAt?backAt(state.opensAt,{timeZone:state.timezone,now:sentAt,withZone:true}):''
 const reply=configured||`Thanks for your message. ${publicAppearance(settings,row.name).name} is away right now${back?` and back ${back}`:''}. We'll reply here${mail?known?' and by email':', and by email if you leave your address':''}.`
 const content=back?reply:`${reply} ${humanResponseTime(settings.widget_settings?.text)}`
 // Stamped on the clock admission used for the message that earned it (a local install may set that clock).
 const id=crypto.randomUUID(),now=workflowNow(env)
 const [inserted]=await env.DB.batch([
  env.DB.prepare(`INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at) SELECT ?,c.project_id,c.id,?,?,'system',?,c.revision+1,? FROM conversations c
   WHERE c.id=? AND c.project_id=? AND c.revision=? AND c.last_message_id=? AND NOT EXISTS(SELECT 1 FROM messages WHERE conversation_id=c.id AND local_id=?)`)
   .bind(id,AWAY_REPLY,AWAY_AUTHOR,content,now,message.conversation_id,actor.projectId,row.revision,message.id,AWAY_REPLY),
  env.DB.prepare('UPDATE conversations SET revision=revision+1,last_message_id=?,updated_at=? WHERE id=? AND EXISTS(SELECT 1 FROM messages WHERE id=?)').bind(id,now,message.conversation_id,id),
  // Delivered on insert: open widgets and inboxes receive it through the socket, and no follow-up ever runs for it.
  env.DB.prepare('INSERT INTO conversation_outbox(project_id,conversation_id,message_id,created_at,delivered_at) SELECT project_id,conversation_id,id,created_at,created_at FROM messages WHERE id=?').bind(id),
 ])
 return inserted.meta.changes?id:null
}
