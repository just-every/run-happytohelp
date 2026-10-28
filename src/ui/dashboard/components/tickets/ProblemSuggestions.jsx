import React, { useState } from 'react';
import { nativeRequest } from '../../../native/transport';
import { json } from './ticket-model';

export default function ProblemSuggestions({ path, disabled, onChanged }) {
    const [suggestions, setSuggestions] = useState(null), [preview, setPreview] = useState(null);
    const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
    const run = async action => {
        setBusy(true); setError(''); setNotice('');
        try { await action(); } catch (failure) { setPreview(null); setSuggestions(null); setError(failure.message); }
        finally { setBusy(false); }
    };
    const find = () => run(async () => { setPreview(null); setSuggestions((await nativeRequest(`${path}/suggestions`)).data.suggestions); });
    const inspect = problem => run(async () => { setPreview((await nativeRequest(`${path}/suggestions/preview`, json('POST', { problem_id: problem.id }))).data); });
    const decide = confirm => run(async () => {
        await nativeRequest(`${path}/suggestions/${confirm ? 'confirm' : 'reject'}`, json('POST', { preview_id: preview.preview_id }));
        setSuggestions(current => current?.filter(row => row.id !== preview.problem.id)); setPreview(null);
        setNotice(confirm ? 'Incident linked. No reply sent.' : 'Suggestion rejected. No tickets changed.');
        if (confirm) await onChanged();
    });
    return <section className="problem-suggestions" aria-label="Suggested problems">
        <button type="button" className="btn btn-sm btn-white" disabled={disabled || busy} onClick={find}>Find suggested problems</button>
        {error && <p role="alert" className="text-danger">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        {suggestions?.length === 0 && <p role="status">No suggested problems. You can still link from the problem ticket.</p>}
        {!!suggestions?.length && !preview && <ul className="problem-ticket-list">{suggestions.map(problem => <li key={problem.id}>
            <strong>{problem.subject || problem.id}</strong><p>Shared subject terms: {problem.matched_terms.join(', ')}</p>
            <button type="button" className="btn btn-sm btn-white" disabled={disabled || busy} onClick={() => inspect(problem)}>Inspect suggestion</button>
        </li>)}</ul>}
        {preview && <div aria-label="Suggested problem preview">
            <p>Suggested problem: <strong>{preview.problem.subject || preview.problem.id}</strong></p>
            <p>{preview.problem.channel} · {preview.problem.status_category}</p>
            <p>Incident: {preview.incident.subject || preview.incident.id}</p>
            <p>{preview.effect}</p>
            <div className="problem-actions"><button type="button" className="btn btn-sm btn-white" disabled={disabled || busy} onClick={() => decide(false)}>Reject suggestion</button>
                <button type="button" className="btn btn-sm btn-primary" disabled={disabled || busy} onClick={() => decide(true)}>Confirm incident link</button></div>
        </div>}
    </section>;
}
