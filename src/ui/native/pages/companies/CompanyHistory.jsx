import React from 'react';
import { useConfirmation } from '../ConfirmDialog';
import { attributeValue, companyRequest, dateTime } from './company-api';

const actionLabel = { created: 'Company created', updated: 'Company updated', member_linked: 'Contact linked', member_unlinked: 'Contact unlinked', merged: 'Companies merged', undone: 'Change undone' };
function ChangeDetails({ value, fields }) {
    if (!value || typeof value !== 'object') return <span>{attributeValue(value)}</span>;
    if (Array.isArray(value)) return value.length ? <ul>{value.map((item, index) => <li key={index}><ChangeDetails value={item} fields={fields}/></li>)}</ul> : <span>None</span>;
    return <dl className="companies-change-details">{Object.entries(value).map(([key, item]) => <div key={key}><dt>{fields.find(field => field.id === key)?.name || key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ')}</dt><dd><ChangeDetails value={item} fields={fields}/></dd></div>)}</dl>;
}
export default function CompanyHistory({ projectId, company, history, fields, canManage, onChanged }) {
    const { ask, dialog } = useConfirmation();
    const undo = entry => ask({ title: 'Undo this company change?', confirmLabel: 'Undo change', busyLabel: 'Undoing…', body: <p>This restores the records affected by this change. Undo is blocked if later changes would be overwritten. You may be asked to confirm your identity.</p>, run: async () => { await companyRequest(projectId, entry.companyId, `/history/${encodeURIComponent(entry.id)}/undo`, 'POST', {}); await onChanged(); } });
    return <section className="companies-panel"><div className="companies-section-heading"><div><h3>Company history</h3><p className="settings-note">Changes, membership links and merge records, with protected undo.</p></div></div>
        {history.length ? <ol className="companies-history">{history.map(entry => <li key={entry.id}><div><h4>{actionLabel[entry.action] || entry.action.replace(/[_\.]/g, ' ').replace(/^./, letter => letter.toUpperCase())}</h4><time>{dateTime(entry.at)}</time><p className="settings-note">Actor: {entry.actorId}{entry.undoneBy ? ' · Undone' : ''}</p>{entry.provenance && <details><summary>What changed</summary><ChangeDetails value={entry.provenance} fields={fields}/></details>}</div>{canManage && entry.canUndo && !entry.undoneBy && <button className="btn btn-outline-secondary" onClick={() => undo(entry)}>Undo</button>}</li>)}</ol> : <p className="companies-inline-empty">No changes recorded yet.</p>}{dialog}
    </section>;
}
