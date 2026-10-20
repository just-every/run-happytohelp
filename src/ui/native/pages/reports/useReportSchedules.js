import {useEffect, useState} from 'react';
import {nativeRequest} from '../../transport';

export const newReportSchedule = () => ({name: '', frequency: 'weekly', hour: 9, weekday: 1, recipients: [], teamId: '', brandId: '', includeImported: false, paused: false});

export function useReportSchedules(projectId) {
    const endpoint = `/api/dashboard/projects/${encodeURIComponent(projectId)}/report-schedules`;
    const [data, setData] = useState(null);
    const [draft, setDraft] = useState(newReportSchedule);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(true);
    const [revision, setRevision] = useState(0);

    useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        setError('');
        setData(null);
        nativeRequest(endpoint, {signal: controller.signal}).then(result => {
            if (!controller.signal.aborted) setData(result);
        }).catch(failure => {
            if (!controller.signal.aborted) setError(failure.message);
        }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
        return () => controller.abort();
    }, [endpoint, revision]);

    async function mutate(path, method, body, message) {
        setBusy(true);
        setError('');
        setNotice('');
        try {
            await nativeRequest(path, {method, ...(body ? {headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)} : {})});
            setNotice(message);
            setRevision(value => value + 1);
            return true;
        } catch (failure) { setError(failure.message); return false; }
        finally { setBusy(false); }
    }

    async function save(event) {
        event.preventDefault();
        if (!draft.recipients.length) { setError('Choose at least one current teammate.'); return; }
        const {weekday, ...rest} = draft;
        const payload = {...rest, teamId: draft.teamId || undefined, brandId: draft.brandId || undefined, ...(draft.frequency === 'weekly' ? {weekday} : {})};
        if (await mutate(endpoint, 'POST', payload, 'Report schedule created.')) setDraft(newReportSchedule());
    }

    return {
        data, draft, error, notice, busy, loading, save,
        change: (key, value) => setDraft(current => ({...current, [key]: value})),
        toggleRecipient: id => setDraft(current => ({...current, recipients: current.recipients.includes(id) ? current.recipients.filter(value => value !== id) : [...current.recipients, id]})),
        pause: schedule => mutate(`${endpoint}/${encodeURIComponent(schedule.id)}`, 'PATCH', {paused: !schedule.paused}, schedule.paused ? 'Report schedule resumed.' : 'Report schedule paused.'),
        remove: schedule => mutate(`${endpoint}/${encodeURIComponent(schedule.id)}`, 'DELETE', null, 'Report schedule deleted.'),
    };
}
