import React, { useEffect, useState } from 'react';
import { nativeRequest } from '../transport';

const modes = [['auto', 'Send automatically'], ['draft', 'Draft for my team'], ['off', 'Off']];

/** The workspace's AI reply mode, saved as it changes. A failed save restores the
 * stored mode and shows the error beside the control. */
export default function AiReplyMode({ base, mode, onSaved }) {
    const [value, setValue] = useState(mode || 'auto'), [busy, setBusy] = useState(false), [error, setError] = useState('');
    useEffect(() => { setValue(mode || 'auto'); }, [mode]);
    const change = async next => {
        setValue(next); setError(''); setBusy(true);
        try {
            await nativeRequest(`${base}/ai`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ai_reply_mode: next }) });
            onSaved(next);
        } catch (e) { setValue(mode || 'auto'); setError(e.message); } finally { setBusy(false); }
    };
    return <div className="form-group mb-4">
        <label htmlFor="ai_reply_mode" className="form-label">AI replies</label>
        <select id="ai_reply_mode" name="ai_reply_mode" className={`form-select${error ? ' is-invalid' : ''}`} value={value} disabled={busy} aria-busy={busy || undefined} aria-invalid={error ? 'true' : undefined} aria-describedby={error ? 'ai_reply_mode-error' : undefined} onChange={event => change(event.target.value)}>
            {modes.map(([option, label]) => <option key={option} value={option}>{label}</option>)}
        </select>
        {error && <div id="ai_reply_mode-error" className="invalid-feedback d-block" role="alert">{error}</div>}
    </div>;
}
