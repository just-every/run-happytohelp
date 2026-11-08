import React, { useRef, useState } from 'react';
import { nativeRequest } from '../transport';

const modes = [['auto', 'Send automatically'], ['draft', 'Draft for my team'], ['off', 'Off']];
const labelOf = mode => modes.find(([option]) => option === mode)?.[1] || mode;
const sentence = text => /[.!?]$/.test(text) ? text : `${text}.`;

/** The workspace's AI reply mode, saved as it changes. Only `ai_reply_mode` is sent. The select shows the mode in
 *  effect (`mode`, updated through `onSaved`); while a change saves it shows that choice, busy. A failed save
 *  returns it to the saved mode, and the error beside it names the choice that was not saved, so choosing it
 *  again retries. */
export default function AiReplyMode({ base, mode, onSaved }) {
    const saved = mode || 'auto';
    const [pending, setPending] = useState(null), [error, setError] = useState('');
    const latest = useRef(0);
    const change = async next => {
        const request = ++latest.current;
        setPending(next); setError('');
        try {
            await nativeRequest(`${base}/ai`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ai_reply_mode: next }) });
            onSaved(next);
        } catch (e) {
            const reason = e.status ? sentence(e.message) : 'Check your connection.';
            if (request === latest.current) setError(`“${labelOf(next)}” was not saved. ${reason} Choose it again to retry.`);
        } finally { if (request === latest.current) setPending(null); }
    };
    return <div className="form-group mb-4">
        <label htmlFor="ai_reply_mode" className="form-label">AI replies</label>
        <select id="ai_reply_mode" name="ai_reply_mode" className={`form-select${error ? ' is-invalid' : ''}`} value={pending || saved} aria-busy={pending !== null || undefined} aria-invalid={error ? 'true' : undefined} aria-describedby={error ? 'ai_reply_mode-error' : undefined} onChange={event => change(event.target.value)}>
            {modes.map(([option, label]) => <option key={option} value={option}>{label}</option>)}
        </select>
        {error && <div id="ai_reply_mode-error" className="invalid-feedback d-block" role="alert">{error}</div>}
    </div>;
}
