import React, {createContext, useCallback, useContext, useEffect, useMemo, useState} from 'react';
import {nativeRequest} from '../../../native/transport';

const HandleTimerContext = createContext(null);

export const handleDuration = ms => {
    const seconds = Math.floor(Math.max(0, ms) / 1000);
    return `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};

/**
 * The signed-in teammate's handle timer for one ticket, shared by the "+" start menu (Start timer / Stop timer) and
 * Ticket › Handle time. It reads only while `enabled` (ticket management permission, outside a demo project).
 */
export function HandleTimerProvider({conversation, enabled, children}) {
    const path = `/api/dashboard/projects/${encodeURIComponent(conversation.project_id)}/conversations/${encodeURIComponent(conversation.id)}/timer`;
    const [timer, setTimer] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [tick, setTick] = useState(Date.now());
    useEffect(() => {
        setTimer(null); setError('');
        if (!enabled) return undefined;
        let active = true;
        const refresh = () => nativeRequest(path).then(value => { if (active) { setTimer({...value, receivedAt: Date.now()}); setTick(Date.now()); } }).catch(failure => { if (active) setError(failure.message); });
        refresh();
        const poll = setInterval(refresh, 15000);
        window.addEventListener('focus', refresh);
        return () => { active = false; clearInterval(poll); window.removeEventListener('focus', refresh); };
    }, [path, enabled, conversation.status_category, conversation.is_resolved]);
    useEffect(() => {
        if (!timer?.running) return undefined;
        const clock = setInterval(() => setTick(Date.now()), 1000);
        return () => clearInterval(clock);
    }, [timer?.running]);
    const submit = useCallback(async (action, body = {}) => {
        setBusy(true); setError('');
        try {
            const value = await nativeRequest(`${path}/${action}`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)});
            setTimer({...value, receivedAt: Date.now()}); setTick(Date.now());
            return true;
        } catch (failure) { setError(failure.message); return false; }
        finally { setBusy(false); }
    }, [path]);
    const stopped = ['solved', 'closed'].includes(conversation.status_category) || Boolean(conversation.is_resolved);
    const value = useMemo(() => ({
        enabled,
        loaded: Boolean(timer),
        timer,
        running: Boolean(timer?.running),
        total: timer ? timer.totalMs + (timer.running ? Math.max(0, tick - timer.receivedAt) : 0) : 0,
        stopped,
        busy,
        error,
        start: () => submit('start'),
        stop: () => submit('stop'),
        adjust: body => submit('adjust', body),
    }), [enabled, timer, tick, stopped, busy, error, submit]);
    return React.createElement(HandleTimerContext.Provider, {value}, children);
}

/** running, total, start and stop (plus the timer record and adjust, for Ticket › Handle time). */
export default function useHandleTimer() {
    const value = useContext(HandleTimerContext);
    if (!value) throw new Error('useHandleTimer is used outside the conversation it belongs to.');
    return value;
}
