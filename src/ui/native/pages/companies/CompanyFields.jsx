import React, { useState } from 'react';
import { nativeRequest } from '../../transport';
import { useNavigationGuard, useUnsavedChanges } from '../../NavigationGuard';
import { Field } from '../forms';
import { useConfirmation } from '../ConfirmDialog';
import { jsonRequest, projectPath } from './company-api';

const types = [{ value: 'text', label: 'Text' }, { value: 'number', label: 'Number' }, { value: 'date', label: 'Date' }, { value: 'dropdown', label: 'Drop-down' }, { value: 'checkbox', label: 'Checkbox' }];
export default function CompanyFields({ projectId, fields, onChanged }) {
    const [draft, setDraft] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    const { markDirty, markSaved } = useUnsavedChanges(), { confirmNavigation } = useNavigationGuard(), { ask, dialog } = useConfirmation();
    const path = `${projectPath(projectId)}/company-fields`;
    const edit = field => { if (confirmNavigation()) { markSaved(); setError(''); setDraft(field ? { ...field, options: field.options.join('\n') } : { name: '', type: 'text', options: '' }); } };
    const change = (key, value) => { markDirty(); setDraft(current => ({ ...current, [key]: value })); };
    const save = async event => {
        event.preventDefault(); setBusy(true); setError('');
        try {
            await nativeRequest(`${path}${draft.id ? `/${encodeURIComponent(draft.id)}` : ''}`, jsonRequest(draft.id ? 'PATCH' : 'POST', { name: draft.name.trim(), type: draft.type, options: draft.type === 'dropdown' ? draft.options.split('\n').map(value => value.trim()).filter(Boolean) : [] }));
            markSaved(); setDraft(null); await onChanged();
        } catch (failure) { setError(failure.message); } finally { setBusy(false); }
    };
    const remove = field => ask({ title: `Delete ${field.name}?`, confirmLabel: 'Delete attribute', body: <p>This removes the attribute definition. Clear its values from all companies first; attributes in use cannot be deleted.</p>, run: async () => { await nativeRequest(`${path}/${encodeURIComponent(field.id)}`, { method: 'DELETE' }); await onChanged(); } });
    return <div className="companies-fields"><div className="companies-section-heading"><div><h2>Company attributes</h2><p className="settings-note">Define the details your team tracks across every company.</p></div><button className="btn btn-primary" onClick={() => edit(null)}>Add attribute</button></div>
        {error && <p className="alert alert-danger" role="alert">{error}</p>}
        {draft && <form className="h2h-card companies-field-editor" onSubmit={save}><fieldset disabled={busy}><h3>{draft.id ? 'Edit attribute' : 'New attribute'}</h3><div className="companies-form-grid"><Field name="company-field-name" label="Attribute name" required value={draft.name} onChange={(_, value) => change('name', value)}/><Field name="company-field-type" label="Type" value={draft.type} options={types} onChange={(_, value) => change('type', value)}/></div>{draft.type === 'dropdown' && <Field name="company-field-options" label="Options" required type="textarea" rows={4} hint="One option per line." value={draft.options} onChange={(_, value) => change('options', value)}/>}<div className="companies-actions"><button className="btn btn-primary">{busy ? 'Saving…' : 'Save attribute'}</button><button className="btn btn-outline-secondary" type="button" onClick={() => { if (confirmNavigation()) { markSaved(); setDraft(null); } }}>Cancel</button></div></fieldset></form>}
        {fields.length ? <div className="table-responsive"><table className="table management-table stack-table"><thead><tr><th>Attribute</th><th>Type</th><th>Options</th><th><span className="visually-hidden">Actions</span></th></tr></thead><tbody>{fields.map(field => <tr key={field.id}><td data-label="Attribute"><strong>{field.name}</strong></td><td data-label="Type">{types.find(type => type.value === field.type)?.label}</td><td data-label="Options">{field.type === 'dropdown' ? field.options.join(', ') : '—'}</td><td className="stack-table__actions"><div className="row-actions-inline"><button onClick={() => edit(field)}>Edit<span className="visually-hidden"> {field.name}</span></button><button onClick={() => remove(field)}>Delete<span className="visually-hidden"> {field.name}</span></button></div></td></tr>)}</tbody></table></div> : <div className="companies-empty companies-empty--small"><h3>Make company profiles useful to your team</h3><p>Add text, numbers, dates, drop-downs and checkboxes, then fill them in on each company.</p></div>}{dialog}
    </div>;
}
