import React, { useContext, useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useDashboardSettings } from '../../../native/dashboard-state';
import { useUnsavedChanges } from '../../../native/NavigationGuard';
import { nativeRequest } from '../../../native/transport';
import { useWorkflowResource } from '../../../native/pages/workflows/workflow-model';
import { ChatContext } from '../../contexts/ChatContext';
import { json, label, ticketPath } from '../tickets/ticket-model';
import SlaStatus from './SlaStatus';
import ScheduleForm from './ScheduleForm';
import { workflowTime } from './schedule-time';
import './workflows.css';

/** The ticket's schedules, SLA and routing decision, read once for the Ticket tab and read again after a ticket action. */
export function useConversationWorkflows(conversation, reads) {
    const path = `${ticketPath(conversation.project_id)}/conversations/${encodeURIComponent(conversation.id)}`;
    const schedules = useWorkflowResource(`${path}/workflows`), sla = useWorkflowResource(`${path}/sla`), routing = useWorkflowResource(`${path}/routing`);
    const first = useRef(true);
    const reload = () => Promise.all([schedules.reload(), sla.reload(), routing.reload()]);
    useEffect(() => {
        if (first.current) { first.current = false; return; }
        reload().catch(() => {});
    }, [reads]);
    return { schedules, sla, routing, reload, base: ticketPath(conversation.project_id) };
}

export const operatorsFor = (agentsFor, projectId) => (agentsFor(projectId) || []).filter(row => row.access_role !== 'collaborator');

/** Summary › Assignee › Why routed: the recorded routing decision and any routing retries. */
export function RoutingExplanation({ routing, agents }) {
    const decision = routing.data?.decision;
    return <div className="workflow-routing">
        {routing.error && <p className="text-danger" role="alert">{routing.error}</p>}
        {!routing.data && !routing.error && <p role="status">Loading routing decision…</p>}
        {routing.data && (decision ? <><p><strong>{decision.rule_name}</strong> · {label(decision.strategy)}</p><p>{decision.explanation}</p><p>{decision.winner_id ? `Operator: ${agents.find(row => row.id === decision.winner_id)?.name || decision.winner_id}` : 'No operator selected'}{decision.overflow ? ' · Overflow team' : ''}<br/>{workflowTime(decision.created_at)}</p></> : <p className="settings-note">No automatic routing decision has been recorded.</p>)}
        {routing.data?.events?.map(event => <article key={event.id}><strong>{label(event.state)} · {label(event.kind)}</strong><p>{event.error}</p><p className="settings-note">{event.attempts} attempt{event.attempts === 1 ? '' : 's'}{event.next_attempt_at ? ` · Next attempt ${workflowTime(event.next_attempt_at)}` : ''}</p></article>)}
    </div>;
}

/** Summary › Follow-ups: the ticket this one follows up, and the tickets that follow up this one. */
export function FollowupLinks({ conversation, schedules }) {
    const data = schedules.data?.data;
    if (!data?.followup_of && !data?.followups?.length) return null;
    return <ul className="workflow-followups">
        {data.followup_of && <li>Follow-up to <Link to={`/projects/${conversation.project_id}/conversations/${data.followup_of}`}>ticket {data.followup_of}</Link></li>}
        {data.followups.map(row => <li key={row.id}><Link to={`/projects/${conversation.project_id}/conversations/${row.id}`}>{row.subject || row.id}</Link> · {label(row.status_category)}</li>)}
    </ul>;
}

/**
 * Ticket › Schedules: snoozes and scheduled replies with Edit and Cancel, and the SLA in full. New ones start from
 * "+" › Snooze… and Schedule reply…. `onBadge` reports how many schedules the ticket has.
 */
