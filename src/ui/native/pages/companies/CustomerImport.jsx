import React, { useEffect, useState } from 'react';
import { nativeRequest } from '../../transport';
import { useNavigationGuard, useUnsavedChanges } from '../../NavigationGuard';
import { Field } from '../forms';
import { useConfirmation } from '../ConfirmDialog';
import { csvHeaders, jsonRequest, projectPath } from './company-api';
import ImportRows from './ImportRows';

export default function CustomerImport({ projectId, fields, onChanged }) {
    const [kind, setKind] = useState('companies'), [csv, setCsv] = useState(''), [filename, setFilename] = useState(''), [headers, setHeaders] = useState([]), [mapping, setMapping] = useState({}), [matchDomains, setMatchDomains] = useState(false);
    const [run, setRun] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [restoreId, setRestoreId] = useState('');
    const { markDirty, markSaved } = useUnsavedChanges(), { confirmNavigation } = useNavigationGuard(), { ask, dialog } = useConfirmation();
    const path = `${projectPath(projectId)}/customer-imports`, storageKey = `company-import:${projectId}`;
    const remember = result => { setRun(result); setRestoreId(result.id); sessionStorage.setItem(storageKey, result.id); markSaved(); };
    useEffect(() => {
        const id = sessionStorage.getItem(storageKey);
        if (!id) return;
        let active = true; setBusy(true);
        nativeRequest(`${path}/${encodeURIComponent(id)}`).then(result => { if (active) { setRun(result); setRestoreId(result.id); } }).catch(failure => { if (active) setError(`Could not reopen the previous import: ${failure.message}`); }).finally(() => { if (active) setBusy(false); });
        return () => { active = false; };
    }, [path, storageKey]);
    const reset = () => { if (confirmNavigation()) { markSaved(); setRun(null); setCsv(''); setFilename(''); setHeaders([]); setMapping({}); setMatchDomains(false); setError(''); sessionStorage.removeItem(storageKey); } };
    const upload = async event => {
        const file = event.target.files?.[0]; if (!file) return;
        setError('');
        if (file.size > 1024 * 1024) { setError('Choose a CSV file smaller than 1 MB, with no more than 1,000 data rows.'); event.target.value = ''; return; }
        try {
            const contents = await file.text(), columns = csvHeaders(contents);
            if (!columns.length || columns.some(column => !column.trim()) || new Set(columns).size !== columns.length) throw new Error('Use a CSV with a header row and a unique, non-empty name for each column.');
            setCsv(contents); setHeaders(columns); setFilename(file.name); setMapping({}); markDirty();
        } catch (failure) { setError(failure.message); }
    };
    const preview = async event => {
        event.preventDefault(); setBusy(true); setError('');
        try { remember(await nativeRequest(`${path}/preview`, jsonRequest('POST', { kind, csv, mapping: Object.fromEntries(Object.entries(mapping).filter(([, value]) => value)), matchDomains }))); setCsv(''); }
        catch (failure) { setError(failure.message); } finally { setBusy(false); }
    };
    const apply = async () => {
        setBusy(true); setError('');
        try { remember(await nativeRequest(`${path}/${encodeURIComponent(run.id)}/apply`, jsonRequest('POST', {}))); await onChanged(); }
        catch (failure) { setError(failure.message); } finally { setBusy(false); }
    };
    const reload = async event => {
        event?.preventDefault(); const id = run?.id || restoreId.trim(); if (!id) return;
        setBusy(true); setError('');
        try { remember(await nativeRequest(`${path}/${encodeURIComponent(id)}`)); }
        catch (failure) { setError(failure.message); } finally { setBusy(false); }
    };
    const undo = () => ask({ title: 'Undo this import?', confirmLabel: 'Undo import', busyLabel: 'Undoing…', body: <p>This reverses the records created or updated by this import. If an imported record has changed since it was applied, the server will block undo to protect those changes.</p>, run: async () => { remember(await nativeRequest(`${path}/${encodeURIComponent(run.id)}/undo`, jsonRequest('POST', {}))); await onChanged(); } });
    const targets = kind === 'companies' ? [['name', 'Company name'], ['domains', 'Domains'], ...fields.map(field => [`attribute:${field.id}`, `${field.name} (${field.type})`])] : [['name', 'Contact name'], ['email', 'Email'], ['externalId', 'External ID'], ['company', 'Company name']];
    const step = run ? run.status === 'preview' ? 3 : 4 : csv ? 2 : 1;
    return <div className="companies-import"><div className="companies-section-heading"><div><h2>Import companies & contacts</h2><p className="settings-note">Map your columns, inspect every change, then apply. Applied imports can be undone.</p></div>{run && <button className="btn btn-outline-secondary" disabled={busy} onClick={reset}>New import</button>}</div>
        <ol className="companies-import-steps" aria-label="Import progress">{['Upload CSV', 'Map columns', 'Review rows', 'Apply & undo'].map((label, index) => <li key={label} aria-current={step === index + 1 ? 'step' : undefined} className={step >= index + 1 ? 'is-active' : ''}><span>{index + 1}</span>{label}</li>)}</ol>
        {error && <div className="alert alert-danger" role="alert">{error}{run && <p className="mb-0"><button className="btn btn-link" disabled={busy} onClick={reload}>Refresh import status</button></p>}</div>}
        {!run && <form onSubmit={preview}><fieldset disabled={busy}>
            <section className="h2h-card companies-import-upload"><div className="companies-form-grid"><Field name="customer-import-kind" label="What are you importing?" value={kind} options={[{ value: 'companies', label: 'Companies' }, { value: 'contacts', label: 'Contacts' }]} onChange={(_, value) => { setKind(value); setMapping({}); setMatchDomains(false); if (csv) markDirty(); }}/><div className="form-group"><label htmlFor="customer-import-file" className="form-label">CSV file</label><input id="customer-import-file" type="file" accept=".csv,text/csv" className="form-control" onChange={upload}/><div className="form-text">A header row, up to 1,000 data rows, at most 1 MB.</div></div></div>{filename && <p className="settings-note mb-0">Selected: <strong>{filename}</strong></p>}</section>
            {csv && <section className="h2h-card companies-import-mapping"><h3>Map your columns</h3><p className="settings-note">Choose the CSV column for each field. Unmapped fields stay unchanged on existing records. Blank cells in mapped columns clear existing values, except a blank company cell, which keeps the current company or uses the email-domain match.</p><div className="companies-form-grid">{targets.map(([key, label]) => <Field key={key} name={`customer-import-map-${key}`} label={label} value={mapping[key] || ''} options={[{ value: '', label: 'Do not import' }, ...headers.map(header => ({ value: header, label: header }))]} onChange={(_, value) => { markDirty(); setMapping(current => ({ ...current, [key]: value })); }}/>)}</div><div className="companies-import-domain"><Field name="customer-import-domains" label={kind === 'contacts' ? 'Match contact email domains to companies' : 'Match companies by domain'} type="checkbox" value={matchDomains} onChange={(_, value) => { markDirty(); setMatchDomains(value); }}/><p className="settings-note">{kind === 'contacts' ? 'Off by default. The preview shows each matching company before a membership is added. Rows are skipped when a mapped company and an email domain disagree.' : 'Off by default. Match an existing company by its mapped domains as well as its name. Conflicting or ambiguous matches are skipped.'}</p></div><div className="companies-actions"><button className="btn btn-primary" type="submit">{busy ? 'Preparing preview…' : 'Preview every row'}</button><button className="btn btn-outline-secondary" type="button" onClick={reset}>Start over</button></div></section>}
        </fieldset></form>}
        {run && <><div className={`companies-import-result is-${run.status}`} role="status"><div><h3>{run.status === 'preview' ? 'Your import is ready to review' : run.status === 'applied' ? 'Import applied' : run.status === 'undone' ? 'Import undone' : 'Import records erased'}</h3><p>{run.status === 'preview' ? 'No records have changed. Review all rows before applying.' : run.status === 'applied' ? 'The changes below have been saved.' : run.status === 'undone' ? 'The changes from this import have been reversed.' : 'This import’s personal data was erased.'}</p></div><div className="companies-import-counts">{[['create', 'Create'], ['update', 'Update'], ['skip', 'Skip']].map(([key, label]) => <div key={key}><strong>{run.counts[key]}</strong><span>{label}</span></div>)}</div></div>
            <div className="companies-import-run"><span className="settings-note">Import ID: <code>{run.id}</code> · {run.kind === 'companies' ? 'Companies' : 'Contacts'}</span><button className="btn btn-link" disabled={busy} onClick={reload}>Refresh status</button></div>
            <ImportRows run={run} fields={fields}/>
            <div className="companies-import-apply">{run.status === 'preview' && <><p className="settings-note">Apply exactly {run.counts.create} creations and {run.counts.update} updates. {run.counts.skip} rows will be skipped.</p><button className="btn btn-primary" disabled={busy || !run.counts.create && !run.counts.update} onClick={apply}>{busy ? 'Applying…' : 'Apply import'}</button></>}{run.status === 'applied' && <button className="btn btn-outline-danger" disabled={busy} onClick={undo}>Undo this import</button>}</div>
        </>}
        {!run && !csv && <form className="companies-import-restore" onSubmit={reload}><label htmlFor="customer-import-restore">Reopen an import</label><div className="companies-actions"><input id="customer-import-restore" className="form-control" placeholder="Import ID" value={restoreId} onChange={event => setRestoreId(event.target.value)}/><button className="btn btn-outline-secondary" disabled={busy || !restoreId.trim()}>{busy ? 'Opening…' : 'Open import'}</button></div></form>}{dialog}
    </div>;
}
