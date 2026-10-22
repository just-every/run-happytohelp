import React from 'react';
import moment from 'moment';
import { label } from '../tickets/ticket-model';
import { workflowTime } from './schedule-time';
// A list row's due time or snooze, its times in the row's own short form (the time today, else the day and time); the
// tooltip says it in full.
const short = at => moment(at).format(moment(at).isSame(moment(), 'day') ? 'LT' : 'D MMM, LT');
const Due = ({ at }) => <time dateTime={new Date(at).toISOString()}>{short(at)}</time>;
export default function WorkflowDue({ sla, snooze }) {
    if(!sla&&!snooze)return null;
    const slaText=sla?.pause_reason?`SLA paused · ${label(sla.pause_reason)}`:sla?.due_at?`${label(sla.metric)} ${sla.breached?'overdue':'due'} ${workflowTime(sla.due_at)}`:'';
    const snoozeText=snooze?`Snoozed${snooze.due_at?` until ${workflowTime(snooze.due_at)}`:''}${snooze.dependency_id?` · waiting for ticket ${snooze.dependency_id}`:''}`:'';
    return <div className="workflow-inbox-due" title={[slaText,snoozeText].filter(Boolean).join(' · ')}>{sla?.pause_reason?<span>SLA paused · {label(sla.pause_reason)}</span>:sla?.due_at?<span className={sla.breached?'text-danger':undefined}>{label(sla.metric)} {sla.breached?'overdue':'due'} <Due at={sla.due_at}/></span>:null}{snooze&&<span>{sla?.due_at||sla?.pause_reason?' · ':''}Snoozed{snooze.due_at?<> until <Due at={snooze.due_at}/></>:null}{snooze.dependency_id?` · waiting for ticket ${snooze.dependency_id}`:''}</span>}</div>;
}
