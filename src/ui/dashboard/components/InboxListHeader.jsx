import React, { useEffect, useState } from 'react';
import { useMobileNavigation } from '../../native/MobileNavigation';
import { useInboxNavigationActions } from '../../native/inbox-navigation-state';
import formatCompactCount from '../utils/formatCompactCount';
import { getInboxView } from './inboxViewDefinitions';
import InboxSearch from './InboxSearch';
import InboxFilters, { assignmentLabels } from './InboxFilters';
import { useInboxTags } from './InboxTagFilter';
import { useInboxCompanies } from './InboxCompanyFilter';

/** The filters a chip names; removing a chip clears its keys. */
function activeFilters({ search, place, queue, tags, companies }) {
    const viewAssignment = getInboxView(place.view).filter.assigned_to;
    return [
        place.kind !== 'saved' && assignmentLabels[search.assigned_to] && search.assigned_to !== viewAssignment && { key: 'assigned_to', label: `Assignee: ${ assignmentLabels[search.assigned_to] }` },
        search.tag && { key: 'tag', label: `Tag: ${ tags.find(tag => tag.id === String(search.tag))?.name ?? 'selected tag' }` },
        search.company && { key: 'company', label: `Company: ${ companies.find(company => company.id === String(search.company))?.name ?? 'selected company' }` },
        queue && search.snoozed === 'include' && { key: 'snoozed', label: 'Including snoozed' },
        queue && search.snoozed === 'only' && place.kind !== 'snoozed' && { key: 'snoozed', label: 'Snoozed only' },
        queue && search.filters && place.kind !== 'saved' && { key: 'filters', label: 'Ticket filters', clear: { sort: undefined } },
    ].filter(Boolean);
}

/**
 * The list head: the title names the current view with its count (on a phone it opens the menu sheet at Inbox), then
 * Select tickets, Filters and New ticket (Select and New ticket in workspace inboxes outside the demo, as before), the
 * search field and the active filters as removable chips. `search`, `place` and `counts` describe the list on screen;
 * the field follows the router's live query, and `onChange` applies a patch to the live search.
 */
export default function InboxListHeader({ projectId, companyProjectId, queue, currentAgentId, search, liveQuery, place, counts, savedViews, query, assignment, selecting, onSelecting, onNewTicket, onSearch, onChange }) {
    const tags = useInboxTags(projectId);
    const companies = useInboxCompanies(companyProjectId);
    const { open: sheetOpen, setOpen: setSheetOpen } = useMobileNavigation();
    const { setExpanded, onViewChosen } = useInboxNavigationActions();
    const [ notice, setNotice ] = useState('');
    useEffect(() => onViewChosen(() => setNotice('')), [ onViewChosen ]);

    const savedView = place.kind === 'saved' ? savedViews?.find(view => view.id === place.id) : undefined;
    const title = place.kind === 'saved' ? savedView?.name || 'Saved view' : place.kind === 'snoozed' ? 'Snoozed' : getInboxView(place.id).label;
    const chips = activeFilters({ search, place, queue, tags, companies: companies.companies });
    // The count is the view's own: it shows while the list is exactly that view.
    const count = query || chips.length ? 0 : place.kind === 'view' ? counts[place.id] : place.kind === 'snoozed' ? counts.snoozed : 0;
    const disc = count > 0 && <span className="h2h-count" title={ String(count) }>{ formatCompactCount(count) }</span>;
    const searchScope = search.search_scope === 'view' ? 'view' : 'all';
    // Snoozed beside a view narrows that view, so the view is named; with no view of its own it is the Snoozed place.
    const change = patch => { setNotice(''); onChange('snoozed' in patch && place.kind === 'view' ? { ...patch, view: place.view } : patch); };
    // The sheet opens at Inbox with focus on the current view, so the keyboard continues from where the list is.
    const openViews = () => {
        setExpanded(true); setSheetOpen(true);
        requestAnimationFrame(() => (document.querySelector('#navigation-inbox-views .is-current') ?? document.querySelector('#navigation-inbox-views a'))?.focus());
    };

    return <div className="conversation-inbox-header">
        <div className="inbox-list-head">
            <h2 className="inbox-list-title">
                <span className="inbox-list-title-label d-none d-xl-inline-flex">{ title }{ disc }</span>
                <button type="button" className="inbox-list-title-button d-xl-none" aria-label={ `${ title }, show inbox views` } aria-controls="sidebarCollapse" aria-expanded={ sheetOpen } onClick={ openViews }>
                    <span className="inbox-list-title-text">{ title }</span><i className="fe fe-chevron-down" aria-hidden="true"/>{ disc }
                </button>
            </h2>
            <div className="inbox-list-actions">
                { queue && <button type="button" className="inbox-head-icon" title="Select tickets" aria-label="Select tickets" aria-pressed={ selecting } onClick={ () => { setNotice(''); onSelecting(); } }><i className="fe fe-check-square" aria-hidden="true"/></button> }
                <InboxFilters key={ projectId || 'global' } projectId={ projectId } queue={ queue } currentAgentId={ currentAgentId } assignment={ assignment } assignmentDisabled={ Boolean(query) && searchScope !== 'view' }
                    tags={ tags } companies={ companies } search={ search } savedView={ savedView } onChange={ change } onNotice={ setNotice }/>
                { queue && <button type="button" className="inbox-head-icon" title="New ticket" aria-label="New ticket" onClick={ () => { setNotice(''); onNewTicket(); } }><i className="fe fe-edit" aria-hidden="true"/></button> }
            </div>
        </div>
        <InboxSearch query={ liveQuery } scope={ searchScope } onSearch={ (text, scope) => { setNotice(''); onSearch(text, scope); } } />
        { chips.length > 0 && <ul className="inbox-filter-chips" aria-label="Active filters">
            { chips.map(chip => <li key={ chip.key }>
                <button type="button" className="h2h-chip inbox-filter-chip" aria-label={ `Remove filter ${ chip.label }` } onClick={ () => change({ [chip.key]: undefined, ...chip.clear }) }>
                    { chip.label }<i className="fe fe-x" aria-hidden="true"/>
                </button>
            </li>) }
        </ul> }
        { notice && <p className="inbox-list-notice" role="status">{ notice }</p> }
    </div>;
}
