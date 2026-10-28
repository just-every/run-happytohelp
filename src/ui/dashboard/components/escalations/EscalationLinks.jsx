import React, {useId, useState} from 'react';
import {escalationWrite, providerNames} from './api';

function RecoveryForm({base, link, onChanged}) {
    const id = useId();
    const [observation, setObservation] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const submit = async event => {
        event.preventDefault(); setBusy(true); setError('');
        try {
            await escalationWrite(`${base}/links/${encodeURIComponent(link.id)}/recovery`, {observation: observation.trim()});
            setObservation(''); await onChanged();
        } catch (failure) { setError(failure.message); }
        finally { setBusy(false); }
    };
    return <details className="escalation-recovery">
        <summary>Record observed customer recovery</summary>
        <form className="escalation-form" onSubmit={submit}>
            <label htmlFor={id}>What did you observe for this customer?</label>
            <textarea className="form-control form-control-sm" id={id} value={observation} onChange={event => setObservation(event.target.value)} disabled={busy} maxLength={2000} rows={3} required/>
            <p className="escalation-hint">Issue closure does not establish that the customer’s problem is fixed.</p>
            <button className="btn btn-sm btn-outline-secondary" disabled={busy || !observation.trim()}>{busy ? 'Saving…' : 'Record recovery observation'}</button>
        </form>
        {error && <p className="escalation-error" role="alert">{error}</p>}
    </details>;
}

export default function EscalationLinks({base, links, handoffs, canManage, onChanged}) {
    return <div className="escalation-linked">
        {!links.length && !handoffs.length && <p className="escalation-hint">No engineering issues or team handoffs linked yet.</p>}
        {links.map(link => <article className="escalation-link" key={link.id}>
            <div className="escalation-link-heading"><span className="escalation-provider-name">{providerNames[link.provider]}</span><a href={link.url} target="_blank" rel="noopener noreferrer">{link.key}</a><span className="escalation-status">{link.status || 'Status unavailable'}</span></div>
            <dl><div><dt>Assignee</dt><dd>{link.assignee || 'Unassigned'}</dd></div><div><dt>Dependency</dt><dd>{link.dependency || 'Not specified'}</dd></div><div><dt>Customer recovery</dt><dd>{link.recovery === 'observed' ? 'Observed' : 'Unconfirmed'}</dd></div></dl>
            {link.recovery === 'observed' && link.observation && <p className="escalation-hint">Observation: {link.observation}</p>}
            {canManage && link.recovery !== 'observed' && <RecoveryForm base={base} link={link} onChanged={onChanged}/>}
        </article>)}
        {handoffs.map(handoff => <p className="escalation-handoff" key={handoff.id}><span className="escalation-provider-name">{providerNames[handoff.provider] || 'Slack'}</span> <a href={handoff.url} target="_blank" rel="noopener noreferrer">Handoff to {handoff.channel}</a> <span>Shared; customer recovery unconfirmed</span></p>)}
    </div>;
}
