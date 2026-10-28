import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'
import {auditStatement,type AuditSource} from '../audit/record'

/** NULL keeps existing roles unrestricted. An empty selection deliberately sees no tickets. */
export type TicketScope={groupIds:string[];includeUngrouped:boolean}|null
export function parseTicketScope(value:string|null):TicketScope{
 if(value===null)return null
 try{
  const scope=JSON.parse(value)
  if(scope&&Array.isArray(scope.groupIds)&&scope.groupIds.every((id:unknown)=>typeof id==='string')&&typeof scope.includeUngrouped==='boolean')return scope
 }catch{}
 // Corrupt selections must never become unrestricted.
 return {groupIds:[],includeUngrouped:false}
}

/** Current native membership and role scope, evaluated inside the calling query.
 * Arguments are SQL expressions supplied by code, never request values. Bind the user ID.
 * Owners recover through their native membership; machine credentials keep their own guards.
 */
export function ticketScopeSql(user:string,ticket='c',group=`${ticket}.group_id`,ownerRecovery=true){
 return `EXISTS(SELECT 1 FROM memberships scope_member LEFT JOIN member_roles scope_assignment ON scope_assignment.project_id=scope_member.project_id AND scope_assignment.user_id=scope_member.user_id LEFT JOIN project_roles scope_role ON scope_role.project_id=scope_assignment.project_id AND scope_role.id=scope_assignment.role_key WHERE scope_member.project_id=${ticket}.project_id AND scope_member.user_id=${user} AND (${ownerRecovery?"scope_member.role='owner' OR ":''}scope_role.ticket_scope_json IS NULL OR CASE WHEN json_valid(scope_role.ticket_scope_json) THEN ((${group} IS NULL AND json_extract(scope_role.ticket_scope_json,'$.includeUngrouped')=1) OR (${group} IS NOT NULL AND EXISTS(SELECT 1 FROM json_each(scope_role.ticket_scope_json,'$.groupIds') scope_group WHERE scope_group.type='text' AND scope_group.value=${group}))) ELSE 0 END))`
}

/** Single-ticket reads use the same predicate as pagination, aggregates and commit guards. */
export async function requireTicketScope(env:Env,userId:string,projectId:string,conversationId:string,source:AuditSource='dashboard',ownerRecovery=true){
 const row=await env.DB.prepare(`SELECT 1 FROM conversations c WHERE c.project_id=? AND c.id=? AND ${ticketScopeSql('?','c','c.group_id',ownerRecovery)}`).bind(projectId,conversationId,userId).first()
 if(row)return
 await auditStatement(env.DB,{projectId,category:'access',action:'ticket.scope_denied',outcome:'refused',actor:{type:'user',id:userId},source,target:{type:'conversation',id:conversationId}}).run()
 throw new HTTPException(404,{message:'This ticket is unavailable. Your access or its group may have changed.'})
}
