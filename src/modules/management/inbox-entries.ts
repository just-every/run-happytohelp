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
export function inboxAccess(x:string,userId:string,{project,deleted}:{project?:string;deleted:boolean}):Clause[]{
 const list:Clause[]=[{sql:`${x}.project_id IN (SELECT access_member.project_id FROM memberships access_member WHERE access_member.user_id=?${deleted?` AND NOT EXISTS(SELECT 1 FROM project_settings deleted WHERE deleted.project_id=access_member.project_id AND json_extract(deleted.settings_json,'$.deleted_at') IS NOT NULL)`:''})`,params:[userId]}]
 const unrestricted=`SELECT open_member.project_id FROM memberships open_member LEFT JOIN member_roles open_assignment ON open_assignment.project_id=open_member.project_id AND open_assignment.user_id=open_member.user_id LEFT JOIN project_roles open_role ON open_role.project_id=open_assignment.project_id AND open_role.id=open_assignment.role_key WHERE open_member.user_id=? AND (open_member.role='owner' OR open_role.ticket_scope_json IS NULL)`
 const ungrouped=`SELECT ungrouped_member.project_id FROM memberships ungrouped_member WHERE ungrouped_member.user_id=? AND ${ticketScopeSql('?','ungrouped_member','NULL')}`
 const grouped=`SELECT allowed_group.project_id,allowed_group.id FROM ticket_groups allowed_group WHERE allowed_group.project_id IN (SELECT group_member.project_id FROM memberships group_member WHERE group_member.user_id=?) AND ${ticketScopeSql('?','allowed_group','allowed_group.id')}`
 list.push({sql:`(${x}.project_id IN (${unrestricted}) OR (${x}.group_id IS NULL AND ${x}.project_id IN (${ungrouped})) OR (${x}.project_id,${x}.group_id) IN (${grouped}))`,params:[userId,userId,userId,userId,userId]})
 if(project)list.push({sql:`${x}.project_id=?`,params:[project]})
 return list
}

