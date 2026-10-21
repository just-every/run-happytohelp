import React, {useState} from 'react';
import useHandleTimer, {handleDuration} from './useHandleTimer';
import './handle-timer.css';

/** Ticket › Handle time: your running total, the ticket total and corrections to completed sessions. */
export default function HandleTimer() {
    const {timer, running, total, stopped, busy, error, start, stop, adjust} = useHandleTimer();
    const [adjusting, setAdjusting] = useState(false), [sessionId, setSessionId] = useState(''), [seconds, setSeconds] = useState(''), [reason, setReason] = useState('');
    const completed = (timer?.sessions || []).filter(session => session.ended_at !== null && (session.user_id === timer.userId || timer.canAdjustOthers));
    const choose = id => {
        setSessionId(id);
        const session = completed.find(value => value.id === id);
        setSeconds(session ? String((session.adjusted_duration_ms ?? (session.ended_at - session.started_at)) / 1000) : '');
    };
    const saveAdjustment = async event => {
        event.preventDefault();
        if (await adjust({sessionId, durationMs: Math.round(Number(seconds) * 1000), reason})) { setAdjusting(false); setReason(''); }
    };
    return <section className="handle-timer" aria-label="Handle time">
        <div className="handle-timer-row"><strong>Your time</strong>{timer && <output aria-label="Your handle time">{handleDuration(total)}</output>}</div>
        {error && <p role="alert" className="text-danger">{error}</p>}
        {!timer && !error && <p role="status">Loading timer…</p>}
        {timer && <>
            <p className="handle-timer-note">Your recorded work · ticket total {handleDuration(timer.ticketTotalMs)}. Solving the ticket stops every running timer.</p>
            <div className="handle-timer-actions">
                <button type="button" className="btn btn-sm btn-outline-primary" disabled={busy || (!running && stopped)} onClick={() => (running ? stop() : start())}>{busy ? 'Saving…' : running ? 'Stop timer' : 'Start timer'}</button>
                {completed.length > 0 && <button type="button" className="btn btn-sm btn-link" disabled={busy} onClick={() => { setAdjusting(value => !value); if (!sessionId) choose(completed[0].id); }}>Adjust completed time</button>}
            </div>
            {adjusting && <form className="handle-timer-adjust" onSubmit={saveAdjustment}>
                <label>Completed session<select className="form-select form-select-sm" value={sessionId} required onChange={event => choose(event.target.value)}>{completed.map(session => <option key={session.id} value={session.id}>{new Date(session.started_at).toLocaleString()} · {handleDuration(session.adjusted_duration_ms ?? (session.ended_at - session.started_at))}{session.user_id !== timer.userId ? ' · teammate' : ''}</option>)}</select></label>
                <label>Corrected duration (seconds)<input className="form-control form-control-sm" type="number" min="0" max="31622400" step="0.001" required value={seconds} onChange={event => setSeconds(event.target.value)}/></label>
                <label>Reason<input className="form-control form-control-sm" required maxLength="1000" value={reason} onChange={event => setReason(event.target.value)}/></label>
                <p className="handle-timer-note">The original timestamps and every correction stay in ticket history.</p>
                <button className="btn btn-sm btn-primary" disabled={busy || !reason.trim()}>Save adjustment</button>
            </form>}
        </>}
    </section>;
}
