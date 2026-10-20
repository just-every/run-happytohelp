import React from 'react';
import { Field } from '../forms';

export default function TriageTaxonomy({ rows, onChange }) {
    const update = (id, key, value) => onChange(rows.map(row => row.id === id ? { ...row, [key]: value } : row));
    return <>
        <div className="triage-table-scroll" tabIndex={0} role="region" aria-label="Intent taxonomy">
            <table className="table triage-table">
                <caption>Rename intents or retire them by turning off Active. Retired intents remain in ticket history.</caption>
                <thead><tr><th scope="col">Intent</th><th scope="col">Active</th></tr></thead>
                <tbody>{rows.map(row => <tr key={row.id}>
                    <td><Field name={`triage-intent-${row.id}`} label="Intent name" required value={row.name} onChange={(_, value) => update(row.id, 'name', value)}/></td>
                    <td><Field name={`triage-active-${row.id}`} label={`Active: ${row.name || 'new intent'}`} type="checkbox" value={row.active} onChange={(_, value) => update(row.id, 'active', value)}/></td>
                </tr>)}</tbody>
            </table>
        </div>
        {rows.length === 0 && <p className="settings-note">No intents yet. Add an intent to build your taxonomy.</p>}
        <button type="button" className="workflow-secondary" onClick={() => onChange([...rows, { id: crypto.randomUUID(), name: '', active: true }])}>Add intent</button>
    </>;
}
