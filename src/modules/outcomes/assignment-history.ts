import type {Env} from '../../platform/env'

/** Called inside the guarded write transaction, with a server-minted receipt. */
export function assignmentHistoryStatement(env:Env,event:{id:string;conversationId:string;actorId:string;agentId:string|null;aiId?:string|null;createdAt:number},accepted:string,args:unknown[]){
 const name=event.aiId?'(SELECT name FROM ai_profiles WHERE id=? AND project_id=c.project_id)':event.agentId?'(SELECT name FROM users WHERE id=?)':"'Unassigned'"
 const role=event.aiId?'(SELECT role FROM ai_profiles WHERE id=? AND project_id=c.project_id)':'NULL'
 return env.DB.prepare(`INSERT INTO context_tracked_events(id,project_id,subject_id,local_id,type,payload,created_at)
 SELECT ?,c.project_id,c.contact_id,?,'AGENT_ASSIGNED',json_object('conversation_id',c.id,'bucket_id',c.id,'agent_id',(SELECT id FROM users WHERE id=?),'actor_id',?,'assigned_to',?,'is_ai',json(?),'type',?,'name',${name},'role',${role}),?
 FROM conversations c WHERE c.id=? AND ${accepted}`)
 .bind(event.id,`assignment:${event.id}`,event.actorId,event.actorId,event.agentId,event.aiId?'true':'false',event.agentId||event.aiId?'assigned':'unassigned',...(event.aiId?[event.aiId,event.aiId]:event.agentId?[event.agentId]:[]),event.createdAt,event.conversationId,...args)
}
