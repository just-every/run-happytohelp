import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { nativeRequest } from '../../transport';
import { busyWait, isBusy } from '../../../dashboard/utils/busy';
import { PageHeaderActions } from '../../PageHeader';
import { Feedback } from '../forms';
import CutoverForm from './CutoverForm';
import CutoverSource from './CutoverSource';
import { busyNotice } from './cutover-presentation';
import './cutover.css';

export default function Cutover({ projectId }) { return <CutoverWorkspace key={projectId} projectId={projectId}/>; }

/** Settings > Cutover: where each move-in source stands, with every switch recorded beside its check and its undo. */
function CutoverWorkspace({ projectId }) {
    const path = `/api/move-in/projects/${encodeURIComponent(projectId)}/cutover`;
    const [sources, setSources] = useState(null), [access, setAccess] = useState('loading'), [error, setError] = useState(''), [recording, setRecording] = useState(false);
    // A busy database (503) is a wait: what is shown stays, the busy line says so, and the read runs again after
    // Retry-After while this page is open. Leaving the page ends the read and its retry.
    const [busy, setBusy] = useState(false), [reading, setReading] = useState(true), open = useRef(null), retry = useRef(null);
    const load = useCallback(() => {
        clearTimeout(retry.current);
        const signal = open.current?.signal;
        setReading(true);
        return nativeRequest(path, { signal }).then(result => { if (signal?.aborted) return; setSources(result.data.sources); setAccess('ready'); setError(''); setBusy(false); setReading(false); })
            .catch(failure => {
                if (signal?.aborted) return;
                setReading(false);
                if (isBusy(failure)) { setBusy(true); retry.current = setTimeout(load, busyWait(failure)); return; }
                setBusy(false); setError(failure.message); setAccess(failure.status === 403 ? 'denied' : 'failed'); setSources(null);
            });
    }, [path]);
    useEffect(() => {
        open.current = new AbortController();
        load();
        return () => { open.current.abort(); clearTimeout(retry.current); };
    }, [load]);
    const recorded = async () => { await load(); setRecording(false); };
    const moveIn = <Link to={`/projects/${encodeURIComponent(projectId)}/move-in`}>Move in</Link>;
    const notice = busy && <p role="status" className="settings-note cutover-busy">{busyNotice}</p>;
    if (access !== 'ready') return <div className="cutover-page" aria-busy={reading || busy || undefined}>{busy ? notice : access === 'loading' ? <p role="status">Checking import access…</p>
        : access === 'denied' ? <p role="alert">Only a workspace owner or admin can move in support history. Ask your workspace owner to review the export.</p>
        : <><Feedback error={error}/><button type="button" className="btn btn-white" onClick={load}>Check import access</button></>}</div>;
    return <div className="workspace-settings cutover-page" aria-busy={reading || busy || undefined}>
        <PageHeaderActions><button type="button" className="btn btn-primary" onClick={() => setRecording(true)}>Record a step</button></PageHeaderActions>
        <Feedback error={error}/>
        {notice}
        <p className="settings-note">Record each switch here, with its undo and its check. Back to {moveIn}.</p>
        {sources.map(source => <CutoverSource key={source.id} source={source}/>)}
        {recording && <CutoverForm path={path} onRecorded={recorded} onCancel={() => setRecording(false)}/>}
    </div>;
}
