import React, { useEffect, useState } from 'react';
import { nativeRequest } from '../../../native/transport';
import { json, ticketPath } from './ticket-model';
import ProblemTicketSearch from './ProblemTicketSearch';
import './problem.css';

const problemPath = (projectId, id) => `${ticketPath(projectId)}/conversations/${encodeURIComponent(id)}/ticket/problem`;
export default function ProblemBulkLink({ projectId, selectedIds = [], onApplied = () => {} }) {
    const selectionKey = JSON.stringify(selectedIds), [problem, setProblem] = useState(null), [preview, setPreview] = useState(null);
    const [error, setError] = useState(''), [busy, setBusy] = useState(false), [applied, setApplied] = useState(false);
    useEffect(() => { setPreview(null); setApplied(false); }, [selectionKey, projectId]);
    useEffect(() => { setProblem(null); }, [projectId]);
    const selectProblem = async ticket => {
        setBusy(true); setError(''); setPreview(null); setApplied(false);
        try {
            const result = await nativeRequest(problemPath(projectId, ticket.id));
            if (!result.data.is_problem) throw new Error('Mark that ticket as a problem before linking incidents.');
            setProblem({ id: ticket.id, subject: ticket.subject || ticket.id });
        } catch (failure) { setProblem(null); setError(failure.message); } finally { setBusy(false); }
    };
    const run = async apply => {
        setBusy(true); setError('');
        try {
            const tickets = apply ? preview.results.filter(row => row.status === 'ready').map(({ id, expected_version, expected_revision, expected_last_message_id }) => ({ id, expected_version, expected_revision, expected_last_message_id })) : await Promise.all(selectedIds.map(async selected => {
                const id = typeof selected === 'string' ? selected : selected.id;
                const result = await nativeRequest(problemPath(projectId, id)); return result.data.ticket;
            }));
            const result = await nativeRequest(`${problemPath(projectId, problem.id)}/incidents/${apply ? 'apply' : 'preview'}`, json('POST', { action: 'link', tickets }));
            setPreview(result.data); setApplied(apply); if (apply) onApplied();
        } catch (failure) { setError(failure.message); } finally { setBusy(false); }
    };
    return <details className="problem-panel"><summary>Link {selectedIds.length} selected tickets to a problem</summary>
        {error && <p role="alert" className="text-danger">{error}</p>}
        <ProblemTicketSearch projectId={projectId} label="Find the problem ticket" excludeIds={selectedIds.map(item => typeof item === 'string' ? item : item.id)} disabled={busy} onSelect={selectProblem} />
        {problem && <><p>Problem: <strong>{problem.subject}</strong></p><button className="btn btn-sm btn-white" type="button" disabled={busy || !selectedIds.length || selectedIds.length > 100} onClick={() => run(false)}>Preview incident links</button></>}
        {selectedIds.length > 100 && <p role="status">Select up to 100 incidents per batch.</p>}
        {preview && <><ul className="problem-ticket-list" aria-label={applied ? 'Incident link results' : 'Incident link preview'}>{preview.results.map(result => <li key={result.id}>{result.id}: {result.status}{result.reason ? ` — ${result.reason}` : ''}</li>)}</ul>{!applied && <button className="btn btn-sm btn-primary" type="button" disabled={busy || !preview.results.some(row => row.status === 'ready')} onClick={() => run(true)}>Link eligible incidents</button>}</>}
    </details>;
}
