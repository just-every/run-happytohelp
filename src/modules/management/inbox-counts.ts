import type {Env} from '../../platform/env'
import {memberAccess} from '../access/gate'
import {inboxAccess,clauses} from './inbox-entries'
/** The inbox counts read the tallies, never every conversation. Moved-in messages are history, never
 * unread; unread is per member, so it counts the member's open unread rows (inbox_unread). `snoozed`
 * counts open conversations with a pending snooze. `suspended` is the workspace's held mail, present only
 * for a member who may review it (suspended.ts requires conversations.manage) and never in the Global Inbox. */
export async function inboxCounts(env:Env,userId:string,project?:string){
 const reviewsHeldMail=project?(await memberAccess(env.DB,project,userId))?.permissions.has('conversations.manage'):false
 const tallies=clauses(inboxAccess('t',userId,{project,deleted:false})),unread=clauses([{sql:'u.user_id=?',params:[userId]},...inboxAccess('u',userId,{project,deleted:false}),{sql:'u.counts_open=1',params:[]}])
 return env.DB.prepare(`SELECT counted.mine,counted.open,counted.unassigned,counted.ai,counted.closed,
 (SELECT count(*) FROM inbox_unread u INDEXED BY inbox_unread_counts WHERE ${unread.sql}) unread,
 counted.snoozed
 ${reviewsHeldMail?',(SELECT count(*) FROM suspended_emails held WHERE held.project_id=? AND held.expires_at>?) suspended':''}
 FROM (SELECT
 COALESCE(SUM(iif(t.counts_open=1 AND t.assigned_to=? AND t.ai=0,t.total,0)),0) mine,
 COALESCE(SUM(iif(t.counts_open=1 AND t.ai=0,t.total,0)),0) open,
 COALESCE(SUM(iif(t.counts_open=1 AND COALESCE(t.assigned_to,'')='' AND t.ai=0,t.total,0)),0) unassigned,
 COALESCE(SUM(iif(t.ai_profile=1,t.total,0)),0) ai,
 COALESCE(SUM(iif(t.counts_open=0 AND t.ai=0,t.total,0)),0) closed,
 COALESCE(SUM(iif(t.counts_open=1 AND t.ai=0 AND t.snoozed=1,t.total,0)),0) snoozed
 FROM inbox_tallies t WHERE ${tallies.sql}) counted`).bind(...unread.params,...(reviewsHeldMail?[project,Date.now()]:[]),userId,...tallies.params).first()}
