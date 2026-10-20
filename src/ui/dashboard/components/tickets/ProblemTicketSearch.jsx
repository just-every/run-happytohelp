import React, { useId, useState } from 'react';
import { nativeRequest } from '../../../native/transport';
import { ticketPath } from './ticket-model';

export default function ProblemTicketSearch({ projectId, label = 'Find a ticket', excludeIds = [], disabled, onSelect }) {
    const inputId = useId(), [query, setQuery] = useState(''), [rows, setRows] = useState([]);
    const [error, setError] = useState(''), [busy, setBusy] = useState(false), [searched, setSearched] = useState(false), [offset, setOffset] = useState(0), [hasMore, setHasMore] = useState(false);
    const search = async (event, page = 0) => {
        event?.preventDefault(); if (!query.trim()) return;
        setBusy(true); setError('');
        try {
            const result = await nativeRequest(`${ticketPath(projectId)}/ticket-problem-search?q=${encodeURIComponent(query.trim())}&offset=${page}`);
            setRows((result.data || []).filter(ticket => !excludeIds.includes(ticket.id))); setSearched(true); setOffset(page); setHasMore(result.has_more);
        } catch (failure) { setError(failure.message); } finally { setBusy(false); }
    };
    return <div className="problem-search">
        <form onSubmit={search}><label className="form-label" htmlFor={inputId}>{label}</label>
            <div className="problem-actions"><input id={inputId} className="form-control" value={query} maxLength={200} disabled={disabled || busy} onChange={event => { setQuery(event.target.value); setSearched(false); }} placeholder="Search subject, customer or ticket reference" /><button type="submit" className="btn btn-sm btn-white" disabled={disabled || busy || !query.trim()}>{busy ? 'Searching…' : 'Search'}</button></div>
        </form>
        {error && <p role="alert" className="text-danger">{error}</p>}
        {searched && !rows.length && <p role="status">No matching tickets.</p>}
        {!!rows.length && <ul className="problem-ticket-list">{rows.map(ticket => <li key={ticket.id}><button className="btn btn-sm btn-link" type="button" disabled={disabled || busy} onClick={() => { onSelect(ticket); setRows([]); setSearched(false); setHasMore(false); }}>{ticket.subject || ticket.id}</button><span>{ticket.requester_name || ticket.requester_email || ''}</span></li>)}</ul>}
        {searched && (offset > 0 || hasMore) && <div className="problem-actions"><button type="button" className="btn btn-sm btn-white" disabled={disabled || busy || offset === 0} onClick={() => search(null, Math.max(0, offset - 50))}>Previous matches</button><button type="button" className="btn btn-sm btn-white" disabled={disabled || busy || !hasMore} onClick={() => search(null, offset + 50)}>Next matches</button></div>}
    </div>;
}
