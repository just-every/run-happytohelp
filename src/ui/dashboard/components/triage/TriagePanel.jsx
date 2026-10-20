import React, { useCallback, useEffect, useState } from 'react';
import { nativeRequest } from '../../../native/transport';
import { ticketPath } from '../tickets/ticket-model';
import TriageCorrections from './TriageCorrections';
import TriageHistory from './TriageHistory';
import { confidence, fieldName, triageFields, triageValue } from './triage-model';
import './triage-panel.css';

function TriageContent({ path, revision }) {
    const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    const [dirty, setDirty] = useState(false), [generation, setGeneration] = useState(0);
    const [correcting, setCorrecting] = useState(false);
    const correctionDirty = useCallback(value => setDirty(value), []);
    useEffect(() => {
        if (dirty || correcting) { setBusy(false); return; }
        let active = true;
        setBusy(true); setError('');
        nativeRequest(path).then(result => { if (active) setData(result.data); }).catch(failure => { if (active) setError(failure.message); }).finally(() => { if (active) setBusy(false); });
        return () => { active = false; };
    }, [path, generation, revision, dirty, correcting]);
    useEffect(() => {
        if (data?.state !== 'pending' || dirty || error) return;
        const timer = setTimeout(() => setGeneration(value => value + 1), 5000);
        return () => clearTimeout(timer);
    }, [data, dirty, error]);
    const reload = () => {
        if (dirty && !window.confirm('Discard this unsaved triage correction and reload?')) return;
        setData(null); setDirty(false); setGeneration(value => value + 1);
    };
    return <>
        {error && <p role="alert" className="text-danger">{error}</p>}
        {!data && !error && <p role="status">Loading triage…</p>}
        {data && <>
            <p className="triage-state" role="status">{fieldName(data.state)}{data.reason ? ` · ${data.reason}` : ''}</p>
            <div className="triage-predictions">{triageFields.map(field => {
                const prediction = data.predictions[field];
                return <article key={field} className="triage-prediction">
                    <h5>{fieldName(field)}</h5>
                    <p className="triage-value">{triageValue(field, data.values[field], data.taxonomy)}</p>
                    {prediction && <>
                        <p className="form-text">Prediction: {triageValue(field, prediction.value, data.taxonomy)} · {confidence(prediction.confidence)} confidence</p>
                        <blockquote><span className="triage-quote-label">Quoted evidence</span>{prediction.quote}</blockquote>
                    </>}
                    {!prediction && <p className="form-text">No prediction available.</p>}
                </article>;
            })}</div>
            {data.permissions.correct ? <TriageCorrections data={data} path={path} onSaved={setData} onDirty={correctionDirty} onBusy={setCorrecting}/> : <p className="form-text">Your role can read triage. Ticket management permission is required to correct predictions.</p>}
            <TriageHistory labels={data.labels} taxonomy={data.taxonomy}/>
        </>}
        <button type="button" className="btn btn-link btn-sm" disabled={busy || correcting} onClick={reload}>{busy && data ? 'Refreshing triage…' : 'Reload triage'}</button>
    </>;
}

export default function TriagePanel({ conversation }) {
    const path = `${ticketPath(conversation.project_id)}/conversations/${encodeURIComponent(conversation.id)}/triage`;
    return <details className="triage-panel" open><summary>Intelligent triage</summary><TriageContent key={path} path={path} revision={conversation.last_message_id || conversation.last_message?.id}/></details>;
}
