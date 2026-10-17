import type {Env} from '../../platform/env'

/** Native creation proves a complete lifecycle. An untracked pre-existing row
 * gets an explicit unknown history, never an inferred absence of handoffs.
 * Keep this admission statement independent of delivery and Worker bindings. */
export function trackingStatement(env:Env,conversationId:string,complete=false,messageId?:string){
 return env.DB.prepare(`INSERT OR IGNORE INTO conversation_tracking(conversation_id,project_id,initial_history_complete,cycle_history_complete,cycle_start_revision,cycle_start_at) SELECT id,project_id,?,?,CASE WHEN ? THEN 0 ELSE revision END,created_at FROM conversations WHERE id=? ${messageId?'AND EXISTS(SELECT 1 FROM messages WHERE id=?)':''}`).bind(complete?1:0,complete?1:0,complete?1:0,conversationId,...(messageId?[messageId]:[]))
}
