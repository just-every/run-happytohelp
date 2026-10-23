import type {Env} from '../../platform/env'
import {HTTPException} from 'hono/http-exception'
import {availableTicketSql,invalid,fieldAllowed} from '../tickets/model'
import {validateFieldValue} from '../tickets/fields'
import {publishActivity} from '../conversations/activity'
import {publishResolution} from '../outcomes/state'
import {assignmentHistoryStatement} from '../outcomes/assignment-history'
import {workflowNow} from './clock'
import {workflowMemberGuard} from './rule-access'
import {checkedActions,type WorkflowAction} from './actions-validation'
export type {WorkflowAction} from './actions-validation'
export interface WorkflowGuard {sql:string;params:unknown[]}
export interface WorkflowActionInput {projectId:string;conversationId:string;id:string;source:string;actorId:string;expectedVersion?:number;expectedRevision?:number;expectedLastMessageId?:string|null;actions:WorkflowAction[];guard?:WorkflowGuard;noteAuthorId?:string;after?:((accepted:string,args:unknown[])=>D1PreparedStatement[]) }
/** Internal system writer. No user/session is fabricated. A unique receipt and
 * the live frontier authorize every statement in one D1 transaction. */
export async function applyWorkflowActions(env:Env,input:WorkflowActionInput){
 const {projectId,conversationId,id,source,actorId}=input
 const previous=await env.DB.prepare('SELECT id FROM workflow_action_receipts WHERE id=? AND project_id=? AND conversation_id=?').bind(id,projectId,conversationId).first()
 if(previous)return {state:'complete' as const,replayed:true}
 const actions=checkedActions(input.actions)
 if(actions.some(a=>a.type==='notify'||a.type==='route'||a.type==='webhook'))invalid('Notification, webhook and routing actions use their durable executors')
 const current=await env.DB.prepare(`SELECT c.*,(SELECT ai_id FROM conversation_ai WHERE conversation_id=c.id) current_ai_id FROM conversations c WHERE c.project_id=? AND c.id=? AND ${availableTicketSql()}`).bind(projectId,conversationId).first<any>()
 if(!current||current.status_category==='closed')return {state:'stale' as const}
 if(input.expectedVersion!==undefined&&input.expectedVersion!==current.ticket_version||input.expectedRevision!==undefined&&input.expectedRevision!==current.revision||input.expectedLastMessageId!==undefined&&input.expectedLastMessageId!==current.last_message_id)return {state:'stale' as const}
 const next={...current},predicates:string[]=[],params:unknown[]=[],fieldValues:Record<string,unknown>={},fieldBefore:Record<string,unknown>={},tagsAdd=new Set<string>(),tagsRemove=new Set<string>(),notes:string[]=[]
 const fieldAuthority=actions.some(a=>a.type==='fields')?await workflowMemberGuard(env,projectId,input.noteAuthorId??actorId):null
 if(fieldAuthority){predicates.push(fieldAuthority.guard.sql);params.push(...fieldAuthority.guard.params)}
 const fieldIds=[...new Set(actions.flatMap(a=>a.type==='fields'?Object.keys(a.values):[]))],fieldRows=fieldIds.length?(await env.DB.prepare('SELECT f.*,v.value_json FROM ticket_fields f LEFT JOIN ticket_field_values v ON v.project_id=f.project_id AND v.field_id=f.id AND v.conversation_id=? WHERE f.project_id=? AND f.id IN (SELECT value FROM json_each(?))').bind(conversationId,projectId,JSON.stringify(fieldIds)).all<any>()).results:[],fields=new Map(fieldRows.map(f=>[f.id,f]))
 const pinFields=(rows:any[])=>{predicates.push("NOT EXISTS(SELECT 1 FROM json_each(?) ref WHERE NOT EXISTS(SELECT 1 FROM ticket_fields f WHERE f.project_id=c.project_id AND f.id=json_extract(ref.value,'$[0]') AND f.updated_at=json_extract(ref.value,'$[1]')))");params.push(JSON.stringify(rows.map(f=>[f.id,f.updated_at])))}
 if(fieldRows.length)pinFields(fieldRows)
 const exists=async(sql:string,args:unknown[],message:string)=>{if(!await env.DB.prepare(sql).bind(...args).first())throw new HTTPException(409,{message});predicates.push(`EXISTS(${sql})`);params.push(...args)}
 for(const a of actions){switch(a.type){
  case 'status':{const s=await env.DB.prepare('SELECT * FROM ticket_statuses WHERE project_id=? AND id=? AND active=1').bind(projectId,a.status_id).first<any>();if(!s)invalid('Choose an active workspace status');next.status_id=s.id;next.status_category=s.category;predicates.push('EXISTS(SELECT 1 FROM ticket_statuses WHERE project_id=c.project_id AND id=? AND category=? AND active=1 AND updated_at=?)');params.push(s.id,s.category,s.updated_at);break}
  case 'priority':next.priority=a.priority;break
  case 'assign':next.assigned_to=a.user_id;if(a.group_id!==undefined)next.group_id=a.group_id;break
  case 'tags':for(const tag of a.add??[]){tagsAdd.add(tag);tagsRemove.delete(tag)}for(const tag of a.remove??[]){tagsRemove.add(tag);tagsAdd.delete(tag)}break
  case 'fields':for(const [fieldId,value] of Object.entries(a.values)){const f=fields.get(fieldId);if(!f)invalid('Unknown workflow field');if(!fieldAllowed(f,fieldAuthority!.access)||!fieldAllowed(f,fieldAuthority!.access,true))throw new HTTPException(403,{message:'Workflow publisher cannot write this field'});fieldBefore[fieldId]=f.value_json===null?null:JSON.parse(f.value_json);fieldValues[fieldId]=validateFieldValue(f,value)}break
  case 'note':notes.push(a.content);break
 }}
 if(['solved','closed'].includes(next.status_category)){
  const required=(await env.DB.prepare('SELECT f.*,v.value_json FROM ticket_fields f LEFT JOIN ticket_field_values v ON v.project_id=f.project_id AND v.field_id=f.id AND v.conversation_id=? WHERE f.project_id=? AND f.required=1').bind(conversationId,projectId).all<any>()).results
  for(const f of required){validateFieldValue(f,f.id in fieldValues?fieldValues[f.id]:f.value_json===null?null:JSON.parse(f.value_json))}
  pinFields(required)
  predicates.push('(SELECT count(*) FROM ticket_fields WHERE project_id=c.project_id AND required=1)=?');params.push(required.length)
 }
 if(next.group_id)await exists('SELECT 1 FROM ticket_groups WHERE project_id=? AND id=?',[projectId,next.group_id],'Responsible group is unavailable')
 if(next.assigned_to){await exists(`SELECT 1 FROM memberships m LEFT JOIN member_roles mr ON mr.project_id=m.project_id AND mr.user_id=m.user_id LEFT JOIN project_roles pr ON pr.project_id=mr.project_id AND pr.id=mr.role_key WHERE m.project_id=? AND m.user_id=? AND (m.role='owner' OR (coalesce(mr.role_key,'')<>'collaborator' AND (pr.id IS NULL OR pr.base IN ('admin','operator') AND EXISTS(SELECT 1 FROM json_each(pr.permissions_json) WHERE value='conversations.manage')))) ${next.group_id?'AND EXISTS(SELECT 1 FROM ticket_group_members gm WHERE gm.project_id=m.project_id AND gm.user_id=m.user_id AND gm.group_id=?)':''}`,[projectId,next.assigned_to,...(next.group_id?[next.group_id]:[])],'Assignee is no longer an authorized member of the responsible group')}
 if(tagsAdd.size||tagsRemove.size)await exists('SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM json_each(?) ref WHERE NOT EXISTS(SELECT 1 FROM workspace_tags WHERE project_id=? AND id=ref.value))',[JSON.stringify([...new Set([...tagsAdd,...tagsRemove])]),projectId],'Tag is unavailable')
 const noteAuthor=input.noteAuthorId??actorId
 if(notes.length)await exists('SELECT 1 FROM memberships WHERE project_id=? AND user_id=?',[projectId,noteAuthor],'Automation note author is no longer a workspace member')
 const now=Math.max(workflowNow(env),current.updated_at+1),history:Record<string,unknown>={}
 for(const key of ['status_id','status_category','priority','assigned_to','group_id'])if(current[key]!==next[key])history[key]={from:current[key],to:next[key]}
 if(Object.keys(fieldValues).length)history.fields=Object.fromEntries(Object.entries(fieldValues).map(([key,value])=>[key,{from:fieldBefore[key]??null,to:value}]))
 if(tagsAdd.size||tagsRemove.size)history.tags={add:[...tagsAdd],remove:[...tagsRemove]}
 if(notes.length)history.notes={count:notes.length}
 const claim=crypto.randomUUID(),accepted='EXISTS(SELECT 1 FROM workflow_action_receipts WHERE id=? AND project_id=? AND conversation_id=? AND claim_token=?)',args=[id,projectId,conversationId,claim]
 const statements=[env.DB.prepare(`INSERT OR IGNORE INTO workflow_action_receipts(id,project_id,conversation_id,source,actor_id,claim_token,created_at,changes_json) SELECT ?,c.project_id,c.id,?,?,?,?,? FROM conversations c WHERE c.id=? AND c.project_id=? AND c.ticket_version=? AND c.revision=? AND c.last_message_id IS ? AND c.updated_at=? AND c.status_category<>'closed' AND ${availableTicketSql()} AND NOT EXISTS(SELECT 1 FROM contact_erasures er WHERE er.project_id=c.project_id AND er.contact_id=c.contact_id) AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=c.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL) ${predicates.map(p=>'AND '+p).join(' ')} ${input.guard?'AND ('+input.guard.sql+')':''}`).bind(id,source,actorId,claim,now,JSON.stringify(history),conversationId,projectId,current.ticket_version,current.revision,current.last_message_id,current.updated_at,...params,...(input.guard?.params??[])),
 env.DB.prepare(`INSERT INTO ticket_history(id,project_id,conversation_id,actor_id,actor_type,source,at,changes_json) SELECT ?,?,?,?,'system',?,?,? WHERE ${accepted} AND NOT EXISTS(SELECT 1 FROM ticket_history WHERE id=?)`).bind(id,projectId,conversationId,actorId,source,now,JSON.stringify(history),...args,id),
 env.DB.prepare(`INSERT OR IGNORE INTO conversation_tracking(conversation_id,project_id,initial_history_complete,cycle_history_complete,cycle_start_revision,cycle_start_at) SELECT id,project_id,0,0,revision,created_at FROM conversations WHERE id=? AND ${accepted}`).bind(conversationId,...args),
 env.DB.prepare(`UPDATE conversations SET status_id=?,status_category=?,resolved_at=?,priority=?,assigned_to=?,group_id=?,ticket_actor_id=?,ticket_actor_type='system',ticket_source=?,updated_at=? WHERE id=? AND ${accepted}`).bind(next.status_id,next.status_category,['solved','closed'].includes(next.status_category)?current.resolved_at??now:null,next.priority,next.assigned_to,next.group_id,actorId,source,now,conversationId,...args)]
 if(Object.keys(fieldValues).length){
  const values=JSON.stringify(Object.entries(fieldValues).map(([field,value])=>({field,value:value===null?null:JSON.stringify(value)})))
  statements.push(env.DB.prepare(`DELETE FROM ticket_field_values WHERE project_id=? AND conversation_id=? AND field_id IN (SELECT json_extract(value,'$.field') FROM json_each(?) WHERE json_extract(value,'$.value') IS NULL) AND ${accepted}`).bind(projectId,conversationId,values,...args),
   env.DB.prepare(`INSERT INTO ticket_field_values(project_id,conversation_id,field_id,value_json) SELECT ?,?,json_extract(value,'$.field'),json_extract(value,'$.value') FROM json_each(?) WHERE json_extract(value,'$.value') IS NOT NULL AND ${accepted} ON CONFLICT(project_id,conversation_id,field_id) DO UPDATE SET value_json=excluded.value_json`).bind(projectId,conversationId,values,...args))
 }
 if(tagsAdd.size)statements.push(env.DB.prepare(`INSERT OR IGNORE INTO conversation_tags(project_id,conversation_id,tag_id) SELECT ?,?,value FROM json_each(?) WHERE ${accepted}`).bind(projectId,conversationId,JSON.stringify([...tagsAdd]),...args))
 if(tagsRemove.size)statements.push(env.DB.prepare(`DELETE FROM conversation_tags WHERE project_id=? AND conversation_id=? AND tag_id IN (SELECT value FROM json_each(?)) AND ${accepted}`).bind(projectId,conversationId,JSON.stringify([...tagsRemove]),...args))
 for(let n=0;n<notes.length;n++)statements.push(env.DB.prepare(`INSERT OR IGNORE INTO conversation_notes(id,conversation_id,user_id,content,created_at) SELECT ?,?,?,?,? WHERE ${accepted}`).bind(`${id}:note:${n}`,conversationId,noteAuthor,`[${actorId}] ${notes[n]}`,now,...args))
 const assignmentChanged=current.assigned_to!==next.assigned_to
 if(assignmentChanged){statements.push(env.DB.prepare(`UPDATE conversation_ai SET ai_id=NULL WHERE conversation_id=? AND ${accepted}`).bind(conversationId,...args),assignmentHistoryStatement(env,{id,conversationId,actorId:noteAuthor,agentId:next.assigned_to,createdAt:now},accepted,args))}
 if(assignmentChanged||['solved','closed'].includes(next.status_category))statements.push(env.DB.prepare(`UPDATE ai_generations SET state='cancelled',updated_at=? WHERE project_id=? AND conversation_id=? AND state IN ('queued','running') AND ${accepted}`).bind(new Date(now).toISOString(),projectId,conversationId,...args))
 if(input.after)statements.push(...input.after(accepted,args))
 const result=await env.DB.batch(statements)
 if(!result[0].meta.changes)return {state:'stale' as const}
 // Committed local changes must never be reclassified as a retryable failure.
 let refresh='complete'
 try{await publishActivity(env,projectId,conversationId,'workflow');if(current.status_id!==next.status_id)await publishResolution(env,projectId,conversationId)}catch{refresh='failed'}
 return {state:'complete' as const,replayed:false,refresh}
}
