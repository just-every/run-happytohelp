import React, { useContext, useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { nativeRequest } from '../../../native/transport';
import useLiveInboxLocation from '../../hooks/useLiveInboxLocation';
import { ChatContext } from '../../contexts/ChatContext';
import TicketViewRules from './TicketViewRules';
import WorkflowQueueFilter from '../workflows/WorkflowQueueFilter';
import { json, queueFields, ticketPath } from './ticket-model';
import './tickets.css';

const empty = { name: '', visibility: 'personal', filters: [], sort: [] };
const readRules = value => { try { const result = typeof value === 'string' ? JSON.parse(value) : value; return Array.isArray(result) ? result : []; } catch { return []; } };
export default function TicketViews({ projectId, currentAgentId }) {
    const { agentsFor, conversationData } = useContext(ChatContext);
    const { search } = useLiveInboxLocation(), navigate = useNavigate();
    const [views, setViews] = useState([]), [settings, setSettings] = useState(null), [tags, setTags] = useState([]), [draft, setDraft] = useState(empty);
    const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [editing, setEditing] = useState(false);
    const path = `${ticketPath(projectId)}/ticket-views`;
    const load = async () => setViews((await nativeRequest(path)).data);
    useEffect(() => { let active = true; setError(''); Promise.all([nativeRequest(path), nativeRequest(`${ticketPath(projectId)}/ticket-settings`), nativeRequest(`${ticketPath(projectId)}/tags`)]).then(([result, definitions, availableTags]) => { if (active) { setViews(result.data); setSettings(definitions.data); setTags(availableTags.data); } }).catch(failure => { if (active) setError(failure.message); }); return () => { active = false; }; }, [path]);
    const contacts = [...new Map(Object.values(conversationData).filter(conversation => conversation.project_id === projectId).flatMap(conversation => [conversation.contact, ...(conversation.participants || [])]).filter(contact => contact?.id && !contact.is_erased && !contact.is_erasing).map(contact => [contact.id, contact])).values()];
    const selected = views.find(view => view.id === String(search.saved_view || ''));
    const choose = id => { setEditing(false); navigate({ search: { ...search, saved_view: id || undefined, filters: undefined, sort: undefined } }); };
    const edit = () => { setDraft(selected ? { ...structuredClone(selected), ...(!canEdit ? { id: undefined, visibility: 'personal' } : {}) } : { ...empty, filters: readRules(search.filters), sort: readRules(search.sort) }); setEditing(true); setNotice(''); };
    const update = patch => { setDraft(current => ({ ...current, ...patch })); setNotice(''); };
    const save = async event => {
        event.preventDefault(); setBusy(true); setError('');
        try {
            const body = { name: draft.name, visibility: draft.visibility, filters: draft.filters, sort: draft.sort, ...(draft.id ? { expected_version: draft.version } : {}) };
            const result = await nativeRequest(draft.id ? `${path}/${encodeURIComponent(draft.id)}` : path, json(draft.id ? 'PUT' : 'POST', body));
            await load(); choose(result.data.id); setNotice('View saved.');
        } catch (failure) { setError(failure.message); } finally { setBusy(false); }
    };
    const remove = async () => {
        if (!window.confirm(`Delete the view “${selected.name}”?`)) return;
        setBusy(true); setError('');
        try { await nativeRequest(`${path}/${encodeURIComponent(selected.id)}?expected_version=${selected.version}`, { method: 'DELETE' }); await load(); choose(''); setNotice('View deleted.'); }
        catch (failure) { setError(failure.message); } finally { setBusy(false); }
    };
    const canEdit = !selected || (selected.visibility === 'shared' ? settings?.permissions.settings : selected.owner_id === currentAgentId);
    return <details className="ticket-queue-tools"><summary>Saved views and ticket filters</summary>
        {error && <p role="alert" className="text-danger">{error}</p>}{notice && <p role="status">{notice}</p>}
        <WorkflowQueueFilter/>
        <label className="form-label" htmlFor="ticket-saved-view">Saved view</label>
        <select className="form-select" id="ticket-saved-view" value={selected?.id || ''} onChange={event => choose(event.target.value)}><option value="">Current inbox filters</option>{['personal', 'shared'].map(visibility => <optgroup key={visibility} label={visibility === 'personal' ? 'Personal' : 'Shared'}>{views.filter(view => view.visibility === visibility).map(view => <option key={view.id} value={view.id} disabled={view.unavailable}>{view.name}{view.unavailable ? ' (restricted or unavailable field)' : ''}</option>)}</optgroup>)}</select>
        {selected?.unavailable && <p role="alert">This view uses a field you cannot access or that was removed. Its filters are unavailable.</p>}
        <div className="ticket-queue-actions"><button type="button" className="btn btn-sm btn-link" disabled={!settings || busy || selected?.unavailable} onClick={edit}>{canEdit ? 'Edit filters' : 'Copy filters'}</button>{selected && canEdit && <button type="button" className="btn btn-sm btn-link" disabled={busy} onClick={remove}>Delete view</button>}</div>
        {editing && settings && <form onSubmit={save}>
            <TicketViewRules projectId={projectId} contacts={contacts} fields={queueFields(settings, agentsFor(projectId) || [], tags, contacts)} filters={draft.filters} sort={draft.sort} onChange={update}/>
            <button type="button" className="btn btn-sm btn-white mt-2" onClick={() => navigate({ search: { ...search, saved_view: undefined, filters: JSON.stringify(draft.filters), sort: JSON.stringify(draft.sort) } })}>Apply filters</button>
            <label className="form-label mt-2" htmlFor="ticket-view-name">View name</label><input id="ticket-view-name" className="form-control" value={draft.name} required maxLength={100} onChange={event => update({ name: event.target.value })}/>
            <label className="form-label mt-2" htmlFor="ticket-view-visibility">Visibility</label><select id="ticket-view-visibility" className="form-select" value={draft.visibility} onChange={event => update({ visibility: event.target.value })}><option value="personal">Personal</option>{settings.permissions.settings && <option value="shared">Shared</option>}</select>
            <div className="ticket-queue-actions"><button className="btn btn-sm btn-primary" disabled={busy}>{busy ? 'Saving…' : canEdit && draft.id ? 'Save view' : 'Save new view'}</button>{draft.id && <button type="button" className="btn btn-sm btn-white" onClick={() => update({ id: undefined, name: `${draft.name} copy`, visibility: 'personal' })}>Save a copy</button>}<button className="btn btn-sm btn-link" type="button" onClick={() => setEditing(false)}>Cancel</button></div>
        </form>}
    </details>;
}
