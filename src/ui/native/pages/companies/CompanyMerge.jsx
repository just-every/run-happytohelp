import React, { useState } from 'react';
import { Field } from '../forms';
import { useConfirmation } from '../ConfirmDialog';
import { attributeValue, companyRequest } from './company-api';

export default function CompanyMerge({ projectId, company, companies, fields, onChanged }) {
    const [sourceId, setSourceId] = useState(''), [preview, setPreview] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    const { ask, dialog } = useConfirmation();
    const prepare = async event => {
        event.preventDefault(); setError(''); setPreview(null); setBusy(true);
        try { const result = await companyRequest(projectId, company.id, '/merge/preview', 'POST', { sourceId }); setPreview(result.preview); }
        catch (failure) { setError(failure.message); } finally { setBusy(false); }
    };
    const merge = () => ask({ title: `Merge ${preview.sourceName} into ${preview.targetName}?`, confirmLabel: 'Confirm merge', busyLabel: 'Merging…', body: <><p>{preview.targetName} will keep its name and the values shown in this preview. Contacts and domains from {preview.sourceName} will be combined into it.</p><p>The merge is recorded in company history and can be undone if its affected records have not changed. You may be asked to confirm your identity.</p></>, run: async () => { await companyRequest(projectId, company.id, '/merge', 'POST', { sourceId, preview }); setPreview(null); setSourceId(''); await onChanged(); } });
    return <section className="companies-panel"><h3>Merge another company into {company.name}</h3><p className="settings-note">Bring duplicate company records together. Review the combined members, domains and attribute decisions before confirming.</p>
        <form className="companies-merge-select" onSubmit={prepare}><Field name="company-merge-source" label="Company to merge" required value={sourceId} options={[{ value: '', label: 'Choose a company' }, ...companies.filter(item => item.id !== company.id).map(item => ({ value: item.id, label: item.name }))]} onChange={(_, value) => { setSourceId(value); setPreview(null); setError(''); }}/><button className="btn btn-outline-secondary" disabled={busy || !sourceId}>{busy ? 'Preparing…' : 'Preview merge'}</button></form>
        {error && <p className="alert alert-danger" role="alert">{error}</p>}
        {preview && <div className="companies-merge-plan"><div className="companies-merge-direction"><div><span>Merge from</span><strong>{preview.sourceName}</strong></div><span aria-hidden="true">→</span><div><span>Keep company</span><strong>{preview.targetName}</strong></div></div>
            <dl className="companies-facts companies-merge-facts"><div><dt>Members coming from source</dt><dd>{preview.sourceMemberCount}</dd></div><div><dt>Combined members</dt><dd>{preview.memberCount}</dd></div><div><dt>Company portal view after merge</dt><dd>{preview.portalCompanyView ? 'Enabled' : 'Off'}</dd></div></dl>
            <h4>Combined domains</h4><div className="companies-chips">{preview.domains.length ? preview.domains.map(domain => <span className="companies-chip" key={domain}>{domain}</span>) : <span className="settings-note">No domains</span>}</div>
            <h4 className="companies-merge-attribute-heading">Attribute decisions</h4>{Object.keys(preview.attributes).length ? <dl className="companies-facts">{Object.entries(preview.attributes).map(([id, value]) => <div key={id}><dt>{fields.find(field => field.id === id)?.name || id}</dt><dd>{attributeValue(value)} <small className="settings-note">· from {preview.provenance.attributes[id] === 'source' ? preview.sourceName : preview.targetName}</small></dd></div>)}</dl> : <p className="settings-note">Neither company has attribute values.</p>}
            {preview.conflicts.length > 0 && <div className="companies-merge-conflicts"><h4>{preview.conflicts.length} conflicting {preview.conflicts.length === 1 ? 'value' : 'values'}</h4><p className="settings-note">Existing values from {preview.targetName} are kept.</p><ul>{preview.conflicts.map(conflict => <li key={conflict.fieldId}><strong>{fields.find(field => field.id === conflict.fieldId)?.name || conflict.fieldId}</strong>: keep {attributeValue(conflict.target)}; source value {attributeValue(conflict.source)}</li>)}</ul></div>}
            <div className="companies-access-note"><i className="fe fe-lock" aria-hidden="true"/><span>Portal access: {preview.provenance.portalCompanyView.target ? 'enabled' : 'off'} on {preview.targetName}, {preview.provenance.portalCompanyView.source ? 'enabled' : 'off'} on {preview.sourceName}; combined access will be {preview.portalCompanyView ? 'enabled' : 'off'}.</span></div>
            <div className="companies-actions companies-merge-confirm"><button className="btn btn-primary" onClick={merge}>Merge companies…</button><button className="btn btn-outline-secondary" onClick={() => setPreview(null)}>Cancel preview</button></div>
        </div>}{dialog}
    </section>;
}
