import type {Actor,Env} from '../../platform/env'
import {assignmentHistoryStatement} from '../outcomes/assignment-history'
import {assignmentNotificationStatement} from '../integrations/notifications'
/** All effects depend on one admitted receipt. Field definitions, authorizations,
 * macro version and ticket frontier are checked on that receipt at commit. */
export function ticketStatements(env:Env,actor:Actor,plan:any,receipt:string,now:number){
 const {current,next,fields,change,values}=plan,accepted='EXISTS(SELECT 1 FROM macro_usage WHERE id=?)',id=current.id
 const history:any={}
 for(const key of ['status_id','status_category','priority','group_id','assigned_to'])if(current[key]!==next[key])history[key]={from:current[key],to:next[key]}
 if(Object.keys(fields).length)history.fields=Object.fromEntries(Object.entries(fields).map(([key,value])=>[key,{from:values[key]??null,to:value}]))
 if(change.tags_add?.length||change.tags_remove?.length)history.tags={add:change.tags_add,remove:change.tags_remove}
 const statements=[
  env.DB.prepare(`INSERT INTO ticket_history(id,project_id,conversation_id,actor_id,actor_type,source,at,changes_json) SELECT ?,?,?,?,'user','dashboard',?,? WHERE ${accepted}`).bind(receipt,actor.projectId,id,actor.id,now,JSON.stringify(history),receipt),
  env.DB.prepare(`INSERT OR IGNORE INTO conversation_tracking(conversation_id,project_id,initial_history_complete,cycle_history_complete,cycle_start_revision,cycle_start_at) SELECT id,project_id,0,0,revision,created_at FROM conversations WHERE id=? AND ${accepted}`).bind(id,receipt),
  env.DB.prepare(`UPDATE conversations SET status_id=?,status_category=?,resolved_at=?,priority=?,group_id=?,assigned_to=?,ticket_actor_id=?,ticket_actor_type='user',ticket_source='dashboard',updated_at=? WHERE id=? AND ${accepted}`).bind(next.status_id,next.status_category,['solved','closed'].includes(next.status_category)?current.resolved_at??now:null,next.priority,next.group_id,next.assigned_to,actor.id,now,id,receipt),
 ]
 for(const [field,value] of Object.entries(fields))statements.push(value===null?env.DB.prepare(`DELETE FROM ticket_field_values WHERE project_id=? AND conversation_id=? AND field_id=? AND ${accepted}`).bind(actor.projectId,id,field,receipt):env.DB.prepare(`INSERT INTO ticket_field_values(project_id,conversation_id,field_id,value_json) SELECT ?,?,?,? WHERE ${accepted} ON CONFLICT(project_id,conversation_id,field_id) DO UPDATE SET value_json=excluded.value_json`).bind(actor.projectId,id,field,JSON.stringify(value),receipt))
 for(const tag of change.tags_add??[])statements.push(env.DB.prepare(`INSERT OR IGNORE INTO conversation_tags(project_id,conversation_id,tag_id) SELECT ?,?,? WHERE ${accepted}`).bind(actor.projectId,id,tag,receipt))
 for(const tag of change.tags_remove??[])statements.push(env.DB.prepare(`DELETE FROM conversation_tags WHERE project_id=? AND conversation_id=? AND tag_id=? AND ${accepted}`).bind(actor.projectId,id,tag,receipt))
 if(change.agent_id)statements.push(env.DB.prepare(`UPDATE conversation_ai SET ai_id=NULL WHERE conversation_id=? AND ${accepted}`).bind(id,receipt))
 const assignmentChanged=current.assigned_to!==next.assigned_to||Boolean(change.agent_id&&current.current_ai_id)
 if(assignmentChanged||['solved','closed'].includes(next.status_category))statements.push(env.DB.prepare(`UPDATE ai_generations SET state='cancelled',updated_at=? WHERE project_id=? AND conversation_id=? AND state IN ('queued','running') AND ${accepted}`).bind(new Date(now).toISOString(),actor.projectId,id,receipt))
 if(assignmentChanged)statements.push(assignmentHistoryStatement(env,{id:receipt,conversationId:id,actorId:actor.id,agentId:next.assigned_to,aiId:change.agent_id?null:current.current_ai_id,createdAt:now},accepted,[receipt]),assignmentNotificationStatement(env,{id:receipt,projectId:actor.projectId,conversationId:id,actorId:actor.id,previousAssignee:current.assigned_to,assignee:next.assigned_to},accepted,[receipt]))
 return statements
}
