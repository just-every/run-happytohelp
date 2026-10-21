import React, { useContext, useEffect, useState } from 'react';
import { useUnsavedChanges } from '../../../native/NavigationGuard';
import { ChatContext } from '../../contexts/ChatContext';
import TicketField from './TicketField';
import TicketIdentityPicker from './TicketIdentityPicker';
import TriagePanel from '../triage/TriagePanel';
import { label } from './ticket-model';
import './tickets.css';

const editable = ['subject', 'channel', 'brand_id', 'group_id', 'requester_id', 'submitter_id', 'submitter_type'];

/**
 * Ticket › Ticket fields: subject, channel, brand, group, requester, submitter, custom fields and triage, saved
 * together with Save ticket. Status and Priority live in the Summary and save on change against the same record.
 * Unsaved edits sit over the record, so a Summary change never discards them.
 */
export default function TicketEditor({ conversation, record }) {
    const { markDirty, markSaved } = useUnsavedChanges();
    const { agentsFor } = useContext(ChatContext);
    const { ticket, settings, error: loadError } = record;
    const [edits, setEdits] = useState({}), [error, setError] = useState(''), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false);
    useEffect(() => { setEdits({}); setError(''); setSaved(false); markSaved(); }, [conversation.id]);
    const draft = ticket ? { ...ticket, ...edits, fields: { ...ticket.fields, ...edits.fields } } : null;
    const change = (name, value) => { markDirty(); setSaved(false); setEdits(current => ({ ...current, [name]: value })); };
    const changeField = (id, value) => { markDirty(); setSaved(false); setEdits(current => ({ ...current, fields: { ...current.fields, [id]: value } })); };
    const save = async event => {
        event.preventDefault(); setBusy(true); setError(''); setSaved(false);
        const changes = Object.fromEntries(editable.filter(key => key in edits && edits[key] !== ticket[key]).map(key => [key, edits[key] === '' && key.endsWith('_id') ? null : edits[key]]));
        const fields = Object.fromEntries((settings.fields || []).filter(field => field.writable && edits.fields && field.id in edits.fields && JSON.stringify(edits.fields[field.id]) !== JSON.stringify(ticket.fields?.[field.id])).map(field => [field.id, edits.fields[field.id]]));
        if (Object.keys(fields).length) changes.fields = fields;
        try {
            await record.save(changes);
            setEdits({}); markSaved(); setSaved(true);
        } catch (failure) { setError(failure.message); }
        setBusy(false);
    };
    const reload = async () => {
        if (!window.confirm('Reload ticket and discard unsaved ticket changes?')) return;
        setBusy(true); setError('');
        try { await record.reload(); setEdits({}); markSaved(); setSaved(false); } catch (failure) { setError(failure.message); } finally { setBusy(false); }
    };
    const agents = agentsFor(conversation.project_id) || [];
    const disabled = busy || !settings?.permissions.manage || ticket?.status_category === 'closed';
    const changeSubmitterType = value => {
        markDirty(); setSaved(false);
        setEdits(current => ({ ...current, submitter_type: value, submitter_id: value === 'system' ? 'system' : value === 'contact' ? (current.requester_id ?? ticket.requester_id) : '' }));
    };
    const select = (key, name, options, nullable = false) => <TicketField id={`ticket-${key}`} label={name} field={{ type: 'dropdown', required: key === 'submitter_type', options: [...(nullable ? [{ value: '', label: 'None' }] : []), ...options] }} value={draft[key] || ''} onChange={value => key === 'submitter_type' ? changeSubmitterType(value) : change(key, value)}/>;
    return <div className="ticket-editor">
        {(error || loadError) && <p role="alert" className="text-danger">{error || loadError}</p>}
        {!draft && !loadError && <p role="status">Loading ticket…</p>}
        {draft && settings && <>
            <form onSubmit={save}>
                <fieldset disabled={disabled}>
                    <legend className="visually-hidden">Ticket fields</legend>
                    <TicketField id="ticket-subject" field={{ type: 'text', name: 'Subject' }} value={draft.subject} onChange={value => change('subject', value)}/>
                    <TicketField id="ticket-channel" field={{ type: 'text', name: 'Channel' }} value={draft.channel} onChange={value => change('channel', value)}/>
                    {select('brand_id', 'Brand', settings.brands.map(brand => ({ value: brand.id, label: brand.name })))}
                    {select('group_id', 'Group', settings.groups.map(group => ({ value: group.id, label: group.name })), true)}
                    <TicketIdentityPicker id="ticket-requester_id" label="Requester" projectId={conversation.project_id} value={draft.requester_id} currentContact={conversation.contact} disabled={disabled} onChange={value => change('requester_id', value)}/>
                    {select('submitter_type', 'Submitter type', ['contact', 'agent', 'system'].map(value => ({ value, label: label(value) })))}
                    <TicketIdentityPicker key={draft.submitter_type} id="ticket-submitter_id" label="Submitter" type={draft.submitter_type} projectId={conversation.project_id} value={draft.submitter_id} currentContact={conversation.contact} agents={agents} disabled={disabled} onChange={value => change('submitter_id', value)}/>
                    {(settings.fields || []).filter(field => !field.write_roles.includes('triage-system')).map(field => <React.Fragment key={field.id}>
                        <TicketField id={`ticket-custom-${field.id}`} field={{ ...field, pattern: field.validation?.pattern }} value={draft.fields?.[field.id]} disabled={!field.writable} onChange={value => changeField(field.id, value)}/>
                        <small className="ticket-permission">{field.writable ? 'You can edit' : 'Read only'} · Read: {field.read_roles.join(', ') || 'Every role'} · Edit: {field.write_roles.join(', ') || 'Every role'}</small>
                    </React.Fragment>)}
                    <button className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'Saving…' : 'Save ticket'}</button>
                </fieldset>
                {ticket.status_category === 'closed' && <p className="form-text">Closed tickets cannot be edited or receive replies.</p>}
                {!settings.permissions.manage && <p className="form-text">Your role can read this ticket. Editing requires ticket management permission.</p>}
                {saved && <p role="status">Ticket saved.</p>}
                <button className="btn btn-link btn-sm" type="button" disabled={busy} onClick={reload}>Reload ticket</button>
            </form>
            <TriagePanel conversation={conversation}/>
        </>}
    </div>;
}
