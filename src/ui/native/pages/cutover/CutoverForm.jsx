import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { trapDialogTab } from '../../../dashboard/components/dialogTabBoundary';
import { nativeRequest } from '../../transport';
import { checkOptions, sourceOptions, stateOptions } from './cutover-presentation';
import '../confirm-dialog.css';
import './cutover.css';

const LIMIT = 2000;
const blank = { source: 'zendesk', state: 'seed', change: '', undo: '', result: 'not_run', detail: '' };

/** Records one step through the record route. A failed post keeps what was typed and says why. */
export default function CutoverForm({ path, onRecorded, onCancel }) {
    const dialog = useRef(null), titleId = useId(), id = useId();
    const [values, setValues] = useState(blank), [busy, setBusy] = useState(false), [error, setError] = useState('');
    useEffect(() => {
        const element = dialog.current, previous = document.activeElement;
        if (!element.open) element.showModal();
        return () => {
            if (element.open) element.close();
            if (previous && previous !== document.body && previous.isConnected) previous.focus();
        };
    }, []);
    const set = event => setValues(old => ({ ...old, [event.target.name]: event.target.value }));
    const submit = async event => {
        event.preventDefault();
        if (busy) return;
        setBusy(true); setError('');
        try {
            const body = { source: values.source, state: values.state, change: values.change, undo: values.undo, check: { result: values.result, detail: values.detail } };
            await nativeRequest(`${path}/steps`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            await onRecorded();
        } catch (failure) { setError(failure.message); setBusy(false); }
    };
    const select = (name, label, options) => <div className="form-group"><label htmlFor={`${id}-${name}`} className="form-label">{label}</label>
        <select id={`${id}-${name}`} name={name} className="form-select" value={values[name]} onChange={set} disabled={busy}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></div>;
    const text = (name, label, rows, required) => <div className="form-group"><label htmlFor={`${id}-${name}`} className="form-label">{label}</label>
        <textarea id={`${id}-${name}`} name={name} className="form-control" rows={rows} maxLength={LIMIT} required={required} value={values[name]} onChange={set} disabled={busy}/></div>;
    return createPortal(<dialog ref={dialog} className="confirm-dialog cutover-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={trapDialogTab} onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }}>
        <form onSubmit={submit}>
            <h2 id={titleId} className="confirm-dialog__title">Record a step</h2>
            <div className="cutover-dialog__row">{select('source', 'Source', sourceOptions)}{select('state', 'After this step', stateOptions)}</div>
            {text('change', 'What changed', 3, true)}
            {text('undo', 'How to undo it', 3, true)}
            <div className="cutover-dialog__row">{select('result', 'Check result', checkOptions)}</div>
            {text('detail', 'Check detail', 2, false)}
            {error && <div role="alert" className="alert alert-danger">{error}</div>}
            <div className="confirm-dialog__actions">
                <button type="button" className="btn btn-outline-secondary confirm-dialog__cancel" disabled={busy} onClick={onCancel}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Recording…' : 'Record step'}</button>
            </div>
        </form>
    </dialog>, document.body);
}
