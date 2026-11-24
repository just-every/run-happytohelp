import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, type ReactNode } from 'react';
import { useBlocker } from '@tanstack/react-router';
import { isInboxPath, projectIdFromPath } from './workspace-scope';

type Discard = () => boolean | Promise<boolean>;
type DirtyEditor = { inboxDraft: boolean; discard?: Discard };
type Guard = { confirmNavigation: Discard; setDirty: (id: string, editor?: DirtyEditor) => void };
const GuardContext = createContext<Guard | null>(null);

/** One guard covers route changes and session-changing navigation commands. */
export function NavigationGuard({ children }: { children: ReactNode }) {
    const drafts = useRef(new Map<string, DirtyEditor>());
    const setDirty = useCallback((id: string, editor?: DirtyEditor) => {
        if (editor) drafts.current.set(id, editor);
        else drafts.current.delete(id);
    }, []);
    const confirm = useCallback((preserveInboxDraft = false) => {
        const editors = [...drafts.current.values()].filter(editor => !preserveInboxDraft || !editor.inboxDraft);
        if (!editors.length) return true;
        if (!window.confirm('Discard unsaved changes and leave this page?')) return false;
        const discards = editors.flatMap(editor => editor.discard ? [editor.discard] : []);
        if (discards.length) return Promise.all(discards.map(discard => discard())).then(results => results.every(Boolean));
        return true;
    }, []);
    const confirmNavigation = useCallback(() => confirm(), [confirm]);
    useBlocker({
        shouldBlockFn: async ({ current, next }) => {
            if (current.pathname === next.pathname) return false;
            // Reply drafts are saved in the tab per conversation. Other editors
            // still need confirmation, including when leaving this inbox.
            const sameInbox = isInboxPath(current.pathname, {}) && isInboxPath(next.pathname, {})
                && projectIdFromPath(current.pathname) === projectIdFromPath(next.pathname);
            return !await confirm(sameInbox);
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

export function useUnsavedChanges(inboxDraft = false, discard?: Discard) {
    const { setDirty } = useNavigationGuard();
    const id = useId();
    const discardRef = useRef(discard);
    discardRef.current = discard;
    const hasDiscard = Boolean(discard);
    const editor = useMemo(() => ({ inboxDraft, discard: hasDiscard ? () => discardRef.current?.() ?? true : undefined }), [inboxDraft, hasDiscard]);
    useEffect(() => () => setDirty(id), [id, setDirty]);
    return useMemo(() => ({
        markDirty: () => setDirty(id, editor),
        markSaved: () => setDirty(id),
        setDirty: (dirty: boolean) => setDirty(id, dirty ? editor : undefined),
    }), [id, editor, setDirty]);
}
