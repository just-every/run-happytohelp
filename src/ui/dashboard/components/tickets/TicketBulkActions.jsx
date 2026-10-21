import React, { useContext, useEffect, useState } from 'react';
import { ChatContext } from '../../contexts/ChatContext';
import { nativeRequest } from '../../../native/transport';
import ProblemBulkLink from './ProblemBulkLink';
import BulkMacros from '../macros/BulkMacros';
import { json, label, priorities, ticketPath } from './ticket-model';
import './tickets.css';

function BulkChanges({ projectId, selected, onClear, onApplied }) {
    const { agentsFor } = useContext(ChatContext);
    const [settings, setSettings] = useState(null), [tags, setTags] = useState([]), [changes, setChanges] = useState({});
    const [preview, setPreview] = useState(null), [applied, setApplied] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    const base = ticketPath(projectId), selectionKey = JSON.stringify(selected);
    useEffect(() => { let active = true; Promise.all([nativeRequest(`${base}/ticket-settings`), nativeRequest(`${base}/tags`)]).then(([definitions, availableTags]) => { if (active) { setSettings(definitions.data); setTags(availableTags.data); } }).catch(failure => { if (active) setError(failure.message); }); return () => { active = false; }; }, [base]);
    useEffect(() => { setPreview(null); setApplied(false); }, [selectionKey]);
    const change = (key, value) => { setChanges(current => { const next = { ...current }; if (value === undefined) delete next[key]; else next[key] = value; return next; }); setPreview(null); setApplied(false); };
    const run = async apply => {
        setBusy(true); setError('');
        try {
            const result = await nativeRequest(`${base}/tickets/bulk/${apply ? 'apply' : 'preview'}`, json('POST', { tickets: selected.map(item => ({ id: item.id, expected_version: item.ticket_version })), changes }));
            setPreview(result.data); setApplied(apply); if (apply) onApplied();
        } catch (failure) { setError(failure.message); } finally { setBusy(false); }
    };
    const select = (key, title, options) => <div className="w-100" key={key}><label className="form-label" htmlFor={`ticket-bulk-${key}`}>{title}</label><select id={`ticket-bulk-${key}`} className="form-select" value={changes[key] === null ? '__none' : changes[key] || ''} onChange={event => change(key, event.target.value === '__none' ? null : event.target.value || undefined)}><option value="">No change</option>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>;
    const describe = (key, value) => {
        if (key === 'status_id') return settings.statuses.find(status => status.id === value)?.name || value;
        if (key === 'agent_id' || key === 'assigned_to') return value ? agentsFor(projectId).find(agent => agent.id === value)?.name || value : 'Unassigned';
        if (Array.isArray(value)) return value.map(id => tags.find(tag => tag.id === id)?.name || id).join(', ');
        return label(value);
    };
    return <div className="ticket-queue-tools" role="region" aria-label="Bulk ticket changes">
        <details open><summary>Bulk changes</summary>
            {error && <p role="alert" className="text-danger">{error}</p>}
            {settings && <>
                {select('assigned_to', 'Assign to', [{ value: '__none', label: 'Unassigned' }, ...(agentsFor(projectId) || []).filter(agent => agent.access_role !== 'collaborator').map(agent => ({ value: agent.id, label: agent.name }))])}
                {select('priority', 'Priority', priorities.map(value => ({ value, label: label(value) })))}
                {select('status_id', 'Status', settings.statuses.filter(status => status.active).map(status => ({ value: status.id, label: status.name })))}
                {['add_tags', 'remove_tags'].map(key => <div className="w-100" key={key}><label className="form-label" htmlFor={`ticket-bulk-${key}`}>{label(key)}</label><select id={`ticket-bulk-${key}`} className="form-select" multiple value={changes[key] || []} onChange={event => change(key, [...event.target.selectedOptions].map(option => option.value))}>{tags.map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select></div>)}
                <div className="ticket-queue-actions"><button className="btn btn-sm btn-white" type="button" disabled={busy || !Object.keys(changes).length} onClick={() => run(false)}>{busy ? 'Working…' : 'Preview changes'}</button><button className="btn btn-sm btn-link" type="button" disabled={busy} onClick={onClear}>Clear selection</button></div>
                {preview && <><p className="mt-2" role="status">{applied ? 'Bulk update results' : 'Preview — no changes applied'}</p><ul className="ticket-result-list">{preview.results.map(result => <li key={result.id}><strong>{selected.find(ticket => ticket.id === result.id)?.subject || result.id}</strong>: {label(result.status)}{result.changes && <div>{Object.entries(result.changes).filter(([key,value]) => !key.startsWith('expected_') && (!Array.isArray(value) || value.length)).map(([key, value]) => <div key={key}>{label(key === 'agent_id' ? 'Assignee' : key === 'status_id' ? 'Status' : key)}: {describe(key,value)}</div>)}</div>}{result.reason || result.error ? ` — ${result.reason || (typeof result.error === 'string' ? result.error : result.error.message)}` : ''}</li>)}</ul>{!applied && <button className="btn btn-sm btn-primary" type="button" disabled={busy || !preview.results.some(result => result.status === 'ready')} onClick={() => run(true)}>Apply to eligible tickets</button>}</>}
            </>}
        </details>
    </div>;
}

/** The bulk bar, shown only while selecting: how many are selected, "Select loaded tickets" and Done, then the bulk
 *  changes, problem link and macros for the selection. `selected` maps ticket ids to {id, subject, ticket_version}. */
export default function TicketBulkActions({ projectId, loaded, selected, onSelect, onDone, onApplied }) {
    const tickets = Object.values(selected);
    const selectLoaded = () => onSelect(Object.fromEntries(loaded.slice(0, 100).map(item => [item.id, { id: item.id, subject: item.subject, ticket_version: item.ticket_version }])));
    return <div className="ticket-bulk-bar">
        <div className="ticket-bulk-bar-head">
            <span className="ticket-bulk-count" role="status">{tickets.length} selected</span>
            <button type="button" className="btn btn-sm btn-white" onClick={selectLoaded}>Select loaded tickets</button>
            <button type="button" className="btn btn-sm btn-link" onClick={onDone}>Done</button>
        </div>
        {tickets.length > 0 && <>
            <BulkChanges projectId={projectId} selected={tickets} onClear={() => onSelect({})} onApplied={onApplied}/>
            <ProblemBulkLink projectId={projectId} selectedIds={tickets.map(ticket => ticket.id)} onApplied={onApplied}/>
            <BulkMacros projectId={projectId} selectedTickets={tickets.map(ticket => ({ id: ticket.id, expected_version: ticket.ticket_version }))} onApplied={onApplied}/>
        </>}
    </div>;
}
