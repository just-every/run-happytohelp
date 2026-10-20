import React, { useEffect, useId, useState } from 'react';
import { nativeRequest } from '../../../native/transport';
import { json } from './ticket-model';

export default function ProblemSolve({ path, incidents, onChanged, disabled, recentPreviewId }) {
    const inputId = useId(), [reply, setReply] = useState(''), [solveIncidents, setSolveIncidents] = useState(true);
    const [preview, setPreview] = useState(null), [results, setResults] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    const [selected, setSelected] = useState(() => incidents.filter(item => !['closed', 'solved'].includes(item.status_category)).map(item => item.id));
    useEffect(() => {
        if (!recentPreviewId) return;
        let active = true;
        nativeRequest(`${path}/solve/${encodeURIComponent(recentPreviewId)}`).then(value => { if (active && value.data.state !== 'preview') setResults(current => current ?? value.data); }).catch(failure => { if (active) setError(failure.message); });
        return () => { active = false; };
    }, [path, recentPreviewId]);
    const prepare = async event => {
        event.preventDefault(); if (!selected.length || selected.length > 100) return; setBusy(true); setError(''); setResults(null); setPreview(null);
        try { setPreview((await nativeRequest(`${path}/solve/preview`, json('POST', { reply, solve_incidents: solveIncidents, ...(selected.length ? { incident_ids: selected } : {}) }))).data); }
        catch (failure) { setError(failure.message); } finally { setBusy(false); }
    };
    const execute = async () => {
        const reviewed = preview; setPreview(null); setBusy(true); setError('');
        try { const result = await nativeRequest(`${path}/solve/apply`, json('POST', { preview_id: reviewed.preview_id })); setResults(result.data); await onChanged(); }
        catch (failure) {
            setError(`${failure.message} This send will not be repeated automatically.`);
            try { setResults((await nativeRequest(`${path}/solve/${encodeURIComponent(reviewed.preview_id)}`)).data); } catch { /* Keep the original execution error visible. */ }
        } finally { setBusy(false); }
    };
    const toggle = id => { setSelected(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]); setPreview(null); setResults(null); };
    return <details className="problem-solve"><summary>Solve problem and update incidents</summary>
        <form onSubmit={prepare}><fieldset disabled={disabled || busy}>
            <label className="form-label" htmlFor={inputId}>Public reply for each requester</label>
            <textarea id={inputId} className="form-control" rows={4} maxLength={100000} value={reply} required onChange={event => { setReply(event.target.value); setPreview(null); setResults(null); }} />
            <p className="form-text">Use {'{{requester.first_name | there}}'} or other macro placeholders. Review each customer’s rendered reply before sending.</p>
            <label className="problem-check"><input type="checkbox" checked={solveIncidents} onChange={event => { setSolveIncidents(event.target.checked); setPreview(null); }} /> Solve each incident after its reply succeeds</label>
            <div className="problem-selection" role="group" aria-label="Incidents to update">{incidents.map(item => <label className="problem-check" key={item.id}><input type="checkbox" checked={selected.includes(item.id)} disabled={['solved', 'closed'].includes(item.status_category)} onChange={() => toggle(item.id)} />{item.subject || item.id} ({item.channel})</label>)}</div>
            <button className="btn btn-sm btn-white" type="submit" disabled={!reply.trim() || !selected.length || selected.length > 100}>Preview replies and resolution</button>
        </fieldset></form>
        {error && <p role="alert" className="text-danger">{error}</p>}
        {preview && <div aria-label="Problem resolution preview"><p role="status">Preview: the problem will be solved. {selected.length} incidents selected.</p><ul className="problem-ticket-list">{preview.results.map(item => <li key={item.id}><strong>{item.requester_name || item.subject || item.id}</strong> · {item.channel || 'Unavailable channel'} · {item.status}{item.recipient && <div>To: {item.recipient}</div>}{item.reply && <blockquote className="problem-reply">{item.reply}</blockquote>}{item.reason && <p>{item.reason}</p>}</li>)}</ul><p>Only confirmed replies can solve incidents. Blocked, failed and uncertain deliveries leave incidents open.</p><button type="button" className="btn btn-sm btn-primary" disabled={busy || disabled} onClick={execute}>Confirm replies and solve problem</button></div>}
        {results && <div aria-label="Problem resolution results" role="status">{results.problem && <p>Problem: {results.problem.status}{results.problem.reason ? ` — ${results.problem.reason}` : ''}</p>}<ul className="problem-ticket-list">{results.results.map(item => <li key={item.id}>{incidents.find(ticket => ticket.id === item.id)?.subject || item.id}: <strong>{item.status}</strong>{item.reason ? ` — ${item.reason}` : ''}</li>)}</ul></div>}
    </details>;
}
