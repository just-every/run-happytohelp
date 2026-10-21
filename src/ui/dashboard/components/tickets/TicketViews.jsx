import React, { useContext, useState } from 'react';
import { Modal } from 'react-bootstrap';
import { useNavigate } from '@tanstack/react-router';
import { nativeRequest } from '../../../native/transport';
import useLiveInboxLocation from '../../hooks/useLiveInboxLocation';
import { ChatContext } from '../../contexts/ChatContext';
import TicketViewRules from './TicketViewRules';
import { json, queueFields, ticketPath } from './ticket-model';
import './tickets.css';

const empty = { name: '', visibility: 'personal', filters: [], sort: [] };
const readRules = value => { try { const result = typeof value === 'string' ? JSON.parse(value) : value; return Array.isArray(result) ? result : []; } catch { return []; } };

/** A shared view needs the workspace's settings authority; a personal one belongs to its owner. */
export const canEditView = (view, permissions, currentAgentId) => view.visibility === 'shared' ? Boolean(permissions?.settings) : view.owner_id === currentAgentId;

/**
 * Filters › "Save as view…" and "Edit view…": the rules editor in a dialog with the view's name and visibility. Save as
 * view starts from the current saved view's rules as a personal copy, or from the list's applied filters; Edit view
 * changes, copies or deletes a view this member may change. A save or delete calls refreshInboxData(), so the rail reads
 * the views again; the list moves to the saved view (or off the deleted one) and the dialog closes.
 */
export default function TicketViews({ projectId, currentAgentId, view, editing, settings, tags, onClose, onNotice }) {
    const { agentsFor, conversationData, refreshInboxData } = useContext(ChatContext);
    const { search } = useLiveInboxLocation(), navigate = useNavigate();
    const [ draft, setDraft ] = useState(() => editing ? structuredClone(view)
        : view ? { ...empty, name: `${ view.name } copy`, filters: structuredClone(view.filters), sort: structuredClone(view.sort) }
        : { ...empty, filters: readRules(search.filters), sort: readRules(search.sort) });
    const [ error, setError ] = useState(''), [ busy, setBusy ] = useState(false);
    const path = `${ ticketPath(projectId) }/ticket-views`;
    const contacts = [ ...new Map(Object.values(conversationData).filter(conversation => conversation.project_id === projectId).flatMap(conversation => [ conversation.contact, ...(conversation.participants || []) ]).filter(contact => contact?.id && !contact.is_erased && !contact.is_erasing).map(contact => [ contact.id, contact ])).values() ];
    const deletable = editing && settings && canEditView(view, settings.permissions, currentAgentId);
    const update = patch => setDraft(current => ({ ...current, ...patch }));
    const finish = async (next, notice) => { await navigate({ search: next }); onNotice(notice); onClose(); };
    const save = async event => {
        event.preventDefault(); setBusy(true); setError('');
        try {
            const body = { name: draft.name, visibility: draft.visibility, filters: draft.filters, sort: draft.sort, ...(draft.id ? { expected_version: draft.version } : {}) };
            const result = await nativeRequest(draft.id ? `${ path }/${ encodeURIComponent(draft.id) }` : path, json(draft.id ? 'PUT' : 'POST', body));
            refreshInboxData();
            await finish({ ...search, view: undefined, assigned_to: undefined, filters: undefined, sort: undefined, saved_view: result.data.id }, 'View saved.');
        } catch (failure) { setError(failure.message); setBusy(false); }
    };
    const remove = async () => {
        if (!window.confirm(`Delete the view “${ view.name }”?`)) return;
        setBusy(true); setError('');
        try {
            await nativeRequest(`${ path }/${ encodeURIComponent(view.id) }?expected_version=${ view.version }`, { method: 'DELETE' });
            refreshInboxData();
            await finish({ ...search, saved_view: undefined }, 'View deleted.');
        } catch (failure) { setError(failure.message); setBusy(false); }
    };
    const apply = () => { navigate({ search: { ...search, saved_view: undefined, filters: JSON.stringify(draft.filters), sort: JSON.stringify(draft.sort) } }); onClose(); };
    return <Modal show onHide={ () => !busy && onClose() } className="ticket-view-dialog" aria-labelledby="ticket-view-dialog-title">
        <Modal.Header closeButton={ !busy }><Modal.Title id="ticket-view-dialog-title">{ editing ? 'Edit view' : 'Save as view' }</Modal.Title></Modal.Header>
        <form onSubmit={ save }>
            <Modal.Body className="ticket-queue-tools">
                { error && <p role="alert" className="text-danger">{ error }</p> }
                { !settings ? <p role="status">Loading ticket fields…</p> : <fieldset disabled={ busy }>
                    <TicketViewRules projectId={ projectId } contacts={ contacts } fields={ queueFields(settings, agentsFor(projectId) || [], tags, contacts) } filters={ draft.filters } sort={ draft.sort } onChange={ update }/>
                    <label className="form-label mt-3" htmlFor="ticket-view-name">View name</label><input id="ticket-view-name" className="form-control" value={ draft.name } required maxLength={ 100 } onChange={ event => update({ name: event.target.value }) }/>
                    <label className="form-label mt-2" htmlFor="ticket-view-visibility">Visibility</label><select id="ticket-view-visibility" className="form-select" value={ draft.visibility } onChange={ event => update({ visibility: event.target.value }) }><option value="personal">Personal</option>{ settings.permissions.settings && <option value="shared">Shared</option> }</select>
                </fieldset> }
            </Modal.Body>
            <Modal.Footer className="ticket-view-dialog-actions">
                { deletable && <button type="button" className="btn btn-sm btn-link text-danger me-auto" disabled={ busy } onClick={ remove }>Delete view</button> }
                <button type="button" className="btn btn-sm btn-white" disabled={ busy || !settings } onClick={ apply }>Apply filters</button>
                { draft.id && <button type="button" className="btn btn-sm btn-white" disabled={ busy } onClick={ () => update({ id: undefined, name: `${ draft.name } copy`, visibility: 'personal' }) }>Save a copy</button> }
                <button type="button" className="btn btn-sm btn-link" disabled={ busy } onClick={ onClose }>Cancel</button>
                <button className="btn btn-sm btn-primary" disabled={ busy || !settings }>{ busy ? 'Saving…' : draft.id ? 'Save view' : 'Save new view' }</button>
            </Modal.Footer>
        </form>
    </Modal>;
}
