import {teammateKinds} from './notification-kinds'

const kindList=teammateKinds.map(kind=>`'${kind}'`).join(',')
/** Only committed teammate notices. Action rows (`ticket-notice:…`), escalation and
 * follow-up rows, SLA alerts and acknowledgments never match; an unknown id form fails closed. */
export const noticeSourceSql=(n='n')=>`((substr(${n}.id,1,12)='team-notice:' OR substr(${n}.id,1,11)='assignment:') AND ${n}.kind IN (${kindList}) AND ${n}.state<>'action')`

export const noticeInterruptionMs=600000
export function freshTeammateNotices(provider:'slack'|'teams'){
 const destination=provider==='slack'?'destination_id':'connection_id'
 return `FROM teammate_${provider}_consent k
  JOIN teammate_${provider}_links l ON l.project_id=k.project_id AND l.${destination}=k.${destination}${provider==='slack'?" AND l.state='verified'":''}
  JOIN teammate_${provider}_preferences p ON p.project_id=l.project_id AND p.user_id=l.user_id AND p.enabled=1
  JOIN notification_inbox n ON n.project_id=l.project_id AND n.user_id=l.user_id AND n.kind=p.kind AND n.created_at>l.verified_at AND n.created_at>p.enabled_at AND n.created_at>=k.enabled_at
  WHERE ${noticeSourceSql()} AND NOT EXISTS(SELECT 1 FROM teammate_${provider}_deliveries d WHERE d.notice_id=n.id)`
}
export function teammateNoticeDueSql(provider:'slack'|'teams',now:string){
 return `SELECT 1 ${freshTeammateNotices(provider)}
  UNION ALL SELECT 1 FROM teammate_${provider}_deliveries WHERE state IN ('sending','pending')
   AND (state='sending' AND started_at<${now}-${noticeInterruptionMs} OR state='pending' AND next_attempt_at<=${now})`
}
