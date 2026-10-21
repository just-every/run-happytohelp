import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

// The rail's Inbox group lives in the shell, beside the page rather than inside it. Whichever page holds the workspace's
// live counts (the inbox's ChatContext, or WorkspaceLiveCounts on every other page, both through useInboxRefresh)
// publishes its view counts and data version here, keyed by workspace (`global` or `project:<id>`). The group reads the
// saved views on that version and shares them with the list head, which names the current one. The phone's list title
// opens the group, and a view chosen from the menu sheet is announced so a phone showing a conversation returns to its list.
const InboxNavigationState = createContext(null);
const InboxNavigationActions = createContext(null);

export function InboxNavigationProvider({ children }) {
    const [ published, setPublished ] = useState({ source: null, counts: {}, version: 0 });
    const [ saved, setSaved ] = useState({ source: null, views: null, error: '' });
    // `null` follows the page: open on the inbox. A choice (the chevron, or the list title) holds until the next one.
    const [ expanded, setExpanded ] = useState(null);
    const choiceListeners = useRef(new Set());
    const publish = useCallback((source, counts, version) => setPublished(current => current.source === source && current.counts === counts && current.version === version ? current : { source, counts, version }), []);
    const publishSavedViews = useCallback((source, views, error = '') => setSaved({ source, views, error }), []);
    const onViewChosen = useCallback(listener => {
        choiceListeners.current.add(listener);
        return () => { choiceListeners.current.delete(listener); };
    }, []);
    const viewChosen = useCallback(() => choiceListeners.current.forEach(listener => listener()), []);
    const actions = useMemo(() => ({ publish, publishSavedViews, setExpanded, onViewChosen, viewChosen }), [ publish, publishSavedViews, onViewChosen, viewChosen ]);
    const state = useMemo(() => ({ published, saved, expanded }), [ published, saved, expanded ]);
    return <InboxNavigationActions.Provider value={ actions }><InboxNavigationState.Provider value={ state }>{ children }</InboxNavigationState.Provider></InboxNavigationActions.Provider>;
}

function required(value) {
    if (!value) throw new Error('Inbox navigation requires the native shell');
    return value;
}

/** What the group and the list head show for `source`: its counts, data version and saved views (null until read). */
export function useInboxNavigation(source) {
    const { published, saved, expanded } = required(useContext(InboxNavigationState));
    const live = published.source === source, read = saved.source === source;
    return {
        counts: live ? published.counts : {},
        version: live ? published.version : 0,
        savedViews: read ? saved.views : null,
        savedViewsError: read ? saved.error : '',
        expanded,
    };
}

/** Stable actions, so a publisher never re-renders when the group's state changes. */
export function useInboxNavigationActions() {
    return required(useContext(InboxNavigationActions));
}

/** The key the counts and saved views are published under. */
export function inboxSource(isGlobalInbox, projectId) {
    return isGlobalInbox ? 'global' : `project:${ projectId }`;
}
