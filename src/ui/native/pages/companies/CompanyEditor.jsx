import React, { useEffect, useState } from 'react';
import { useUnsavedChanges } from '../../NavigationGuard';
import { Field, Section } from '../forms';
import { companyRequest } from './company-api';

export function AttributeInputs({ fields, values, onChange }) {
    return <div className="companies-form-grid">{fields.map(field => <Field key={field.id} name={`company-attribute-${field.id}`} label={field.name} type={field.type === 'dropdown' ? 'text' : field.type} value={values[field.id]} step={field.type === 'number' ? 'any' : undefined} options={field.type === 'dropdown' ? [{ value: '', label: 'Not set' }, ...field.options] : undefined} onChange={(_, value) => onChange(field.id, value === '' ? null : value)}/>)}</div>;
}

export default function CompanyEditor({ projectId, companyId, fields, onSaved, onCancel }) {
    const [draft, setDraft] = useState(companyId ? null : { name: '', domains: '', attributes: {}, portalCompanyView: false });
    const [error, setError] = useState(''), [busy, setBusy] = useState(false);
    const { markDirty, markSaved } = useUnsavedChanges();
    useEffect(() => {
        if (!companyId) return;
        const controller = new AbortController();
        companyRequest(projectId, companyId).then(result => { if (!controller.signal.aborted) setDraft({ ...result.company, domains: result.company.domains.join('\n') }); }).catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
        return () => controller.abort();
    }, [projectId, companyId]);
    const change = (key, value) => { markDirty(); setDraft(current => ({ ...current, [key]: value })); };
    const save = async event => {
        event.preventDefault(); setBusy(true); setError('');
        try {
            const value = { name: draft.name.trim(), domains: draft.domains.split(/[\n,]+/).map(domain => domain.trim()).filter(Boolean), attributes: draft.attributes, portalCompanyView: Boolean(draft.portalCompanyView), ...(companyId ? { revision: draft.revision } : {}) };
            const result = await companyRequest(projectId, companyId, '', companyId ? 'PATCH' : 'POST', value);
            markSaved(); await onSaved(result.company);
        } catch (failure) { setError(failure.message); } finally { setBusy(false); }
    };
    return <div className="companies-editor"><button className="companies-back" onClick={onCancel} disabled={busy}>← {companyId ? 'Back to company' : 'All companies'}</button><h2>{companyId ? 'Edit company' : 'Add a company'}</h2>
        {error && <p className="alert alert-danger" role="alert">{error}</p>}
        {!draft && !error && <p role="status">Loading company…</p>}
        {draft && <form onSubmit={save}><fieldset disabled={busy}>
            <Section card title="Company details" description="A home for this company’s contacts and support history."><Field name="company-name" label="Company name" required value={draft.name} onChange={(_, value) => change('name', value)}/><Field name="company-domains" type="textarea" rows={3} label="Domains" value={draft.domains} placeholder="example.com" hint="One domain per line, or separate them with commas. Use domains you have confirmed belong to this company." onChange={(_, value) => change('domains', value)}/></Section>
            <Section card title="Custom attributes" description="Keep the details your team needs alongside each relationship.">{fields.length ? <AttributeInputs fields={fields} values={draft.attributes} onChange={(key, value) => change('attributes', { ...draft.attributes, [key]: value })}/> : <p className="settings-note">No company attributes defined yet. Add them in Company attributes.</p>}</Section>
            <Section card title="Company portal view" description="Control whether this company can share support tickets in the customer portal."><div className="companies-entitlement"><Field name="company-portal" type="checkbox" label="Allow company members to view company tickets" value={draft.portalCompanyView} onChange={(_, value) => change('portalCompanyView', value)}/><p className="settings-note">Off by default. When enabled, verified members of this company can view tickets from other members in the portal. Only enable this when the company has agreed to share its support history.</p><p className="companies-access-note"><i className={`fe fe-${draft.portalCompanyView ? 'users' : 'lock'}`} aria-hidden="true"/>{draft.portalCompanyView ? 'Company ticket sharing will be enabled when you save.' : 'Members keep their individual ticket access.'}</p></div></Section>
            <div className="companies-actions"><button className="btn btn-primary" type="submit">{busy ? 'Saving…' : companyId ? 'Save company' : 'Create company'}</button><button className="btn btn-outline-secondary" type="button" onClick={onCancel}>Cancel</button></div>
        </fieldset></form>}
    </div>;
}
