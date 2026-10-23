import {HTTPException} from 'hono/http-exception'
import type {Actor,Env} from '../../platform/env'
import {validateFieldChanges} from '../tickets/fields'
import type {MemberAccess} from '../access/gate'
import {storedForm} from '../forms/store'
import {loadPublicForm} from '../forms/store'
import {validateSubmission} from '../forms/validation'
import type {OutboundTicketInput} from './outbound-ticket-input'

export async function outboundConfiguration(env:Env,actor:Actor,input:OutboundTicketInput,access:MemberAccess|null){
 if(input.configuration&&!access?.permissions.has('conversations.manage'))throw new HTTPException(403,{message:'Ticket configuration requires ticket management permission'})
 const c=input.configuration??{},assignee=c.assigneeId===undefined?actor.id:c.assigneeId,group=c.groupId??null,formId=c.formId??null,predicates:string[]=[],params:unknown[]=[]
 const bad=(message:string):never=>{throw new HTTPException(400,{message})}
 if(c.brandId!==undefined&&c.brandId!==actor.projectId)bad('Brand must be this workspace')
 if(group){if(!await env.DB.prepare('SELECT 1 FROM ticket_groups WHERE project_id=? AND id=?').bind(actor.projectId,group).first())bad('Choose a workspace group');predicates.push('EXISTS(SELECT 1 FROM ticket_groups WHERE project_id=? AND id=?)');params.push(actor.projectId,group)}
 if(assignee){const sql=`SELECT 1 FROM memberships WHERE project_id=? AND user_id=? ${group?'AND EXISTS(SELECT 1 FROM ticket_group_members WHERE project_id=? AND group_id=? AND user_id=?)':''}`,args=[actor.projectId,assignee,...(group?[actor.projectId,group,assignee]:[])];if(!await env.DB.prepare(sql).bind(...args).first())bad('Assignee must belong to the workspace and selected group');predicates.push(`EXISTS(${sql})`);params.push(...args)}
 const definitions=(await env.DB.prepare('SELECT * FROM ticket_fields WHERE project_id=?').bind(actor.projectId).all<any>()).results
 const values=validateFieldChanges(definitions,{},c.fields??{},access)
 if(formId){const stored=await storedForm(env,actor.projectId,formId);if(!stored.enabled)bad('Choose an enabled request form');const {form}=await loadPublicForm(env,actor.projectId,formId);validateSubmission(form,{subject:input.subject,message:input.content,localId:input.localId,fields:values});predicates.push('EXISTS(SELECT 1 FROM request_forms WHERE project_id=? AND id=? AND enabled=1 AND updated_at=?)');params.push(actor.projectId,formId,stored.updatedAt)}
 predicates.push(`(SELECT count(*) FROM ticket_fields WHERE project_id=?)=? AND NOT EXISTS(SELECT 1 FROM json_each(?) expected WHERE NOT EXISTS(SELECT 1 FROM ticket_fields f WHERE f.project_id=? AND f.id=json_extract(expected.value,'$.id') AND f.updated_at=json_extract(expected.value,'$.updatedAt')))`);params.push(actor.projectId,definitions.length,JSON.stringify(definitions.map(f=>({id:f.id,updatedAt:f.updated_at}))),actor.projectId)
 return {assignee,group,formId,values,sql:predicates.join(' AND '),params,channel:c.channel??(input.kind==='email'?'email':'phone'),internal:input.kind==='call'||c.internal===true}
}
