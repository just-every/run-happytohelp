import React, { useEffect, useRef, useState } from 'react';
import { nativeRequest } from '../../native/transport';
import { ticketPath } from './tickets/ticket-model';
import TicketViews, { canEditView } from './tickets/TicketViews';
import InboxTagFilter from './InboxTagFilter';
import InboxCompanyFilter from './InboxCompanyFilter';
import WorkflowQueueFilter from './workflows/WorkflowQueueFilter';

export const assignmentLabels = { anyone: 'Anyone', myself: 'Me', none: 'Unassigned' };

/**
 * The list head's Filters: Assignee (for combinations such as Closed and mine), Tags and Company where the workspace has
 * them, and in workspace inboxes Snoozed, "Save as view…" and "Edit view…". A popover under its sliders button: each
 * change applies at once, and it stays open until Escape or a click elsewhere. Keyed by workspace.
 */
export default function InboxFilters({ projectId, queue, currentAgentId, assignment, assignmentDisabled, tags, companies, search, savedView, onChange, onNotice }) {
    const [ open, setOpen ] = useState(false), [ dialog, setDialog ] = useState(null);
    const [ ticketSettings, setTicketSettings ] = useState(null), [ settingsError, setSettingsError ] = useState('');
    const panel = useRef(null), toggle = useRef(null);

    useEffect(() => {
        if (!open) return;
        const close = event => {
            if (event.type === 'keydown') {
                if (event.key !== 'Escape') return;
                event.preventDefault(); setOpen(false); toggle.current?.focus();
            } else if (!panel.current?.contains(event.target) && !toggle.current?.contains(event.target)) setOpen(false);
        };
        document.addEventListener('click', close); document.addEventListener('keydown', close);
        panel.current?.focus();
        return () => { document.removeEventListener('click', close); document.removeEventListener('keydown', close); };
    }, [ open ]);

    // The views need the workspace's ticket fields and whether this member may change shared views: read once, when first opened.
    useEffect(() => {
        if (!queue || ticketSettings || !(open || dialog)) return;
        const controller = new AbortController();
        setSettingsError('');
        nativeRequest(`${ ticketPath(projectId) }/ticket-settings`, { signal: controller.signal })
            .then(result => setTicketSettings(result.data))
            .catch(error => { if (!controller.signal.aborted) setSettingsError(error.message); });
        return () => controller.abort();
    }, [ queue, projectId, open, dialog, ticketSettings ]);

    const editable = savedView && !savedView.unavailable && ticketSettings && canEditView(savedView, ticketSettings.permissions, currentAgentId);
    const openDialog = mode => { setOpen(false); setDialog(mode); };

    return <div className="inbox-filters">
        <button ref={ toggle } type="button" className="inbox-head-icon" title="Filters" aria-label="Filters" aria-expanded={ open } aria-controls="inbox-filters-panel" onClick={ () => { if (!open) onNotice(''); setOpen(!open); } }>
            <i className="fe fe-sliders" aria-hidden="true"/>
        </button>
        { open && <div ref={ panel } id="inbox-filters-panel" className="inbox-filters-panel" role="dialog" aria-label="Filters" tabIndex={ -1 }>
            <div className="inbox-filter-field">
                <label className="form-label" htmlFor="inbox-filter-assignment">Assignee</label>
                <select id="inbox-filter-assignment" className="form-select" aria-label="Filter conversations by assignment" value={ assignment } disabled={ assignmentDisabled } onChange={ event => onChange({ saved_view: undefined, filters: undefined, sort: undefined, assigned_to: event.target.value }) }>
                    { Object.entries(assignmentLabels).map(([ value, label ]) => <option key={ value } value={ value }>{ label }</option>) }
                </select>
            </div>
            <InboxTagFilter tags={ tags } value={ String(search.tag || '') } onChange={ tag => onChange({ tag: tag || undefined }) }/>
            <InboxCompanyFilter companies={ companies.companies } error={ companies.error } value={ String(search.company || '') } onChange={ company => onChange({ company: company || undefined }) }/>
            { queue && <>
                <WorkflowQueueFilter value={ search.snoozed } onChange={ snoozed => onChange({ snoozed: snoozed || undefined }) }/>
                <div className="inbox-filters-views">
                    <button type="button" className="btn btn-sm btn-white" onClick={ () => openDialog('save') }>Save as view…</button>
                    { editable && <button type="button" className="btn btn-sm btn-white" onClick={ () => openDialog('edit') }>Edit view…</button> }
                </div>
                { settingsError && <p role="alert">{ settingsError }</p> }
            </> }
        </div> }
        { dialog && <TicketViews projectId={ projectId } currentAgentId={ currentAgentId } view={ savedView } editing={ dialog === 'edit' } settings={ ticketSettings } tags={ tags } onNotice={ onNotice } onClose={ () => { setDialog(null); toggle.current?.focus(); } }/> }
    </div>;
}
