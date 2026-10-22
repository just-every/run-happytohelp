import React, { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Modal } from 'react-bootstrap';
import useLiveInboxLocation from '../dashboard/hooks/useLiveInboxLocation';
import formatCompactCount from '../dashboard/utils/formatCompactCount';
import { INBOX_VIEWS, inboxPlace } from '../dashboard/components/inboxViewDefinitions';
import { ticketPath } from '../dashboard/components/tickets/ticket-model';
import { useMobileNavigation } from './MobileNavigation';
import { inboxSource, useInboxNavigation, useInboxNavigationActions } from './inbox-navigation-state';
import { nativeRequest } from './transport';

const RAIL_SAVED_VIEWS = 5;
// The router marks a link current when its search is a subset of the page's; this group decides which row is current
// itself (its `is-current` row), so a link only matches its exact destination.
const exact = { exact: true };

/** Personal views, then shared ones, each in the API's name order. */
export function orderedSavedViews(views) {
    return [ ...views.filter(view => view.visibility === 'personal'), ...views.filter(view => view.visibility === 'shared') ];
}

/** Up to five usable views, always including the current one. */
function railSavedViews(views, currentId) {
    const usable = orderedSavedViews(views).filter(view => !view.unavailable);
    const listed = usable.slice(0, RAIL_SAVED_VIEWS);
    const current = usable.find(view => view.id === currentId);
    return current && !listed.includes(current) ? [ ...listed.slice(0, RAIL_SAVED_VIEWS - 1), current ] : listed;
}

/** A count disc, shown only above zero, in the compact form ("1k"). */
export function CountDisc({ count }) {
    return count > 0 ? <span className="navbar-unread-count" data-testid="count-disc" title={ String(count) }>{ formatCompactCount(count) }</span> : null;
}

/**
 * Inbox's group in the rail (and, below 1200px, in the menu sheet): the five views, up to five saved views then
 * "All views…", Snoozed while any ticket sleeps and Suspended while mail is held for a member who may review it. Saved
 * views, Snoozed and Suspended belong to workspace inboxes outside the demo, as the list's ticket tools do. On the inbox
 * a row keeps the open conversation and the list's search; elsewhere it opens the inbox on that view.
 */
