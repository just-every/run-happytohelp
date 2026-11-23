import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, type ReactNode } from 'react';
import { useBlocker } from '@tanstack/react-router';
import { isInboxPath, projectIdFromPath } from './workspace-scope';

type Guard = { confirmNavigation: () => boolean; setDirty: (id: string, dirty: boolean, inboxDraft?: boolean) => void };
const GuardContext = createContext<Guard | null>(null);

/** One guard covers route changes and session-changing navigation commands. */
export function NavigationGuard({ children }: { children: ReactNode }) {
    const drafts = useRef(new Map<string, boolean>());
    const setDirty = useCallback((id: string, dirty: boolean, inboxDraft = false) => {
        if (dirty) drafts.current.set(id, inboxDraft);
        else drafts.current.delete(id);
    }, []);
    const confirm = useCallback((preserveInboxDraft = false) => {
        if (![...drafts.current.values()].some(inboxDraft => !preserveInboxDraft || !inboxDraft)) return true;
        if (!window.confirm('Discard unsaved changes and leave this page?')) return false;
        // The editor clears its registration on save/unmount. A failed navigation
        // or session request must leave the existing draft protected.
        return true;
    }, []);
    const confirmNavigation = useCallback(() => confirm(), [confirm]);
    useBlocker({
        shouldBlockFn: ({ current, next }) => {
            if (current.pathname === next.pathname) return false;
            // Reply drafts are saved in the tab per conversation. Other editors
            // still need confirmation, including when leaving this inbox.
            const sameInbox = isInboxPath(current.pathname, {}) && isInboxPath(next.pathname, {})
                && projectIdFromPath(current.pathname) === projectIdFromPath(next.pathname);
            return !confirm(sameInbox);
        },
        enableBeforeUnload: () => drafts.current.size > 0,
    });
    const guard = useMemo(() => ({ confirmNavigation, setDirty }), [confirmNavigation, setDirty]);
    return <GuardContext.Provider value={guard}>{children}</GuardContext.Provider>;
}

export function useNavigationGuard() {
    const guard = useContext(GuardContext);
    if (!guard) throw new Error('Dashboard forms must be inside NavigationGuard');
    return guard;
}

export function useUnsavedChanges(inboxDraft = false) {
    const { setDirty } = useNavigationGuard();
    const id = useId();
    useEffect(() => () => setDirty(id, false), [id, setDirty]);
    return useMemo(() => ({
        markDirty: () => setDirty(id, true, inboxDraft),
        markSaved: () => setDirty(id, false),
        setDirty: (dirty: boolean) => setDirty(id, dirty, inboxDraft),
    }), [id, inboxDraft, setDirty]);
}
