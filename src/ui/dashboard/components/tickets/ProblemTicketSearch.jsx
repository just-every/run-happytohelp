import React, { useId, useState } from 'react';
import { nativeRequest } from '../../../native/transport';
import { ticketPath } from './ticket-model';

export default function ProblemTicketSearch({ projectId, problemId, label = 'Find a ticket', excludeIds = [], disabled, onSelect }) {
    const inputId = useId(), [query, setQuery] = useState(''), [rows, setRows] = useState([]);
    const [error, setError] = useState(''), [busy, setBusy] = useState(false), [searched, setSearched] = useState(false), [offset, setOffset] = useState(0), [hasMore, setHasMore] = useState(false);
    const [mode, setMode] = useState('search'), [note, setNote] = useState('');
    const search = async (event, page = 0, kind = mode) => {
        event?.preventDefault(); if (kind === 'search' && !query.trim()) return;
        setBusy(true); setError('');
        try {
            const params = new URLSearchParams(kind === 'triage' ? { suggest_for: problemId, offset: String(page) } : { q: query.trim(), offset: String(page) });
            const result = await nativeRequest(`${ticketPath(projectId)}/ticket-problem-search?${params}`);
            setMode(kind); setNote(result.message || '');
            setRows((result.data || []).filter(ticket => !excludeIds.includes(ticket.id))); setSearched(true); setOffset(page); setHasMore(result.has_more);
        } catch (failure) { setError(failure.message); } finally { setBusy(false); }
    };
    return <div className="problem-search">
        <form onSubmit={event => search(event, 0, 'search')}><label className="form-label" htmlFor={inputId}>{label}</label>
            <div className="problem-actions"><input id={inputId} className="form-control" value={query} maxLength={200} disabled={disabled || busy} onChange={event => { setQuery(event.target.value); setSearched(false); setRows([]); setNote(''); setHasMore(false); setMode('search'); }} placeholder="Search subject, customer or ticket reference" /><button type="submit" className="btn btn-sm btn-white" disabled={disabled || busy || !query.trim()}>{busy ? 'Searching…' : 'Search'}</button></div>
        </form>
        {problemId && <button type="button" className="btn btn-sm btn-white" disabled={disabled || busy} onClick={() => search(null, 0, 'triage')}>Show triage suggestions</button>}
        {note && <p role="status">{note}</p>}
        {error && <p role="alert" className="text-danger">{error}</p>}
        {searched && !rows.length && <p role="status">No matching tickets.</p>}
        {!!rows.length && <ul className="problem-ticket-list">{rows.map(ticket => <li key={ticket.id}><button className="btn btn-sm btn-link" type="button" disabled={disabled || busy} onClick={() => { onSelect(ticket); setRows([]); setSearched(false); setHasMore(false); }}>{ticket.subject || ticket.id}</button><span>{ticket.requester_name || ticket.requester_email || ''}</span></li>)}</ul>}
        {searched && (offset > 0 || hasMore) && <div className="problem-actions"><button type="button" className="btn btn-sm btn-white" disabled={disabled || busy || offset === 0} onClick={() => search(null, Math.max(0, offset - 50))}>Previous matches</button><button type="button" className="btn btn-sm btn-white" disabled={disabled || busy || !hasMore} onClick={() => search(null, offset + 50)}>Next matches</button></div>}
    </div>;
}
