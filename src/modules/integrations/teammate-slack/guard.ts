import {ticketScopeSql} from '../../access/ticket-scope'
import {notificationTicketSql} from '../triggers/eligibility'
import {teammateKinds} from '../notification-kinds'

const kindList=teammateKinds.map(kind=>`'${kind}'`).join(',')
/** Only committed teammate notices. Action rows (`ticket-notice:…`), escalation and
 * follow-up rows, SLA alerts and acknowledgments never match; an unknown id form fails closed. */
export const noticeSourceSql=(n='n')=>`((substr(${n}.id,1,12)='team-notice:' OR substr(${n}.id,1,11)='assignment:') AND ${n}.kind IN (${kindList}) AND ${n}.state<>'action')`
const relation=`CASE n.kind WHEN 'assignment' THEN c.assigned_to=n.user_id WHEN 'customer_updated' THEN c.assigned_to=n.user_id
 WHEN 'group' THEN (c.assigned_to IS NULL AND EXISTS(SELECT 1 FROM ticket_group_members gm WHERE gm.project_id=c.project_id AND gm.group_id=c.group_id AND gm.user_id=n.user_id))
 WHEN 'follower' THEN EXISTS(SELECT 1 FROM conversation_followers f WHERE f.conversation_id=c.id AND f.user_id=n.user_id)
 WHEN 'mention' THEN 1 ELSE 0 END`
/** The whole current-authority recheck, evaluated inside one statement. The caller
 * supplies `n` (notification_inbox) and `k` (teammate_slack_consent) and binds
 * (conversation_id, project_id) last. Membership, ticket scope, the kind's relation,
 * ticket eligibility, the Slack preference, the verified link, consent, an enabled
 * bot destination and an owner or admin installer must all hold now, and the notice
 * must have been committed after the link, the preference and the consent. */
export const noticeGuardSql=`${noticeSourceSql('n')}
 AND EXISTS(SELECT 1 FROM memberships m WHERE m.project_id=n.project_id AND m.user_id=n.user_id)
 AND EXISTS(SELECT 1 FROM conversations c WHERE c.id=n.conversation_id AND c.project_id=n.project_id AND ${ticketScopeSql('n.user_id')} AND (${relation}))
 AND EXISTS(SELECT 1 FROM native_integration_destinations d WHERE d.project_id=k.project_id AND d.id=k.destination_id AND d.kind='slack' AND d.mode='bot' AND d.enabled=1
  AND EXISTS(SELECT 1 FROM native_integration_audit a JOIN memberships im ON im.project_id=a.project_id AND im.user_id=a.actor_id AND im.role IN ('owner','admin') WHERE a.project_id=d.project_id AND a.resource_id=d.id AND a.action='destination.created'))
 AND EXISTS(SELECT 1 FROM memberships km WHERE km.project_id=k.project_id AND km.user_id=k.user_id AND km.role IN ('owner','admin'))
 AND EXISTS(SELECT 1 FROM teammate_slack_links l JOIN teammate_slack_preferences p ON p.project_id=l.project_id AND p.user_id=l.user_id AND p.kind=n.kind AND p.enabled=1
  WHERE l.project_id=n.project_id AND l.user_id=n.user_id AND l.state='verified' AND l.destination_id=k.destination_id AND n.created_at>l.verified_at AND n.created_at>p.enabled_at AND n.created_at>=k.enabled_at)
 AND EXISTS(SELECT 1 FROM (${notificationTicketSql}) eligible)`
