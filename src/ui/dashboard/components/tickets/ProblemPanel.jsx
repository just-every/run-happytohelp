import React, { useContext, useEffect, useState } from 'react';
import { nativeRequest } from '../../../native/transport';
import { ChatContext } from '../../contexts/ChatContext';
import { json, ticketPath } from './ticket-model';
import ProblemTicketSearch from './ProblemTicketSearch';
import ProblemSolve from './ProblemSolve';
import './problem.css';

/**
 * Ticket › Problem and incidents: mark the ticket as a problem, link and unlink incidents, and solve them together.
 * "+" › Mark as problem… opens this section with its Mark button focused. `onBadge` reports the incident count.
 */
export default function ProblemPanel({ projectId, conversationId, ticket, onChanged = () => {}, onBadge }) {
    const { setActiveConversationId } = useContext(ChatContext), [data, setData] = useState(null), [error, setError] = useState('');
    const [incidentOffset, setIncidentOffset] = useState(0);
    const [busy, setBusy] = useState(false), [linkPreview, setLinkPreview] = useState(null), [linkResult, setLinkResult] = useState(null);
    const path = `${ticketPath(projectId)}/conversations/${encodeURIComponent(conversationId)}/ticket/problem`;
    const readPath = `${path}?incident_offset=${incidentOffset}`;
    const reload = async () => { const result = await nativeRequest(readPath); setData(result.data); await onChanged(); };
    useEffect(() => { setData(null); setError(''); setLinkPreview(null); setLinkResult(null); setIncidentOffset(0); }, [path]);
    useEffect(() => { let active = true; nativeRequest(readPath).then(result => { if (active) setData(result.data); }).catch(failure => { if (active) setError(failure.message); }); return () => { active = false; }; }, [readPath, ticket?.ticket_version]);
    const changeMark = async () => {
        setBusy(true); setError('');
        try { setData((await nativeRequest(path, json('PATCH', { ...data.ticket, is_problem: !data.is_problem }))).data); await onChanged(); }
        catch (failure) { setError(failure.message); } finally { setBusy(false); }
    };
    const prepareLink = async (incident, action = 'link') => {
        setBusy(true); setError(''); setLinkPreview(null); setLinkResult(null);
        try {
            const selected = (await nativeRequest(`${ticketPath(projectId)}/conversations/${encodeURIComponent(incident.id)}/ticket/problem`)).data.ticket;
            const response = await nativeRequest(`${path}/incidents/preview`, json('POST', { action, tickets: [selected] })); setLinkPreview({ action, ...response.data });
        } catch (failure) { setError(failure.message); } finally { setBusy(false); }
    };
    const applyLink = async () => {
        setBusy(true); setError('');
        try {
            const response = await nativeRequest(`${path}/incidents/apply`, json('POST', { action: linkPreview.action, tickets: linkPreview.results.filter(row => row.status === 'ready').map(({ id, expected_version, expected_revision, expected_last_message_id }) => ({ id, expected_version, expected_revision, expected_last_message_id })) }));
            setLinkResult(response.data); setLinkPreview(null); await reload();
        } catch (failure) { setError(failure.message); } finally { setBusy(false); }
    };
    const open = id => setActiveConversationId(id);
    const disabled = busy || data?.status_category === 'closed';
    useEffect(() => { onBadge?.(data?.is_problem ? data.incident_count || 'Problem' : data?.parent ? 'Incident' : null); }, [data?.is_problem, data?.incident_count, data?.parent, onBadge]);
    return <div className="problem-panel">
        {error && <p role="alert" className="text-danger">{error}</p>}
        {!data && !error && <p role="status">Loading problem links…</p>}
        {data && <>
            {data.parent && <p>Incident of <button className="btn btn-sm btn-link" type="button" onClick={() => open(data.parent.problem_id)}>{data.parent.subject || data.parent.problem_id}</button></p>}
            {!data.parent && <button className="btn btn-sm btn-white" type="button" data-section-focus disabled={disabled || data.is_problem && data.incident_count > 0} onClick={changeMark}>{data.is_problem ? 'Remove problem designation' : 'Mark as problem'}</button>}
            {data.is_problem && <>
                <p>{data.incident_count} linked incident{data.incident_count === 1 ? '' : 's'}. Each keeps its own history, service targets and satisfaction feedback.</p>
                <ul className="problem-ticket-list">{data.incidents.map(incident => <li key={incident.id}><button type="button" className="btn btn-sm btn-link" onClick={() => open(incident.id)}>{incident.subject || incident.id}</button><div>{incident.requester_name || incident.requester_email || 'Requester'} · {incident.channel} · {incident.status_category}</div><button className="btn btn-sm btn-white" type="button" disabled={disabled} onClick={() => prepareLink(incident, 'unlink')}>Preview unlink</button></li>)}</ul>
                {(incidentOffset > 0 || data.has_more) && <div className="problem-actions"><button className="btn btn-sm btn-white" type="button" disabled={busy || incidentOffset === 0} onClick={() => setIncidentOffset(Math.max(0, incidentOffset - 100))}>Previous incidents</button><button className="btn btn-sm btn-white" type="button" disabled={busy || !data.has_more} onClick={() => setIncidentOffset(incidentOffset + 100)}>Next incidents</button></div>}
                <ProblemTicketSearch projectId={projectId} label="Find an incident to link" disabled={disabled} excludeIds={[conversationId, ...data.incidents.map(item => item.id)]} onSelect={prepareLink} />
                {linkPreview && <div><ul className="problem-ticket-list">{linkPreview.results.map(result => <li key={result.id}>{result.id}: {result.status}{result.reason ? ` — ${result.reason}` : ''}</li>)}</ul><button type="button" className="btn btn-sm btn-primary" disabled={disabled || !linkPreview.results.some(result => result.status === 'ready')} onClick={applyLink}>Confirm {linkPreview.action}</button></div>}
                {linkResult && <ul className="problem-ticket-list" role="status">{linkResult.results.map(result => <li key={result.id}>{result.id}: {result.status}{result.reason ? ` — ${result.reason}` : ''}</li>)}</ul>}
                {!!data.incidents.length && <ProblemSolve key={`${path}:${data.problem_version}:${data.incident_offset}`} path={path} recentPreviewId={data.recent_preview_id} incidents={data.incidents} disabled={disabled} onChanged={reload} />}
            </>}
        </>}
    </div>;
}
