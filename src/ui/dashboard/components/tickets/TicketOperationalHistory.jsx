import React from 'react';

const elapsed = ms => `${Number((ms / 60000).toFixed(2))} min`;
export function operationalHistory(key, change, changes) {
    if (key === 'handle_timer') return <li key={key}><strong>Handle timer:</strong> {change.ended_at == null ? 'Started' : `Stopped after ${elapsed(change.ended_at - change.started_at)}`}{change.reason === 'solved' ? ' when the ticket was solved' : ''}.</li>;
    if (key === 'handle_timer_adjustment') return <li key={key}><strong>Handle time corrected:</strong> {elapsed(change.from_ms)} → {elapsed(change.to_ms)}. {change.reason}</li>;
    if (key === 'is_problem') return <li key={key}>{change ? 'Marked as a problem.' : 'Removed problem designation.'}</li>;
    if (key === 'problem_id') return <li key={key}><strong>Problem {changes.action === 'unlink' ? 'unlinked' : 'linked'}:</strong> {String(change)}</li>;
    if (key === 'incident_id') return <li key={key}><strong>Incident {changes.action === 'unlink' ? 'unlinked' : 'linked'}:</strong> {String(change)}</li>;
    if (key === 'problem_reply') return <li key={key}>Reviewed problem update saved to this incident.</li>;
    if (key === 'problem_bulk') return <li key={key}>Solved through a reviewed problem update.</li>;
    if (key === 'problem_delivery') return <li key={key}><strong>Problem update:</strong> {change.to}{change.reason ? ` — ${change.reason}` : ''}</li>;
    if (key === 'action' && (changes.problem_id || changes.incident_id)) return null;
    return undefined;
}
