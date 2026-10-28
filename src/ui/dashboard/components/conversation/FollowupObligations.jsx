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
    const [messageId, setMessageId] = useState(''), [quote, setQuote] = useState(''), [notice, setNotice] = useState(''), [proposing, setProposing] = useState(false);
    const source = useRef(null);
    useEffect(() => {
        let active = true;
        setError('');
        nativeRequest(base).then(result => {if (active) setData(result);}).catch(e => {if (active) setError(e.message);});
        return () => {active = false;};
    }, [base, reads, liveKey, refresh]);
    const write = async (path, body) => {
        setBusy(true); setError(''); setNotice('');
        try {
            const result = await nativeRequest(base + path, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
            setNotice(path ? 'Changes accepted.' : result.duplicate ? (result.pendingChange ? 'Existing promise found. Revised terms are pending your review.' : 'Existing promise found. No new promise was created.') : 'Promise proposed. Review and explicitly accept its terms.');
            setRefresh(n => n + 1);
        } catch (e) {setError(e.message.trim().replace(/[.!?]*$/, '.') + ' Refresh the record before trying again.');}
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
            <details onToggle={event => setProposing(event.currentTarget.open)}><summary>Propose a follow-up</summary>
                <form onSubmit={event => {
                    event.preventDefault(); const fields = new FormData(event.currentTarget);
                    write('', {messageId, quote, ownerId:fields.get('ownerId'), dueAt:new Date(fields.get('dueAt')).getTime(), stopCondition:fields.get('stopCondition'), dependencyId:fields.get('dependencyId') || null});
                }}>
                    <label>Promise message<select aria-label="Promise message" title={sourceMessage?.content || 'Choose a message'} required value={messageId} onChange={e => {setMessageId(e.target.value); setQuote('');}}><option value="">Choose a message</option>{proposing && data.sources.map((m, index) => <option key={m.id} value={m.id} title={m.content}>Message {index + 1}: {m.content.length > 100 ? m.content.slice(0,100).trimEnd() + '…' : m.content}</option>)}</select></label>
                    {sourceMessage && <><label>Source message<textarea aria-label="Source message" ref={source} readOnly value={sourceMessage.content} rows={5}/></label><button className="btn btn-sm btn-outline-secondary" type="button" onClick={() => setQuote(sourceMessage.content.slice(source.current.selectionStart,source.current.selectionEnd))}>Use selected quote</button></>}
                    <label>Exact promise quote<textarea aria-label="Exact promise quote" required maxLength={2000} value={quote} onChange={e => setQuote(e.target.value)} rows={3}/></label>
                    <Terms data={data}/>
                    <label>Stop condition<textarea aria-label="Stop condition" name="stopCondition" required maxLength={500} rows={2}/></label>
                    <button className="btn btn-sm btn-primary" disabled={busy} type="submit">Propose promise</button>
                </form>
            </details>
            {data.obligations.length === 0 && <p>No follow-up promises yet.</p>}
            {data.obligations.map(row => <article key={`${row.id}:${row.version}`} aria-label="Follow-up promise">
                <blockquote>{row.quote}</blockquote><p>{row.state === 'proposed' ? 'Awaiting acceptance' : row.state === 'open' ? 'Accepted promise' : 'Completed'} · Version {row.version}</p>
                <p>Stop when: {row.stop_condition || 'Re-enter the stop condition after restore.'}</p>
                {row.pendingTerms && <section aria-label="Pending promise changes"><strong>Pending changes · not accepted</strong><p>Responsible teammate: {data.owners.find(o => o.id === row.pendingTerms.ownerId)?.name || 'Former teammate'}. Due {new Date(row.pendingTerms.dueAt).toLocaleString()}. Stop when: {row.pendingTerms.stopCondition}</p></section>}
                {row.dependency.id && <p role="status">Dependency {row.issue_key}: {row.dependency.stale ? 'Stale · ' : ''}{row.dependency.progress}. {row.dependency.readbackAt ? `Read back ${new Date(row.dependency.readbackAt).toLocaleString()}.` : 'No current readback.'}</p>}
                {['proposed','open'].includes(row.state) && <form onSubmit={event => {
                    event.preventDefault(); const fields = new FormData(event.currentTarget);
                    write(`/${row.id}/accept`, {version:row.version, ownerId:fields.get('ownerId'), dueAt:new Date(fields.get('dueAt')).getTime(), dependencyId:fields.get('dependencyId') || null, stopCondition:fields.get('stopCondition')});
                }}><Terms data={data} row={row.pendingTerms ? {...row,owner_id:row.pendingTerms.ownerId,due_at:row.pendingTerms.dueAt,dependency_id:row.pendingTerms.dependencyId} : row}/><label>Stop condition<textarea aria-label="Stop condition" name="stopCondition" required maxLength={500} rows={2} defaultValue={row.pendingTerms?.stopCondition ?? row.stop_condition}/></label><p>Review responsibility, due time and dependency before accepting. Earlier accepted terms remain in history.</p><button className="btn btn-sm btn-primary" disabled={busy} type="submit">Accept promise changes</button></form>}
                {row.changes.length > 0 && <details><summary>Accepted changes ({row.changes.length})</summary><ol>{row.changes.map(change => <li key={change.version}>Version {change.version}: {data.owners.find(o => o.id === change.owner_id)?.name || 'Former teammate'}, due {new Date(change.due_at).toLocaleString()}, accepted {new Date(change.accepted_at).toLocaleString()}. {change.stop_condition && `Stop when: ${change.stop_condition}.`}</li>)}</ol></details>}
                {row.draft && <section aria-label="Unsent follow-up draft"><strong>Unsent customer update</strong><p>{row.draft.content}</p><p>Review this wording before using the reply composer.</p></section>}
            </article>)}
        </>}
    </div>;
}

function Terms({data, row}) {
    return <>
        <label>Responsible teammate<select aria-label="Responsible teammate" required name="ownerId" defaultValue={row?.owner_id || ''}><option value="">Choose a teammate</option>{data.owners.map(owner => <option key={owner.id} value={owner.id}>{owner.name}</option>)}</select></label>
        <label>Due time<input aria-label="Due time" required type="datetime-local" name="dueAt" defaultValue={row ? localTime(row.due_at) : ''}/></label>
        <label>Engineering dependency<select aria-label="Engineering dependency" name="dependencyId" defaultValue={row?.dependency_id || ''}><option value="">No dependency</option>{data.dependencies.map(issue => <option key={issue.id} value={issue.id}>{issue.issue_key}</option>)}</select></label>
    </>;
}
