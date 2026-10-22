import { useEffect, useState } from 'react';
import { nativeRequest } from '../../transport';
export { json, label, ticketPath } from '../../../dashboard/components/tickets/ticket-model';
export const csv = value => String(value || '').split(',').map(part => part.trim()).filter(Boolean);
export const dateTime = (value, timezone) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', ...(timezone ? { timeZone: timezone } : {}) }).format(new Date(value)) : 'No deadline';
/** Reads `path` and re-reads it on demand; with no path (a read the member may not make) it requests nothing. */
export function useWorkflowResource(path) {
    const [data, setData] = useState(null), [error, setError] = useState(''), [saved, setSaved] = useState(false), [busy, setBusy] = useState(false);
    const reload = async () => { if (!path) return null; const result = await nativeRequest(path); setData(result); return result; };
    useEffect(() => { let active = true; setData(null); setError(''); if (!path) return undefined; nativeRequest(path).then(result => { if (active) setData(result); }).catch(failure => { if (active) setError(failure.message); }); return () => { active = false; }; }, [path]);
    const run = async action => { setBusy(true); setError(''); setSaved(false); try { const result = await action(); await reload(); setSaved(true); return result; } catch (failure) { setError(failure.message); return null; } finally { setBusy(false); } };
    return { data, error, saved, busy, run, reload, setError, setSaved };
}
