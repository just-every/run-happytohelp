import type {Env} from '../../platform/env'
import {customerAiSql} from '../ai-support/reply-mode'
/** Only the public responder identity for this visitor's conversation; never operator state or private prompts.
 * An assigned AI is the responder only while AI replies are automatic; otherwise the widget shows the team. */
export async function widgetConversationState(env:Env,projectId:string,conversationId:string,contactId:string){
 const row=await env.DB.prepare(`SELECT CASE WHEN c.assigned_to IS NULL AND a.is_enabled=1 AND ${customerAiSql('c.project_id')} THEN a.id ELSE NULL END ai_id FROM conversations c LEFT JOIN conversation_ai ca ON ca.conversation_id=c.id LEFT JOIN ai_profiles a ON a.id=ca.ai_id AND a.project_id=c.project_id WHERE c.id=? AND c.project_id=? AND c.contact_id=?`).bind(conversationId,projectId,contactId).first<{ai_id:string|null}>()
 return {ai_id:row?.ai_id??null}
}
