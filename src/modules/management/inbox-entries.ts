import {ticketScopeSql} from '../access/ticket-scope'

/** A SQL condition and its bound values, in order. */
export type Clause={sql:string;params:unknown[]}
export const clauses=(list:Clause[])=>({sql:list.map(clause=>clause.sql).join(' AND ')||'1',params:list.flatMap(clause=>clause.params)})

/** The inbox's membership, deleted-workspace and role-scope conditions over an inbox entry, a tally row or a
 * member's unread row (alias `x`; each carries the conversation's workspace and group). Exactly the
 * per-conversation conditions the inbox and its counts apply, each evaluated once per request as a set the
 * rows are checked against:
 * - membership (and, for the list, a workspace that is not deleted; the counts never applied that);
 * - the role scope (access/ticket-scope.ts) depends only on the workspace and group, so it is the workspaces
 *   it cannot narrow (an owner, or a role without a ticket scope), the workspaces whose ungrouped tickets it
 *   admits, and the (workspace, group) pairs it admits. A group missing from ticket_groups is admitted only
 *   by an unnarrowed role, as there. */
// The sets the role scope is evaluated as: the member's workspaces (not deleted, for the list), the workspaces its role
// cannot narrow, the workspaces whose ungrouped tickets it admits, and the (workspace, group) pairs it admits. Each
// binds the user id once.
const members=(deleted:boolean)=>`SELECT access_member.project_id FROM memberships access_member WHERE access_member.user_id=?${deleted?` AND NOT EXISTS(SELECT 1 FROM project_settings deleted WHERE deleted.project_id=access_member.project_id AND json_extract(deleted.settings_json,'$.deleted_at') IS NOT NULL)`:''}`
const unrestricted=`SELECT open_member.project_id FROM memberships open_member LEFT JOIN member_roles open_assignment ON open_assignment.project_id=open_member.project_id AND open_assignment.user_id=open_member.user_id LEFT JOIN project_roles open_role ON open_role.project_id=open_assignment.project_id AND open_role.id=open_assignment.role_key WHERE open_member.user_id=? AND (open_member.role='owner' OR open_role.ticket_scope_json IS NULL)`
const ungrouped=`SELECT ungrouped_member.project_id FROM memberships ungrouped_member WHERE ungrouped_member.user_id=? AND ${ticketScopeSql('?','ungrouped_member','NULL')}`
const grouped=`SELECT allowed_group.project_id,allowed_group.id FROM ticket_groups allowed_group WHERE allowed_group.project_id IN (SELECT group_member.project_id FROM memberships group_member WHERE group_member.user_id=?) AND ${ticketScopeSql('?','allowed_group','allowed_group.id')}`
export function inboxAccess(x:string,userId:string,{project,deleted}:{project?:string;deleted:boolean}):Clause[]{
 const list:Clause[]=[inboxWorkspaces(x,userId,{deleted})[0]]
 list.push({sql:`(${x}.project_id IN (${unrestricted}) OR (${x}.group_id IS NULL AND ${x}.project_id IN (${ungrouped})) OR (${x}.project_id,${x}.group_id) IN (${grouped}))`,params:[userId,userId,userId,userId,userId]})
 if(project)list.push({sql:`${x}.project_id=?`,params:[project]})
 return list
}
/** The member's workspaces (and the requested one) alone, without the role scope: the rows an index walk reads. */
export function inboxWorkspaces(x:string,userId:string,{project,deleted}:{project?:string;deleted:boolean}):Clause[]{
 return [{sql:`${x}.project_id IN (${members(deleted)})`,params:[userId]},...(project?[{sql:`${x}.project_id=?`,params:[project]}]:[])]
}
/** inboxAccess and inboxWorkspaces with the sets read once for the request (one statement), then bound as lists,
 * for a request that applies them in many statements. */
export async function resolvedInboxAccess(db:D1Database,userId:string,{project,deleted}:{project?:string;deleted:boolean}){
 const sets=await db.prepare(`SELECT (SELECT json_group_array(project_id) FROM (${members(deleted)})) members,(SELECT json_group_array(project_id) FROM (${unrestricted})) unrestricted,(SELECT json_group_array(project_id) FROM (${ungrouped})) ungrouped,(SELECT json_group_array(json_array(project_id,id)) FROM (${grouped})) grouped`).bind(userId,userId,userId,userId,userId,userId).first<Record<'members'|'unrestricted'|'ungrouped'|'grouped',string>>()
 const listed=(x:string,set:string)=>`${x}.project_id IN (SELECT value FROM json_each(?))`
 const workspace=(x:string):Clause[]=>[{sql:listed(x,'members'),params:[sets!.members]},...(project?[{sql:`${x}.project_id=?`,params:[project]}]:[])]
 const access=(x:string):Clause[]=>[workspace(x)[0],{sql:`(${listed(x,'unrestricted')} OR (${x}.group_id IS NULL AND ${listed(x,'ungrouped')}) OR (${x}.project_id,${x}.group_id) IN (SELECT value->>0,value->>1 FROM json_each(?)))`,params:[sets!.unrestricted,sets!.ungrouped,sets!.grouped]},...workspace(x).slice(1)]
 return {access,workspace,members:(JSON.parse(sets!.members) as string[]).filter(id=>!project||id===project)}
}
