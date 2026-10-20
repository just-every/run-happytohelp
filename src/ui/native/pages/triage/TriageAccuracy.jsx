import React from 'react';

export default function TriageAccuracy({ rows }) {
    return <div className="triage-table-scroll" tabIndex={0} role="region" aria-label="Accuracy by intent">
        <table className="table triage-table">
            <caption>Accuracy compares model predictions with operator labels. Intents without labels have no measured accuracy.</caption>
            <thead><tr><th scope="col">Intent</th><th scope="col">Labels</th><th scope="col">Correct</th><th scope="col">Accuracy</th></tr></thead>
            <tbody>{rows.map(row => <tr key={row.intent_id}><th scope="row">{row.name}</th><td>{row.total}</td><td>{row.correct}</td><td>{row.accuracy == null ? 'Not measured' : `${(row.accuracy * 100).toFixed(1)}%`}</td></tr>)}</tbody>
        </table>
        {rows.length === 0 && <p className="settings-note">No intent accuracy data yet.</p>}
    </div>;
}
