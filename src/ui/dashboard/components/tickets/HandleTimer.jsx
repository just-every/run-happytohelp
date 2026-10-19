import React, {useEffect, useState} from 'react';
import {nativeRequest} from '../../../native/transport';
import './handle-timer.css';

const duration = ms => {
    const seconds = Math.floor(Math.max(0, ms) / 1000);
    return `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};
export default function HandleTimer({conversation}) {
    const path = `/api/dashboard/projects/${encodeURIComponent(conversation.project_id)}/conversations/${encodeURIComponent(conversation.id)}/timer`;
    const [timer, setTimer] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [tick, setTick] = useState(Date.now());
    const [adjusting, setAdjusting] = useState(false), [sessionId, setSessionId] = useState(''), [seconds, setSeconds] = useState(''), [reason, setReason] = useState('');
    useEffect(() => {
        let active = true;
        setTimer(null); setError(''); setAdjusting(false); setSessionId(''); setReason('');
        const refresh = () => nativeRequest(path).then(value => { if (active) { setTimer({...value, receivedAt: Date.now()}); setTick(Date.now()); } }).catch(failure => { if (active) setError(failure.message); });
        refresh();
        const poll = setInterval(refresh, 15000);
        window.addEventListener('focus', refresh);
        return () => { active = false; clearInterval(poll); window.removeEventListener('focus', refresh); };
    }, [path, conversation.status_category, conversation.is_resolved]);
    useEffect(() => {
        if (!timer?.running) return;
        const clock = setInterval(() => setTick(Date.now()), 1000);
        return () => clearInterval(clock);
    }, [timer?.running]);
    const submit = async (action, body = {}) => {
        setBusy(true); setError('');
        try {
            const value = await nativeRequest(`${path}/${action}`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
            setTimer({...value, receivedAt: Date.now()}); setTick(Date.now());
            if (action === 'adjust') { setAdjusting(false); setReason(''); }
        } catch (failure) { setError(failure.message); }
        finally { setBusy(false); }
    };
    const completed = (timer?.sessions || []).filter(session => session.ended_at !== null && (session.user_id === timer.userId || timer.canAdjustOthers));
    const choose = id => {
        setSessionId(id);
        const session = completed.find(value => value.id === id);
        setSeconds(session ? String((session.adjusted_duration_ms ?? (session.ended_at - session.started_at)) / 1000) : '');
    };
    const stopped = ['solved', 'closed'].includes(conversation.status_category) || conversation.is_resolved;
    return <section className="handle-timer" aria-label="Handle time">
        <div className="handle-timer-row"><strong>Handle time</strong>{timer && <output aria-label="Your handle time">{duration(timer.totalMs + (timer.running ? Math.max(0, tick - timer.receivedAt) : 0))}</output>}</div>
        {error && <p role="alert" className="text-danger">{error}</p>}
        {!timer && !error && <p role="status">Loading timer…</p>}
        {timer && <>
            <p className="handle-timer-note">Your recorded work · ticket total {duration(timer.ticketTotalMs)}. Solving the ticket stops every running timer.</p>
            <div className="handle-timer-actions">
                <button type="button" className="btn btn-sm btn-outline-primary" disabled={busy || (!timer.running && stopped)} onClick={() => submit(timer.running ? 'stop' : 'start')}>{busy ? 'Saving…' : timer.running ? 'Stop timer' : 'Start timer'}</button>
                {completed.length > 0 && <button type="button" className="btn btn-sm btn-link" disabled={busy} onClick={() => { setAdjusting(value => !value); if (!sessionId) choose(completed[0].id); }}>Adjust completed time</button>}
            </div>
            {adjusting && <form className="handle-timer-adjust" onSubmit={event => { event.preventDefault(); submit('adjust', {sessionId, durationMs: Math.round(Number(seconds) * 1000), reason}); }}>
                <label>Completed session<select className="form-select form-select-sm" value={sessionId} required onChange={event => choose(event.target.value)}>{completed.map(session => <option key={session.id} value={session.id}>{new Date(session.started_at).toLocaleString()} · {duration(session.adjusted_duration_ms ?? (session.ended_at - session.started_at))}{session.user_id !== timer.userId ? ' · teammate' : ''}</option>)}</select></label>
                <label>Corrected duration (seconds)<input className="form-control form-control-sm" type="number" min="0" max="31622400" step="0.001" required value={seconds} onChange={event => setSeconds(event.target.value)}/></label>
                <label>Reason<input className="form-control form-control-sm" required maxLength="1000" value={reason} onChange={event => setReason(event.target.value)}/></label>
                <p className="handle-timer-note">The original timestamps and every correction stay in ticket history.</p>
                <button className="btn btn-sm btn-primary" disabled={busy || !reason.trim()}>Save adjustment</button>
            </form>}
        </>}
    </section>;
}
