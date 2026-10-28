import React, {useEffect, useRef, useState} from 'react';
import {nativeRequest} from '../../../native/transport';
import './FollowupObligations.css';

const localTime = value => {
    const date = new Date(value);
    return new Date(value - date.getTimezoneOffset() * 60000).toISOString().slice(0,16);
};

export default function FollowupObligations({conversation, reads, liveKey}) {
    const base = `/api/ai-support/projects/${conversation.project_id}/conversations/${conversation.id}/obligations`;
    const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0);
    const [messageId, setMessageId] = useState(''), [quote, setQuote] = useState(''), [notice, setNotice] = useState('');
    const source = useRef(null);
    useEffect(() => {
        let active = true;
        setData(null); setError('');
        nativeRequest(base).then(result => {if (active) setData(result.data);}).catch(e => {if (active) setError(e.message);});
        return () => {active = false;};
    }, [base, reads, liveKey, refresh]);
    const write = async (path, body) => {
        setBusy(true); setError(''); setNotice('');
        try {
            await nativeRequest(base + path, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
            setNotice(path ? 'Changes accepted.' : 'Promise proposed. Review and explicitly accept its terms.');
            setRefresh(n => n + 1);
        } catch (e) {setError(e.message + ' Refresh the record before trying again.');}
        finally {setBusy(false);}
    };
    const sourceMessage = data?.sources.find(m => m.id === messageId);
    return <div className="followup-obligations">
        <p>Promises stay internal until reviewed. Drafts never send themselves.</p>
        <button type="button" className="btn btn-sm btn-outline-secondary" disabled={busy} onClick={() => setRefresh(n => n + 1)}>Refresh promises</button>
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
        {!data && !error && <p role="status">Loading promises…</p>}
        {data && <>
            <details><summary>Propose a follow-up</summary>
                <form onSubmit={event => {
                    event.preventDefault(); const fields = new FormData(event.currentTarget);
                    write('', {messageId, quote, ownerId:fields.get('ownerId'), dueAt:new Date(fields.get('dueAt')).getTime(), stopCondition:fields.get('stopCondition'), dependencyId:fields.get('dependencyId') || null});
                }}>
                    <label>Promise message<select required value={messageId} onChange={e => {setMessageId(e.target.value); setQuote('');}}><option value="">Choose a message</option>{data.sources.map(m => <option key={m.id} value={m.id}>{m.content.slice(0,100)}</option>)}</select></label>
                    {sourceMessage && <><label>Source message<textarea ref={source} readOnly value={sourceMessage.content} rows={5}/></label><button className="btn btn-sm btn-outline-secondary" type="button" onClick={() => setQuote(sourceMessage.content.slice(source.current.selectionStart,source.current.selectionEnd))}>Use selected quote</button></>}
                    <label>Exact promise quote<textarea required maxLength={2000} value={quote} onChange={e => setQuote(e.target.value)} rows={3}/></label>
                    <Terms data={data}/>
                    <label>Stop condition<textarea name="stopCondition" required maxLength={500} rows={2}/></label>
                    <button className="btn btn-sm btn-primary" disabled={busy} type="submit">Propose promise</button>
                </form>
            </details>
            {data.obligations.length === 0 && <p>No follow-up promises yet.</p>}
            {data.obligations.map(row => <article key={`${row.id}:${row.version}`} aria-label="Follow-up promise">
                <blockquote>{row.quote}</blockquote><p>{row.state === 'proposed' ? 'Awaiting acceptance' : row.state === 'open' ? 'Accepted promise' : 'Completed'} · Version {row.version}</p>
                <p>Stop when: {row.stop_condition}</p>
                {row.dependency.id && <p role="status">Dependency {row.issue_key}: {row.dependency.stale ? 'Stale · ' : ''}{row.dependency.progress}. {row.dependency.readbackAt ? `Read back ${new Date(row.dependency.readbackAt).toLocaleString()}.` : 'No current readback.'}</p>}
                {['proposed','open'].includes(row.state) && <form onSubmit={event => {
                    event.preventDefault(); const fields = new FormData(event.currentTarget);
                    write(`/${row.id}/accept`, {version:row.version, ownerId:fields.get('ownerId'), dueAt:new Date(fields.get('dueAt')).getTime(), dependencyId:fields.get('dependencyId') || null});
                }}><Terms data={data} row={row}/><p>Review responsibility, due time and dependency before accepting. Earlier accepted terms remain in history.</p><button className="btn btn-sm btn-primary" disabled={busy} type="submit">Accept promise changes</button></form>}
                {row.changes.length > 0 && <details><summary>Accepted changes ({row.changes.length})</summary><ol>{row.changes.map(change => <li key={change.version}>Version {change.version}: {data.owners.find(o => o.id === change.owner_id)?.name || 'Former teammate'}, due {new Date(change.due_at).toLocaleString()}, accepted {new Date(change.accepted_at).toLocaleString()}.</li>)}</ol></details>}
                {row.draft && <section aria-label="Unsent follow-up draft"><strong>Unsent customer update</strong><p>{row.draft.content}</p><p>Review this wording before using the reply composer.</p></section>}
            </article>)}
        </>}
    </div>;
}

function Terms({data, row}) {
    return <>
        <label>Responsible teammate<select required name="ownerId" defaultValue={row?.owner_id || ''}><option value="">Choose a teammate</option>{data.owners.map(owner => <option key={owner.id} value={owner.id}>{owner.name}</option>)}</select></label>
        <label>Due time<input required type="datetime-local" name="dueAt" defaultValue={row ? localTime(row.due_at) : ''}/></label>
        <label>Engineering dependency<select name="dependencyId" defaultValue={row?.dependency_id || ''}><option value="">No dependency</option>{data.dependencies.map(issue => <option key={issue.id} value={issue.id}>{issue.issue_key}</option>)}</select></label>
    </>;
}
