import React, { useContext, useEffect, useState } from 'react';
import { useUnsavedChanges } from '../../../native/NavigationGuard';
import { nativeRequest } from '../../../native/transport';
import { ChatContext } from '../../contexts/ChatContext';
import ConversationDetailSection from '../conversation/ConversationDetailSection';
import TicketField from './TicketField';
import TicketIdentityPicker from './TicketIdentityPicker';
import HandleTimer from './HandleTimer';
import ProblemPanel from './ProblemPanel';
import TicketHistory from './TicketHistory';
import TriagePanel from '../triage/TriagePanel';
import { json, label, priorities, ticketPath } from './ticket-model';
import './tickets.css';

const editable = ['subject', 'status_id', 'priority', 'channel', 'brand_id', 'group_id', 'requester_id', 'submitter_id', 'submitter_type'];
export default function TicketEditor({ conversation }) {
    const { markDirty, markSaved } = useUnsavedChanges();
    const { updateConversation, agentsFor, aisFor } = useContext(ChatContext);
    const [ticket, setTicket] = useState(null), [draft, setDraft] = useState(null), [settings, setSettings] = useState(null);
    const [error, setError] = useState(''), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false);
    const base = ticketPath(conversation.project_id), path = `${base}/conversations/${encodeURIComponent(conversation.id)}/ticket`;
    useEffect(() => {
        let active = true; setTicket(null); setDraft(null); setSettings(null); setError(''); setSaved(false);
        Promise.all([nativeRequest(path), nativeRequest(`${base}/ticket-settings`)]).then(([result, definitions]) => {
            if (active) { setTicket(result.data); setDraft(result.data); setSettings(definitions.data); }
        }).catch(failure => { if (active) setError(failure.message); });
        return () => { active = false; };
    }, [path]);
    const change = (name, value) => { markDirty(); setSaved(false); setDraft(current => ({ ...current, [name]: value })); };
    const save = async event => {
        event.preventDefault(); setBusy(true); setError(''); setSaved(false);
        const changes = Object.fromEntries(editable.filter(key => draft[key] !== ticket[key]).map(key => [key, draft[key] === '' && key.endsWith('_id') ? null : draft[key]]));
        const fields = Object.fromEntries((settings.fields || []).filter(field => field.writable && JSON.stringify(draft.fields?.[field.id]) !== JSON.stringify(ticket.fields?.[field.id])).map(field => [field.id, draft.fields?.[field.id]]));
        if (Object.keys(fields).length) changes.fields = fields;
        try {
            const result = await nativeRequest(path, json('PATCH', { ...changes, expected_version: ticket.ticket_version }));
            setTicket(result.data); setDraft(result.data); updateConversation(conversation.id, result.data); markSaved(); setSaved(true);
        } catch (failure) { setError(failure.message); }
        setBusy(false);
    };
    const agents = agentsFor(conversation.project_id) || [];
    const disabled = busy || !settings?.permissions.manage || ticket?.status_category === 'closed';
    const changeSubmitterType = value => {
        markDirty(); setSaved(false);
        setDraft(current => ({ ...current, submitter_type: value, submitter_id: value === 'system' ? 'system' : value === 'contact' ? current.requester_id : '' }));
    };
    const select = (key, name, options, nullable = false) => <TicketField id={`ticket-${key}`} label={name} field={{ type: 'dropdown', required: key === 'submitter_type', options: [...(nullable ? [{ value: '', label: 'None' }] : []), ...options] }} value={draft[key] || ''} onChange={value => key === 'submitter_type' ? changeSubmitterType(value) : change(key, value)}/>;
    return <ConversationDetailSection title="Ticket" className="ticket-editor">
        {error && <p role="alert" className="text-danger">{error}</p>}
        {!draft && !error && <p role="status">Loading ticket…</p>}
        {draft && settings && <>
            <form onSubmit={save}>
                <fieldset disabled={disabled}>
                    <TicketField id="ticket-subject" field={{ type: 'text', name: 'Subject' }} value={draft.subject} onChange={value => change('subject', value)}/>
                    {select('status_id', 'Status', settings.statuses.filter(status => status.active || status.id === ticket.status_id).map(status => ({ value: status.id, label: `${status.name} (${label(status.category)})` })))}
                    {select('priority', 'Priority', priorities.map(value => ({ value, label: label(value) })))}
                    <TicketField id="ticket-channel" field={{ type: 'text', name: 'Channel' }} value={draft.channel} onChange={value => change('channel', value)}/>
                    {select('brand_id', 'Brand', settings.brands.map(brand => ({ value: brand.id, label: brand.name })))}
                    {select('group_id', 'Group', settings.groups.map(group => ({ value: group.id, label: group.name })), true)}
                    <TicketIdentityPicker id="ticket-requester_id" label="Requester" projectId={conversation.project_id} value={draft.requester_id} currentContact={conversation.contact} disabled={disabled} onChange={value => change('requester_id', value)}/>
                    {select('submitter_type', 'Submitter type', ['contact', 'agent', 'system'].map(value => ({ value, label: label(value) })))}
                    <TicketIdentityPicker key={draft.submitter_type} id="ticket-submitter_id" label="Submitter" type={draft.submitter_type} projectId={conversation.project_id} value={draft.submitter_id} currentContact={conversation.contact} agents={agents} disabled={disabled} onChange={value => change('submitter_id', value)}/>
                    {(settings.fields || []).map(field => <React.Fragment key={field.id}>
                        <TicketField id={`ticket-custom-${field.id}`} field={{ ...field, pattern: field.validation?.pattern }} value={draft.fields?.[field.id]} disabled={!field.writable} onChange={value => change('fields', { ...draft.fields, [field.id]: value })}/>
                        <small className="ticket-permission">{field.writable ? 'You can edit' : 'Read only'} · Read: {field.read_roles.join(', ') || 'Every role'} · Edit: {field.write_roles.join(', ') || 'Every role'}</small>
                    </React.Fragment>)}
                    <button className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'Saving…' : 'Save ticket'}</button>
                </fieldset>
                {ticket.status_category === 'closed' && <p className="form-text">Closed tickets cannot be edited or receive replies.</p>}
                {!settings.permissions.manage && <p className="form-text">Your role can read this ticket. Editing requires ticket management permission.</p>}
                {saved && <p role="status">Ticket saved.</p>}
                <button className="btn btn-link btn-sm" type="button" disabled={busy} onClick={async () => { if (!window.confirm('Reload ticket and discard unsaved ticket changes?')) return; setBusy(true); setError(''); try { const result = await nativeRequest(path); setTicket(result.data); setDraft(result.data); markSaved(); setSaved(false); } catch (failure) { setError(failure.message); } finally { setBusy(false); } }}>Reload ticket</button>
            </form>
            {settings.permissions.manage && <>
                <HandleTimer conversation={conversation}/>
                <ProblemPanel projectId={conversation.project_id} conversationId={conversation.id} ticket={ticket} onChanged={async()=>{const result=await nativeRequest(path);setTicket(result.data);setDraft(result.data);updateConversation(conversation.id,result.data);}}/>
            </>}
            <TriagePanel conversation={conversation}/>
            <TicketHistory history={ticket.history} settings={settings} agents={agents} assistants={aisFor(conversation.project_id) || []} conversation={{ ...conversation, tags: ticket.tags || conversation.tags }}/>
        </>}
    </ConversationDetailSection>;
}
