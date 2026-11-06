import {HTTPException} from 'hono/http-exception'
import type {Actor,Env} from '../../platform/env'
import {agentOperation,nativeAgentAuthority,type NativeAgentAuthority} from '../../platform/agent-authority'
import {availableTicketSql,getTicket,ticketAuthority,type TicketAuthority} from '../tickets/model'
import {requiredString} from '../../platform/db'

/** The native composer owns one slot per person. Its opaque id is a compare-and-swap
 * version, including when the current draft came from a macro. No delivery work is admitted. */
export async function saveReplyDraft(env:Env,actor:Actor,conversationId:string,input:{content:unknown;draft_id:string|null;revision:number;last_message_id:string|null},authority:TicketAuthority){
 const content=requiredString(input.content,'content',50000)
 const guard=await ticketAuthority(env,actor,authority,'conversations.reply')
 await getTicket(env,actor,conversationId)
 const version=crypto.randomUUID(),now=Date.now()
 const result=await env.DB.batch([
  env.DB.prepare(`INSERT INTO macro_drafts(project_id,conversation_id,actor_id,usage_id,draft_id,content,reply_type,unresolved_json,media_ids_json,updated_at)
   SELECT c.project_id,c.id,?,NULL,?,?,'public','[]','[]',? FROM conversations c
   WHERE c.id=? AND c.project_id=? AND c.revision=? AND c.last_message_id IS ? AND c.status_category<>'closed' AND ${availableTicketSql()}
   AND EXISTS(${guard.sql}) AND (SELECT coalesce(draft_id,usage_id) FROM macro_drafts WHERE project_id=c.project_id AND conversation_id=c.id AND actor_id=?) IS ?
   ON CONFLICT(project_id,conversation_id,actor_id) DO UPDATE SET usage_id=NULL,draft_id=excluded.draft_id,content=excluded.content,reply_type=excluded.reply_type,unresolved_json='[]',media_ids_json='[]',updated_at=excluded.updated_at`)
   .bind(actor.id,version,content,now,conversationId,actor.projectId,input.revision,input.last_message_id,...guard.params,actor.id,input.draft_id),
  ...(authority[nativeAgentAuthority]?[agentOperation(env,authority as NativeAgentAuthority,'conversation',conversationId,{sql:'EXISTS(SELECT 1 FROM macro_drafts WHERE project_id=? AND conversation_id=? AND actor_id=? AND draft_id=?)',params:[actor.projectId,conversationId,actor.id,version]},{draft_id:version})]:[]),
 ])
 if(!result[0].meta.changes)throw new HTTPException(409,{message:'Draft, conversation or authority changed. Read the current draft before editing.'})
 // Only identifiers enter the door's durable replay receipt. Content is read afresh
 // through the native draft service, after current ownership and erasure checks.
 return {id:version,conversation_id:conversationId,revision:input.revision}
}
