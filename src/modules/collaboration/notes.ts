import {agentOperation,nativeAgentAuthority,type NativeAgentAuthority} from '../../platform/agent-authority'
import {HTTPException} from 'hono/http-exception'
import type {Actor,Env} from '../../platform/env'
import {requiredString,id} from '../../platform/db'
import {publishActivity} from '../conversations/activity'
import {notifyTicketEvent} from '../integrations/triggers'
import {assertPublicReplyPlaceholders} from '../macros/placeholders'
import {prepareNoteMedia} from './note-media'
import {collaborationGuard,memberIds,type CollaborationAuthority} from './authority'

/** Canonical persisted mention syntax; names are ordinary note text, IDs provide identity. */
export function mentionedUserIds(content:string){return [...new Set([...content.matchAll(/@\[([^\]\n]{1,120})\]\(user:([^\s)\n]{1,200})\)/g)].map(match=>match[2]))]}
export async function createNote(env:Env,actor:Actor,conversationId:string,body:Record<string,unknown>,authority:CollaborationAuthority){
 if(!body||typeof body!=='object'||Array.isArray(body))throw new HTTPException(400,{message:'Provide a note.'})
 const content=requiredString(body.content,'content',50000),mentions=memberIds(mentionedUserIds(content))
 // Explicit IDs must describe exactly the note's visible mentions, never hidden notifications.
 if(body.mention_ids!==undefined){const supplied=memberIds(body.mention_ids);if(supplied.length!==mentions.length||supplied.some(id=>!mentions.includes(id)))throw new HTTPException(400,{message:'Mention recipients must match the teammates selected in the note.'})}
 assertPublicReplyPlaceholders(content)
 const media=await prepareNoteMedia(env,actor,conversationId,body.media_ids)
 const guard=await collaborationGuard(env,actor,conversationId,mentions,authority,'conversations.notes'),key=id(),now=Date.now()
 const result=await env.DB.batch([
  env.DB.prepare(`INSERT INTO conversation_notes(id,conversation_id,user_id,content,created_at) SELECT ?,?,?,?,? WHERE EXISTS(${guard.sql}) AND EXISTS(${media.guard.sql})`).bind(key,conversationId,actor.id,content,now,...guard.params,...media.guard.params),
  env.DB.prepare('INSERT INTO conversation_note_mentions(note_id,user_id,created_at) SELECT n.id,j.value,? FROM conversation_notes n JOIN json_each(?) j WHERE n.id=?').bind(now,JSON.stringify(mentions),key),
  env.DB.prepare('INSERT INTO conversation_note_media(note_id,media_id) SELECT n.id,j.value FROM conversation_notes n JOIN json_each(?) j WHERE n.id=?').bind(JSON.stringify(media.ids),key),
  env.DB.prepare('DELETE FROM macro_drafts WHERE project_id=? AND conversation_id=? AND actor_id=? AND EXISTS(SELECT 1 FROM conversation_notes WHERE id=?)').bind(actor.projectId,conversationId,actor.id,key),
  env.DB.prepare("INSERT INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,detail_json) SELECT ?,?,?,'data','conversation.note_created','succeeded','user',?,?,'note',?,? WHERE EXISTS(SELECT 1 FROM conversation_notes WHERE id=?)").bind(crypto.randomUUID(),actor.projectId,now,actor.id,authority.source??'dashboard',key,JSON.stringify({conversationId,mentionIds:mentions,attachmentCount:media.ids.length}),key),
  ...(authority[nativeAgentAuthority]?[agentOperation(env,authority as NativeAgentAuthority,'conversation',conversationId,{sql:'EXISTS(SELECT 1 FROM conversation_notes WHERE id=?)',params:[key]},{note_id:key})]:[]),
 ])
 if(!result[0].meta.changes)throw new HTTPException(409,{message:'Conversation access changed. Reload and try again.'})
 await publishActivity(env,actor.projectId,conversationId,'note')
 await notifyTicketEvent(env,{projectId:actor.projectId,conversationId,event:mentions.length?'mention':'ticket_updated',eventId:key,actorId:actor.id,recipientIds:mentions,source:'native'})
 return {id:key,type:'INTERNAL_NOTE',payload:content,content,agent_id:actor.id,conversation_id:conversationId,bucket_id:conversationId,created_at:new Date(now).toISOString(),mention_ids:mentions,media:media.media}
}
