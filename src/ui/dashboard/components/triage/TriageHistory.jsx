import React from 'react';
import { fieldName, triageValue } from './triage-model';

export default function TriageHistory({ labels, taxonomy }) {
    return <details className="triage-history"><summary>Correction history ({labels.length})</summary>
        {labels.length === 0 ? <p className="form-text">No operator corrections yet.</p> : <ol>{labels.map(item => <li key={item.id}>
            <p>{fieldName(item.field)}: <strong>{triageValue(item.field, item.value, taxonomy)}</strong></p>
            <p className="form-text">{item.actor_name || item.actor_id} · <time dateTime={item.at}>{new Date(item.at).toLocaleString()}</time></p>
        </li>)}</ol>}
    </details>;
}
