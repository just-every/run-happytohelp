import React, {useId, useState} from 'react';
import ContextSelector from './ContextSelector';
import {escalationWrite, providerNames} from './api';

/** The selected-context escalation form, shown by "+" › Escalate to engineering… in a dialog. */
export default function EscalationForm({base, connections, messages, onChanged, onBusyChange}) {
    const id = useId();
    const available = connections.filter(connection => connection.connected);
    const [provider, setProvider] = useState(available[0]?.provider || '');
    const [mode, setMode] = useState('create'), [key, setKey] = useState(''), [title, setTitle] = useState('');
    const [dependency, setDependency] = useState(''), [channel, setChannel] = useState('');
    const [messageIds, setMessageIds] = useState([]), [attachmentIds, setAttachmentIds] = useState([]);
    const [preview, setPreview] = useState(null), [requestId, setRequestId] = useState(null);
    const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
    const connection = available.find(item => item.provider === provider);
    const slack = ['slack', 'teams'].includes(provider);
    const selection = {message_ids: messageIds, attachment_ids: attachmentIds};
    const edit = setter => event => { setter(event.target.value); setPreview(null); setNotice(''); };
    const selectContext = (kind, values) => {
        (kind === 'message_ids' ? setMessageIds : setAttachmentIds)(values);
        setPreview(null); setNotice('');
    };
    const run = async action => {
        setBusy(true); onBusyChange?.(true); setError(''); setNotice('');
        try { await action(); } catch (failure) { setError(failure.message); }
        finally { setBusy(false); onBusyChange?.(false); }
    };
    const inspect = event => {
        event.preventDefault();
        run(async () => {
            setPreview(null);
            setPreview((await escalationWrite(`${base}/preview`, selection)).body);
            setRequestId(crypto.randomUUID());
        });
    };
    const share = () => run(async () => {
        if (preview === null || !connection) return;
        const fields = {...selection, dependency: dependency.trim(), request_id: requestId};
        if (slack) await escalationWrite(`${base}/${provider}`, {...fields, channel: channel.trim() || connection.target});
        else await escalationWrite(`${base}/links`, {...fields, provider, mode, ...(mode === 'link' ? {key: key.trim()} : {title: title.trim()})});
        setPreview(null); setMessageIds([]); setAttachmentIds([]); setTitle(''); setKey(''); setDependency('');
        setNotice(slack ? `Selected context shared to ${providerNames[provider]}.` : 'Engineering issue linked to this ticket.');
        await onChanged();
    });
    if (available.length === 0) return <p className="escalation-hint">An administrator needs to connect GitHub, Linear, Jira, Slack or Teams before you can share an escalation. Connections are in Ticket › Escalations.</p>;
    return <div className="escalation-new">
        <p className="escalation-hint">Create or link an issue, or hand off to Slack or Teams, with only the context you select.</p>
        <form className="escalation-form" onSubmit={inspect}>
            <fieldset disabled={busy}>
                <legend className="visually-hidden">Share an escalation</legend>
                <label htmlFor={`${id}-provider`}>Destination</label>
                <select id={`${id}-provider`} className="form-select form-select-sm" value={provider} onChange={event => {setProvider(event.target.value); setPreview(null); setChannel(''); setKey(''); setNotice('');}}>
                    {available.map(item => <option key={item.provider} value={item.provider}>{providerNames[item.provider]} · {item.target}</option>)}
                </select>
                {slack ? <><label htmlFor={`${id}-channel`}>{provider === 'teams' ? 'Teams team UUID/channel ID' : 'Slack channel ID'}</label>
                    <input id={`${id}-channel`} className="form-control form-control-sm" value={channel} placeholder={connection?.target} onChange={edit(setChannel)}/>
                    <p className="escalation-hint">Leave blank to use {connection?.target}.</p></> : <>
                    <label htmlFor={`${id}-mode`}>Issue action</label>
                    <select id={`${id}-mode`} className="form-select form-select-sm" value={mode} onChange={edit(setMode)}><option value="create">Create a new issue</option><option value="link">Link an existing issue</option></select>
                    {mode === 'create' ? <><label htmlFor={`${id}-title`}>Issue title</label><input id={`${id}-title`} className="form-control form-control-sm" value={title} onChange={edit(setTitle)} maxLength={240} required/></> : <>
                        <label htmlFor={`${id}-key`}>{providerNames[provider]} issue key or number</label><input id={`${id}-key`} className="form-control form-control-sm" value={key} onChange={edit(setKey)} maxLength={200} placeholder={provider === 'github' ? '123' : 'ENG-123'} required/>
                    </>}
                </>}
                <label htmlFor={`${id}-dependency`}>What is this ticket waiting on? (optional)</label>
                <input id={`${id}-dependency`} className="form-control form-control-sm" value={dependency} onChange={edit(setDependency)} maxLength={500}/>
                <ContextSelector messages={messages} messageIds={messageIds} attachmentIds={attachmentIds} onChange={selectContext} disabled={busy}/>
                <button className="btn btn-sm btn-outline-secondary" type="submit">{busy ? 'Working…' : preview === null ? 'Preview selected context' : 'Refresh preview'}</button>
                {preview !== null && <section className="escalation-preview" aria-label="Outgoing context preview">
                    <strong>Preview for {providerNames[provider]}</strong>
                    <p className="escalation-hint">{slack ? `Channel: ${channel.trim() || connection?.target}` : mode === 'create' ? `New issue: ${title}` : `Existing issue: ${key}`}</p>
                    {dependency.trim() && <p>Dependency: {dependency}</p>}
                    <pre>{preview}</pre>
                    <p className="escalation-hint">Only this selected context will be shared. Attachment links expire after seven days.</p>
                    <button className="btn btn-sm btn-primary" type="button" onClick={share}>{slack ? `Share selected context to ${providerNames[provider]}` : mode === 'create' ? 'Create issue with selected context' : 'Link issue with selected context'}</button>
                </section>}
            </fieldset>
        </form>
        {error && <p className="escalation-error" role="alert">{error}</p>}
        {notice && <p className="escalation-hint" role="status">{notice}</p>}
    </div>;
}
