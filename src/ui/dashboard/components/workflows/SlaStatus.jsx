import React from 'react';
import { label } from '../tickets/ticket-model';
import { workflowTime } from './schedule-time';
/** The SLA's next due time for the Summary: the earliest open clock, a pause, or null when no policy applies. */
export function nextSlaDue(data) {
    if (!data?.policy) return null;
    if (data.pause_reason) return { text: `Paused · ${label(data.pause_reason)}` };
    const clock = (data.clocks || []).filter(row => !row.completed_at && row.due_at).sort((a, b) => a.due_at - b.due_at)[0];
    if (!clock) return { text: 'Every target met' };
    return { text: `${label(clock.metric)} ${clock.breached ? 'overdue' : 'due'} ${workflowTime(clock.due_at, data.calendar?.timezone)}`, breached: Boolean(clock.breached), dueAt: clock.due_at };
}

/** Ticket › Schedules › SLA: the policy, its calendar, every clock and the alert history. */
export default function SlaStatus({ data, canManage, busy, onAcknowledge }) {
    if(!data)return null;
    return <>{data.policy?<><p><strong>{data.policy.name}</strong>{data.calendar&&<><br/>{data.calendar.name} · {data.calendar.timezone}</>}</p>{data.pause_reason&&<p role="status">SLA paused: {label(data.pause_reason)}.</p>}<ul className="workflow-clock-list">{data.clocks.map(clock=><li key={`${clock.metric}-${clock.cycle}`}><strong>{label(clock.metric)}</strong><br/>{clock.completed_at?`Completed ${workflowTime(clock.completed_at,data.calendar?.timezone)}`:data.pause_reason?`${Math.ceil(clock.remaining_minutes)} business minutes remaining`:<>Due <time dateTime={clock.due_at?new Date(clock.due_at).toISOString():undefined}>{workflowTime(clock.due_at,data.calendar?.timezone)}</time></>}{clock.breached&&<span className="text-danger"> · Breached</span>}</li>)}</ul></>:<p className="settings-note">No SLA policy matches this ticket.</p>}{data.alerts?.length>0&&<details open={data.alerts.some(row=>row.state==='open')}><summary>SLA alerts ({data.alerts.length})</summary><ul className="workflow-alert-list">{data.alerts.map(alert=><li key={alert.id}><strong>{label(alert.kind)} · {label(alert.metric)}</strong><br/>{label(alert.state)} · {workflowTime(alert.created_at)}{alert.acknowledged_at&&<><br/>Acknowledged {workflowTime(alert.acknowledged_at)}</>}{['slack','teams'].map(channel=>(alert[`${channel}_destination_id`] || alert[`${channel}_connection_id`])&&<p key={channel}>{channel === 'slack' ? 'Slack' : 'Teams'}: {label(alert[`${channel}_state`])}{alert[`${channel}_attempts`] > 0 && ` · ${alert[`${channel}_attempts`]} attempt${alert[`${channel}_attempts`] === 1 ? '' : 's'}`}{alert[`${channel}_next_attempt_at`]&&<> · Next attempt {workflowTime(alert[`${channel}_next_attempt_at`])}</>}{alert[`${channel}_error`]&&<> · {alert[`${channel}_error`]}</>}</p>)}{alert.notification_error&&<p role="alert">Notification: {alert.notification_error}</p>}{alert.state==='open'&&canManage&&<button type="button" disabled={busy} onClick={()=>onAcknowledge(alert)}>Acknowledge alert</button>}</li>)}</ul></details>}</>;
}