export default function WorkflowPanel({ conversation, workflows, onBadge }) {
    const workspace = useDashboardSettings(), { agentsFor } = useContext(ChatContext), { markDirty, markSaved } = useUnsavedChanges();
    const { schedules, sla, base } = workflows;
    const [draft, setDraft] = useState(null), [dirty, setDirty] = useState(false);
    const canManage = schedules.data?.data.permissions?.manage === true, canReply = schedules.data?.data.permissions?.reply === true;
    const agents = operatorsFor(agentsFor, conversation.project_id);
    const items = schedules.data?.data.schedules || [];
    useEffect(() => { onBadge?.(items.length); }, [items.length, onBadge]);
    const edit = item => { if (dirty && !window.confirm('Discard unsaved schedule changes?')) return; setDraft(item); setDirty(false); markSaved(); };
    const cancel = async item => { if (!window.confirm(`Cancel this ${item.kind === 'reply' ? 'scheduled reply' : 'snooze'}?`)) return; await schedules.run(() => nativeRequest(`${base}/workflow-schedules/${encodeURIComponent(item.id)}`, json('PATCH', { action: 'cancel' }))); };
    const editable = item => item.state === 'pending' && (item.kind === 'reply' ? canReply : canManage) && (item.sender_id === workspace.currentAgent?.id || ['owner', 'admin'].includes(workspace.projects?.[conversation.project_id]?.role));
    return <div className="workflow-panel">
        <div className="workflow-panel-toolbar"><button type="button" className="btn btn-link btn-sm" disabled={schedules.busy || sla.busy || workflows.routing.busy} onClick={() => workflows.reload()}>Refresh workflows</button></div>
        {schedules.error && <p className="text-danger" role="alert">{schedules.error}</p>}
        {!schedules.data && !schedules.error && <p role="status">Loading schedules…</p>}
        {items.map(item => <article className="workflow-schedule" key={item.id}>
            <strong>{item.kind === 'reply' ? 'Scheduled reply' : 'Snooze'} · {label(item.state)}</strong>
            <p>Due: <time dateTime={item.due_at ? new Date(item.due_at).toISOString() : undefined}>{workflowTime(item.due_at, item.timezone)}</time> · {item.timezone}<br/>Owner: {agents.find(row => row.id === item.owner_id)?.name || item.owner_id}</p>
            {item.dependency_id && <p>Waiting for <Link to={`/projects/${conversation.project_id}/conversations/${item.dependency_id}`}>ticket {item.dependency_id}</Link></p>}
            {item.body && <p>{item.body}</p>}
            {item.reason && <p>{label(item.reason)}</p>}
            {item.state === 'uncertain' && <p role="alert">Delivery outcome is unknown. This reply will not be sent again automatically.</p>}
            {editable(item) && draft?.id !== item.id && <div className="workflow-panel-actions"><button type="button" disabled={schedules.busy} onClick={() => edit(item)}>Edit</button><button type="button" disabled={schedules.busy} onClick={() => cancel(item)}>Cancel schedule</button></div>}
            {draft?.id === item.id && <ScheduleForm key={draft.id} schedule={draft} {...{ conversation, agents }} currentAgentId={workspace.currentAgent?.id} changed={() => { setDirty(true); markDirty(); }} clean={() => { setDirty(false); markSaved(); }} onCancel={() => setDraft(null)} onSaved={async () => { setDraft(null); await schedules.reload(); }}/>}
        </article>)}
        {schedules.data && !items.length && <p className="settings-note">No schedules for this ticket. Snooze… and Schedule reply… are in the “+” menu.</p>}
        {schedules.data && !canManage && !canReply && <p className="settings-note">Your role can read schedules. Ticket management permission is required to change them.</p>}
        <h4 className="ticket-panel-subheading">SLA</h4>
        {sla.error && <p className="text-danger" role="alert">SLA: {sla.error}</p>}
        {!sla.data && !sla.error && <p role="status">Loading SLA…</p>}
        <SlaStatus data={sla.data?.data} canManage={canManage} busy={sla.busy} onAcknowledge={alert => sla.run(() => nativeRequest(`${base}/sla-alerts/${encodeURIComponent(alert.id)}/ack`, json('PATCH', {})))}/>
    </div>;
}
