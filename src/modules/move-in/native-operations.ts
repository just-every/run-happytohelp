/** Native work is outside a historical import's write and reversal authority. */
export const operationalTables:readonly (readonly [string,string,string,string])[]=[
 ['ticket_handle_sessions','conversation_id','id,project_id,conversation_id,user_id,started_at,ended_at,adjusted_duration_ms,adjustment_reason,adjusted_by,adjusted_at,ended_by','id'],
 ['ticket_problems','conversation_id','project_id,conversation_id,version,created_at','conversation_id'],
 ['ticket_problem_incidents','incident_id','project_id,problem_id,incident_id,created_at','incident_id'],
 ['ticket_problem_previews','problem_id','id,project_id,problem_id,actor_id,problem_version,problem_ticket_version,problem_revision,problem_last_message_id,plan_json,created_at,expires_at,state','id'],
 ['ticket_problem_attempts','incident_id','id,preview_id,project_id,problem_id,incident_id,local_id,message_id,state,reason,created_at,updated_at','id'],
]
export const isOperationalTable=(name:string)=>operationalTables.some(([table])=>table===name)
export function operationalReference(name:string,alias:string,id:string,project:string):string{
 const message=(column:string)=>`EXISTS(SELECT 1 FROM messages native_message WHERE native_message.project_id=${project} AND native_message.conversation_id=${id} AND native_message.id=${alias}.${column})`
 if(name==='ticket_handle_sessions'||name==='ticket_problems')return `${alias}.conversation_id=${id}`
 if(name==='ticket_problem_incidents')return `(${alias}.problem_id=${id} OR ${alias}.incident_id=${id})`
 if(name==='ticket_problem_previews')return `(${alias}.problem_id=${id} OR ${message('problem_last_message_id')} OR NOT json_valid(${alias}.plan_json) OR EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(${alias}.plan_json) THEN ${alias}.plan_json ELSE '{}' END,'$.tickets') native_ticket WHERE json_extract(native_ticket.value,'$.id')=${id}))`
 if(name==='ticket_problem_attempts')return `(${alias}.problem_id=${id} OR ${alias}.incident_id=${id} OR ${message('message_id')})`
 throw new Error('unsupported_native_operation')
}
export function noNativeOperations(project:string,id:string){return operationalTables.map(([name])=>`NOT EXISTS(SELECT 1 FROM ${name} native_operation WHERE native_operation.project_id=${project} AND ${operationalReference(name,'native_operation',id,project)})`).join(' AND ')}
