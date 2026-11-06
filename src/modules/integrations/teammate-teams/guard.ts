import {ticketScopeSql} from '../../access/ticket-scope'
import {notificationTicketSql} from '../triggers/eligibility'
import {noticeSourceSql} from '../teammate-slack/guard'
import {installationSql} from './authority'
export {noticeSourceSql}
const relation=`CASE n.kind WHEN 'assignment' THEN c.assigned_to=n.user_id WHEN 'customer_updated' THEN c.assigned_to=n.user_id
 WHEN 'group' THEN (c.assigned_to IS NULL AND EXISTS(SELECT 1 FROM ticket_group_members gm WHERE gm.project_id=c.project_id AND gm.group_id=c.group_id AND gm.user_id=n.user_id))
 WHEN 'follower' THEN EXISTS(SELECT 1 FROM conversation_followers f WHERE f.conversation_id=c.id AND f.user_id=n.user_id)
 WHEN 'mention' THEN 1 ELSE 0 END`
/** Identical predicates run in the claim and immediately before the send. */
export const noticeGuardSql=`${noticeSourceSql('n')} AND ${installationSql()}
 AND EXISTS(SELECT 1 FROM memberships m WHERE m.project_id=n.project_id AND m.user_id=n.user_id)
 AND EXISTS(SELECT 1 FROM conversations c WHERE c.id=n.conversation_id AND c.project_id=n.project_id AND ${ticketScopeSql('n.user_id')} AND (${relation}))
 AND EXISTS(SELECT 1 FROM teammate_teams_links l JOIN teammate_teams_preferences p ON p.project_id=l.project_id AND p.user_id=l.user_id AND p.kind=n.kind AND p.enabled=1
 JOIN support_channel_connections x ON x.id=l.connection_id AND x.project_id=l.project_id AND x.account=l.tenant_id AND x.sender=l.app_id
 WHERE l.project_id=n.project_id AND l.user_id=n.user_id AND l.connection_id=k.connection_id AND n.created_at>l.verified_at AND n.created_at>p.enabled_at AND n.created_at>=k.enabled_at)
 AND EXISTS(SELECT 1 FROM (${notificationTicketSql}) eligible)`
