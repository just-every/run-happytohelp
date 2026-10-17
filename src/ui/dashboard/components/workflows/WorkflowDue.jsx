import React from 'react';
import { label } from '../tickets/ticket-model';
import { workflowTime } from './schedule-time';
import './workflows.css';
export default function WorkflowDue({ sla, snooze }) {
    if(!sla&&!snooze)return null;
    return <div className="workflow-inbox-due">{sla?.pause_reason?<span>SLA paused · {label(sla.pause_reason)}</span>:sla?.due_at?<span className={sla.breached?'text-danger':undefined}>{label(sla.metric)} {sla.breached?'overdue':'due'} <time dateTime={new Date(sla.due_at).toISOString()}>{workflowTime(sla.due_at)}</time></span>:null}{snooze&&<span>{sla?.due_at||sla?.pause_reason?' · ':''}Snoozed{snooze.due_at?<> until <time dateTime={new Date(snooze.due_at).toISOString()}>{workflowTime(snooze.due_at)}</time></>:null}{snooze.dependency_id?` · waiting for ticket ${snooze.dependency_id}`:''}</span>}</div>;
}
