import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'
import {auditStatement,type AuditSource} from '../audit/record'

/** NULL keeps existing roles unrestricted. An empty selection deliberately sees no tickets. */
export type TicketScope={groupIds:string[];includeUngrouped:boolean}|null
export function parseTicketScope(value:string|null):TicketScope{
 if(value===null)return null
 try{
  const scope=JSON.parse(value)
  if(scope&&typeof scope==='object'&&!Array.isArray(scope)&&Object.keys(scope).every(key=>['groupIds','includeUngrouped'].includes(key))&&Array.isArray(scope.groupIds)&&scope.groupIds.every((id:unknown)=>typeof id==='string'&&id.length>0)&&typeof scope.includeUngrouped==='boolean')return {groupIds:scope.groupIds,includeUngrouped:scope.includeUngrouped}
 }catch{}
 // Corrupt selections must never become unrestricted.
 return {groupIds:[],includeUngrouped:false}
}

/** Current native membership and role scope, evaluated inside the calling query.
 * Arguments are SQL expressions supplied by code, never request values. Bind the user ID.
 * Owners recover through their native membership; machine credentials keep their own guards.
 */
export function ticketScopeSql(user:string,ticket='c',group=`${ticket}.group_id`,ownerRecovery=true){
 const scope='scope_access.ticket_scope_json'
 // Validate the whole stored selection before matching a ticket. A stale, foreign
 // or malformed group must not leave the ungrouped or other selected door open.
 const valid=`json_type(${scope})='object' AND json_type(${scope},'$.groupIds')='array' AND json_type(${scope},'$.includeUngrouped') IN ('true','false') AND NOT EXISTS(SELECT 1 FROM json_each(${scope}) scope_key WHERE scope_key.key NOT IN ('groupIds','includeUngrouped')) AND NOT EXISTS(SELECT 1 FROM json_each(${scope},'$.groupIds') selected_group LEFT JOIN ticket_groups workspace_group ON workspace_group.project_id=${ticket}.project_id AND workspace_group.id=selected_group.value WHERE (selected_group.type<>'text' OR workspace_group.id IS NULL))`
 // Materializing the membership row keeps composed note/mobile commit guards
 // below D1's expression-depth limit without caching authority across statements.
 return `EXISTS(WITH scope_access AS MATERIALIZED (SELECT scope_member.role,scope_role.ticket_scope_json FROM memberships scope_member LEFT JOIN member_roles scope_assignment ON scope_assignment.project_id=scope_member.project_id AND scope_assignment.user_id=scope_member.user_id LEFT JOIN project_roles scope_role ON scope_role.project_id=scope_assignment.project_id AND scope_role.id=scope_assignment.role_key WHERE scope_member.project_id=${ticket}.project_id AND scope_member.user_id=${user}) SELECT 1 FROM scope_access WHERE (${ownerRecovery?"scope_access.role='owner' OR ":''}${scope} IS NULL OR CASE WHEN json_valid(${scope}) THEN CASE WHEN ${valid} THEN ((${group} IS NULL AND json_extract(${scope},'$.includeUngrouped')=1) OR ${group} IN (SELECT value FROM json_each(${scope},'$.groupIds'))) ELSE 0 END ELSE 0 END))`
}

/** Single-ticket reads use the same predicate as admission and commit guards. */
export async function requireTicketScope(env:Env,userId:string,projectId:string,conversationId:string,source:AuditSource='dashboard',ownerRecovery=true){
 const row=await env.DB.prepare(`SELECT 1 FROM conversations c WHERE c.project_id=? AND c.id=? AND ${ticketScopeSql('?','c','c.group_id',ownerRecovery)}`).bind(projectId,conversationId,userId).first()
 if(row)return
 await auditStatement(env.DB,{projectId,category:'access',action:'ticket.scope_denied',outcome:'refused',actor:{type:'user',id:userId},source,target:{type:'conversation',id:conversationId}}).run()
 throw new HTTPException(404,{message:'This ticket is unavailable. Your access or its group may have changed.'})
}
