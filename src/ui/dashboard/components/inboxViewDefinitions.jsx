// `label` is what the rail and the list title show; `phrase` is how the view reads inside a sentence (empty messages).
// Only the views flagged `disc` carry a count in the rail: the ones where a number above zero asks for attention.
// "With AI" sits under Inbox in the same rail as the AI page.
export const INBOX_VIEWS = [
    { id: 'mine', label: 'Yours', phrase: 'your inbox', disc: true, filter: { status: 'unresolved', assigned_to: 'myself' } },
    { id: 'open', label: 'Open', phrase: 'all open', filter: { status: 'unresolved', assigned_to: 'anyone' } },
    { id: 'unassigned', label: 'Unassigned', phrase: 'unassigned', disc: true, filter: { status: 'unresolved', assigned_to: 'none' } },
    { id: 'ai', label: 'With AI', phrase: 'AI conversations', filter: { status: 'ai', assigned_to: 'anyone' } },
    { id: 'closed', label: 'Closed', phrase: 'closed', filter: { status: 'resolved', assigned_to: 'anyone' } },
];

export function defaultInboxView(inboxViewCounts) {
    return inboxViewCounts?.mine > 0 ? 'mine' : 'open';
}

export function normalizeInboxView(view, inboxViewCounts) {
    return INBOX_VIEWS.some(item => item.id === view) ? view : defaultInboxView(inboxViewCounts);
}

export function getInboxView(view) {
    return INBOX_VIEWS.find(item => item.id === normalizeInboxView(view));
}

export function inboxViewPhrase(view) {
    return getInboxView(view).phrase;
}

/**
 * Where the list is, for the rail's current row and the list title: a saved view, the Snoozed place or one of the five
 * views. Saved views and Snoozed belong to workspace inboxes outside the demo (`queue`). The Snoozed place is
 * `?snoozed=only` with no view of its own and lists every open snoozed conversation, as its count does; "Snoozed only"
 * chosen in Filters beside a view narrows that view instead. `view` is the view whose filter the list applies.
 */
export function inboxPlace(search, inboxViewCounts, queue) {
    const view = normalizeInboxView(search.view, inboxViewCounts);
    if (queue && search.saved_view) return { kind: 'saved', id: String(search.saved_view), view };
    if (queue && search.snoozed === 'only' && !INBOX_VIEWS.some(item => item.id === search.view)) return { kind: 'snoozed', id: 'snoozed', view: 'open' };
    return { kind: 'view', id: view, view };
}

export function inboxViewFilter(view, query = '', assignment, searchScope = 'all') {
    const filter = { ...getInboxView(view).filter };
    if (['anyone', 'myself', 'none'].includes(assignment)) filter.assigned_to = assignment;

    if (query.trim()) {
        filter.q = query.trim();
        filter.search_scope = searchScope === 'view' ? 'view' : 'all';
    }

    return filter;
}

export function inboxViewCountsPath(isGlobalInbox, projectId) {
    return isGlobalInbox
        ? '/conversations/counts'
        : `/projects/${ projectId }/conversations/counts`;
}
