import {useEffect, useState} from 'react';
import {downloadFile, nativeRequest} from '../../transport';
import {reportEndpoint} from './report-format';

export function useTeamReport(projectId) {
    const [draft, setDraft] = useState({period: '30', start: '', end: '', teamId: '', brandId: '', includeImported: false});
    const [query, setQuery] = useState('period=30&includeImported=false');
    const [report, setReport] = useState(null);
    const [loading, setLoading] = useState(true);
    const [downloading, setDownloading] = useState(false);
    const [error, setError] = useState('');
    const [revision, setRevision] = useState(0);
    const endpoint = reportEndpoint(projectId);

    useEffect(() => {
        const controller = new AbortController();
        setLoading(true);
        setError('');
        setReport(null);
        nativeRequest(`${endpoint}?${query}`, {signal: controller.signal}).then(result => {
            if (controller.signal.aborted) return;
            setReport(result);
            setDraft(current => ({...current, start: current.start || result.range.start, end: current.end || result.range.end}));
        }).catch(failure => {
            if (!controller.signal.aborted) setError(failure.message);
        }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
        return () => controller.abort();
    }, [endpoint, query, revision]);

    function apply(event) {
        event.preventDefault();
        if (draft.period === 'custom' && draft.start >= draft.end) {
            setError('The end date must be after the start date. The end date is exclusive.');
            return;
        }
        const params = new URLSearchParams({period: draft.period, includeImported: String(draft.includeImported)});
        if (draft.period === 'custom') { params.set('start', draft.start); params.set('end', draft.end); }
        if (draft.teamId) params.set('teamId', draft.teamId);
        if (draft.brandId) params.set('brandId', draft.brandId);
        setQuery(params.toString());
        setRevision(value => value + 1);
    }

    async function download() {
        setDownloading(true);
        setError('');
        try { await downloadFile(`${endpoint}?${query}&format=summary.csv`); }
        catch (failure) { setError(failure.message); }
        finally { setDownloading(false); }
    }

    return {draft, change: (key, value) => setDraft(current => ({...current, [key]: value})), report, loading, error, apply, download, downloading, refresh: () => setRevision(value => value + 1)};
}
