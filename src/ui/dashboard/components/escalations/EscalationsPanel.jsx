import React, {useCallback, useEffect, useState} from 'react';
import {useCan} from '../ConversationAccess';
import Connections from './Connections';
import EscalationForm from './EscalationForm';
import EscalationLinks from './EscalationLinks';
import {escalationRead, providerNames} from './api';
import './escalations.css';

export default function EscalationsPanel({projectId, conversationId, onDraft, refreshKey}) {
    const canInstall = useCan(projectId, 'integrations.install');
    const canManage = useCan(projectId, 'conversations.manage');
    const canReply = useCan(projectId, 'conversations.reply');
    const base = `/api/escalations/projects/${encodeURIComponent(projectId)}`;
    const conversationBase = `${base}/conversations/${encodeURIComponent(conversationId)}`;
    // Key the stateful body to the ticket so a changed ticket never exposes old context.
    return <EscalationsBody key={conversationBase} {...{base, conversationBase, canInstall, canManage, canReply, onDraft, refreshKey}}/>;
}

function EscalationsBody({base, conversationBase, canInstall, canManage, canReply, onDraft, refreshKey}) {
    const [data, setData] = useState(null), [connections, setConnections] = useState([]);
    const [loading, setLoading] = useState(true), [error, setError] = useState(''), [connectionError, setConnectionError] = useState('');
    const [adopted, setAdopted] = useState(''), [refresh, setRefresh] = useState(0);
    const reload = useCallback(() => setRefresh(value => value + 1), []);
    useEffect(() => {
        let active = true;
        setLoading(true); setError(''); setConnectionError('');
        Promise.allSettled([escalationRead(conversationBase), escalationRead(`${base}/connections`)]).then(([ticket, providers]) => {
            if (!active) return;
            if (ticket.status === 'fulfilled') setData(ticket.value);
            else setError(ticket.reason.message);
            if (providers.status === 'fulfilled') setConnections(providers.value);
            else setConnectionError(providers.reason.message);
            setLoading(false);
        });
        return () => { active = false; };
    }, [base, conversationBase, refreshKey, refresh]);
    const messages = (data?.messages || []).filter(message => !message.private && !message.is_private && !message.is_note && message.type !== 'note' && message.actor_role !== 'note');
    const drafts = (data?.drafts || []).filter(draft => ['draft', 'approved'].includes(draft.state));
    return <details className="escalations-panel">
        <summary>Engineering escalations {data?.links?.length > 0 && <span className="escalation-count">{data.links.length}</span>}</summary>
        <div className="escalation-panel-body" aria-busy={loading}>
            <div className="escalation-toolbar"><p className="escalation-hint">Linked issues, team handoffs and customer recovery.</p><button className="btn btn-sm btn-outline-secondary" type="button" disabled={loading} onClick={reload}>{loading ? 'Refreshing…' : 'Refresh status'}</button></div>
            {error && <p className="escalation-error" role="alert">{error}</p>}
            {loading && !data && <p className="escalation-hint" role="status">Loading escalations…</p>}
            {data && <>
                {data.operations?.map(operation => <p className="escalation-error" role="status" key={operation.id}>{providerNames[operation.provider]} outcome {operation.state === 'sending' ? 'is not yet confirmed' : 'is unknown'}. Check the provider before posting again.{operation.remote_url && <> <a href={operation.remote_url} target="_blank" rel="noopener noreferrer">Check provider result</a></>}</p>)}
                <EscalationLinks base={conversationBase} links={data.links} handoffs={data.handoffs} canManage={canManage} onChanged={reload}/>
                {drafts.length > 0 && <section className="escalation-drafts" aria-label="Draft customer updates">
                    <strong>Customer updates to review</strong>
                    <p className="escalation-hint">Nothing is sent until you review and edit the draft in the reply composer, then click Send to approve and send it.</p>
                    {drafts.map(draft => <div className="escalation-draft" key={draft.id}><p>{draft.content}</p>{canReply && onDraft && <button className="btn btn-sm btn-outline-primary" type="button" onClick={() => {onDraft({id: draft.id, content: draft.content}); setAdopted(draft.id);}}>Review customer update</button>}{adopted === draft.id && <p className="escalation-hint" role="status">Draft placed in the reply composer. Review and edit it, then click Send to approve and send.</p>}</div>)}
                </section>}
                {canManage && !loading && !error && !connectionError && <EscalationForm key={refresh} base={conversationBase} connections={connections} messages={messages} onChanged={reload}/>}
            </>}
            {connectionError && <p className="escalation-error" role="alert">Connections could not be loaded: {connectionError}</p>}
            {canInstall && <Connections base={base} connections={connections} onSaved={reload}/>}
        </div>
    </details>;
}