export default function InboxNavigation({ id, settings, inboxActive, open }) {
    const { pathname, search } = useLiveInboxLocation();
    const projectId = settings.isGlobalInbox ? null : settings.project?.id;
    const queue = Boolean(projectId) && !settings.project?.is_demo;
    const source = inboxSource(settings.isGlobalInbox, projectId);
    const { counts, version, savedViews, savedViewsError } = useInboxNavigation(source);
    const { publishSavedViews, viewChosen } = useInboxNavigationActions();
    const { setOpen } = useMobileNavigation();
    const [ allViews, setAllViews ] = useState(false);

    // Read again whenever the workspace's inbox data changes: saving or deleting a view calls refreshInboxData().
    useEffect(() => {
        if (!queue) return;
        const controller = new AbortController();
        nativeRequest(`${ ticketPath(projectId) }/ticket-views`, { signal: controller.signal })
            .then(result => publishSavedViews(source, result.data))
            .catch(error => { if (!controller.signal.aborted) publishSavedViews(source, null, error.message); });
        return () => controller.abort();
    }, [ queue, projectId, source, version, publishSavedViews ]);

    const to = inboxActive ? pathname : projectId ? `/projects/${ projectId }/conversations` : '/conversations';
    const keep = inboxActive ? search : {};
    const place = inboxActive ? inboxPlace(search, counts, queue) : null;
    // Leaving the Snoozed place drops it; "Include snoozed" stays with the list like its other filters.
    const snoozed = keep.snoozed === 'only' ? undefined : keep.snoozed;
    const choose = () => { setOpen(false); viewChosen(); };
    const row = (key, { label, search: next, current, count, icon }) => <li key={ key }>
        <Link className={ `nav-link${ icon ? ' nav-inbox-place' : '' }${ current ? ' is-current' : '' }` } aria-current={ current ? 'page' : undefined } activeOptions={ exact } to={ to } search={ next } onClick={ choose }>
            { icon && <i className={ `fe fe-${ icon }` } aria-hidden="true"/> }<span className="navbar-link-label">{ label }</span><CountDisc count={ count }/>
        </Link>
    </li>;
    const savedSearch = view => ({ ...keep, view: undefined, assigned_to: undefined, filters: undefined, sort: undefined, snoozed, saved_view: view.id });
    const views = queue && savedViews ? savedViews : [];
    const listed = railSavedViews(views, place?.kind === 'saved' ? place.id : null);
    const showSnoozed = queue && (counts.snoozed > 0 || place?.kind === 'snoozed');
    const showSuspended = queue && settings.project?.access?.permissions?.includes('conversations.manage') && counts.suspended > 0;

    return <nav id={ id } className="nav-inbox-group" data-testid="inbox-views" aria-label="Inbox views" hidden={ !open }>
        <ul>
            { INBOX_VIEWS.map(view => row(view.id, {
                label: view.label,
                count: view.disc ? counts[view.id] : 0,
                current: place?.kind === 'view' && place.id === view.id,
                search: { ...keep, saved_view: undefined, filters: undefined, sort: undefined, snoozed, view: view.id, assigned_to: view.id === 'mine' || view.id === 'unassigned' ? undefined : keep.assigned_to },
            })) }
        </ul>
        { views.length > 0 && <>
            <p className="nav-inbox-caption" id={ `${ id }-saved` }>Saved views</p>
            <ul aria-labelledby={ `${ id }-saved` }>
                { listed.map(view => row(view.id, { label: view.name, current: place?.kind === 'saved' && place.id === view.id, search: savedSearch(view) })) }
                { listed.length < views.length && <li><button type="button" className="nav-link" onClick={ () => setAllViews(true) }>All views…</button></li> }
            </ul>
        </> }
        { queue && savedViewsError && <p className="nav-inbox-note" role="alert">Saved views could not load: { savedViewsError }</p> }
        { (showSnoozed || showSuspended) && <ul>
            { showSnoozed && row('snoozed', {
                label: 'Snoozed', icon: 'clock', count: counts.snoozed, current: place?.kind === 'snoozed',
                search: { ...keep, view: undefined, saved_view: undefined, filters: undefined, sort: undefined, assigned_to: undefined, snoozed: 'only' },
            }) }
            { /* Held mail is reviewed on Settings › Suspended email, which stays the current row there. */ }
            { showSuspended && <li><Link className="nav-link nav-inbox-place" to={ `/projects/${ projectId }/suspended` }>
                <i className="fe fe-pause-circle" aria-hidden="true"/><span className="navbar-link-label">Suspended</span><CountDisc count={ counts.suspended }/>
            </Link></li> }
        </ul> }
        { allViews && <Modal show onHide={ () => setAllViews(false) } className="inbox-all-views" aria-labelledby={ `${ id }-all` }>
            <Modal.Header closeButton><Modal.Title id={ `${ id }-all` }>Saved views</Modal.Title></Modal.Header>
            <Modal.Body>
                { [ [ 'personal', 'Personal' ], [ 'shared', 'Shared' ] ].map(([ visibility, title ]) => {
                    const group = orderedSavedViews(views).filter(view => view.visibility === visibility);
                    return group.length > 0 && <section key={ visibility } aria-labelledby={ `${ id }-all-${ visibility }` }>
                        <h3 id={ `${ id }-all-${ visibility }` }>{ title }</h3>
                        <ul>{ group.map(view => <li key={ view.id }>{ view.unavailable
                            ? <span className="inbox-all-views-unavailable">{ view.name } (restricted or unavailable field)</span>
                            : <Link to={ to } search={ savedSearch(view) } activeOptions={ exact } aria-current={ place?.kind === 'saved' && place.id === view.id ? 'page' : undefined } onClick={ () => { setAllViews(false); choose(); } }>{ view.name }</Link> }</li>) }</ul>
                    </section>;
                }) }
            </Modal.Body>
        </Modal> }
    </nav>;
}
