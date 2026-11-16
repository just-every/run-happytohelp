import type {Env} from '../../platform/env'

/** Ordinary replies must not undo the latest explicit macro assignment. A later
 * assignment through the native controls supersedes it, even after its draft is sent. */
export async function preservesMacroAssignment(env:Env,projectId:string,conversationId:string,assignee:string|null){
 const decision=await env.DB.prepare(`SELECT v.actions_json FROM ticket_history h
 LEFT JOIN macro_usage u ON u.id=h.id AND u.project_id=h.project_id AND u.conversation_id=h.conversation_id
 LEFT JOIN macro_versions v ON v.project_id=u.project_id AND v.macro_id=u.macro_id AND v.version=u.version
 WHERE h.project_id=? AND h.conversation_id=? AND
 (json_type(h.changes_json,'$.assigned_to') IS NOT NULL OR json_type(v.actions_json,'$.agent_id') IS NOT NULL)
 ORDER BY h.at DESC,h.id DESC LIMIT 1`).bind(projectId,conversationId).first<{actions_json:string|null}>()
 if(!decision?.actions_json)return false
 const actions=JSON.parse(decision.actions_json)
 return Object.hasOwn(actions,'agent_id')&&actions.agent_id===assignee
}
