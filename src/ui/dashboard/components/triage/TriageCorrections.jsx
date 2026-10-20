import React, { useEffect, useState } from 'react';
import { useUnsavedChanges } from '../../../native/NavigationGuard';
import { nativeRequest } from '../../../native/transport';
import { Field } from '../../../native/pages/forms';
import { json } from '../tickets/ticket-model';
import { fieldName, triageFields } from './triage-model';

export default function TriageCorrections({ data, path, onSaved, onDirty, onBusy }) {
    const { markDirty, markSaved } = useUnsavedChanges();
    const [field, setField] = useState('intent'), [value, setValue] = useState(data.values.intent || '');
    const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false);
    const currentValue = data.values[field] || '';
    useEffect(() => { if (!dirty) setValue(currentValue); }, [currentValue, dirty]);
    useEffect(() => () => onDirty(false), [onDirty]);
    const change = next => { setValue(next); setDirty(true); onDirty(true); markDirty(); setSaved(false); };
    const choose = next => {
        if (dirty && !window.confirm('Discard this unsaved triage correction?')) return;
        setField(next); setValue(data.values[next] || ''); setDirty(false); onDirty(false); markSaved(); setSaved(false); setError('');
    };
    const save = async event => {
        event.preventDefault(); setBusy(true); onBusy(true); setError(''); setSaved(false);
        try {
            const result = await nativeRequest(path, json('PATCH', { field, value: value.trim() }));
            onSaved(result.data); setValue(result.data.values[field] || ''); setDirty(false); onDirty(false); markSaved(); setSaved(true);
        } catch (failure) { setError(failure.message); }
        finally { setBusy(false); onBusy(false); }
    };
    const intents = data.taxonomy.filter(row => row.active || row.id === currentValue);
    const options = field === 'intent' ? [{ value: '', label: 'Select an intent' }, ...intents.map(row => ({ value: row.id, label: `${row.name}${row.active ? '' : ' (retired)'}` }))]
        : field === 'sentiment' ? [{ value: '', label: 'Select sentiment' }, ...['positive', 'neutral', 'negative'].map(item => ({ value: item, label: fieldName(item) }))] : undefined;
    return <div className="triage-corrections">
        <h5>Operator correction</h5>
        <p className="form-text">Corrections become labels for measuring prediction accuracy.</p>
        {error && <p role="alert" className="text-danger">{error}</p>}
        {saved && <p role="status">Triage correction saved.</p>}
        <form onSubmit={save}>
            <fieldset disabled={busy}>
                <Field name="triage-correction-field" label="Field to correct" value={field} options={triageFields.map(item => ({ value: item, label: fieldName(item) }))} onChange={(_, next) => choose(next)}/>
                <Field name="triage-correction-value" label={`Correct ${field}`} required value={value} options={options} hint={field === 'language' ? 'Enter the language code, such as en or es.' : undefined} onChange={(_, next) => change(next)}/>
                <button type="submit" className="btn btn-primary btn-sm" disabled={!dirty || !value.trim() || busy}>{busy ? 'Saving…' : 'Save correction'}</button>
                {dirty && <button type="button" className="btn btn-link btn-sm" onClick={() => { setValue(currentValue); setDirty(false); onDirty(false); markSaved(); setSaved(false); setError(''); }}>Discard correction</button>}
            </fieldset>
        </form>
    </div>;
}
