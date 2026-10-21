import { useCallback, useEffect, useRef, useState } from 'react';

const desktopQuery = '(min-width: 1280px)';

const isDesktop = () => typeof window !== 'undefined' && window.matchMedia(desktopQuery).matches;

export default function useConversationAssistant() {
    const [ isVisible, setIsVisible ] = useState(isDesktop);
    const toggleRef = useRef(null);
    const closeRef = useRef(null);
    const panelRef = useRef(null);
    const openedFromToggle = useRef(false);
    const returnFocusRef = useRef(null);
    // The tab (and, on Ticket, the section) the panel was last asked to show; the version repeats a request.
    const [ request, setRequest ] = useState({ tab: 'ai', section: null, version: 0 });

    const close = useCallback(() => {
        setIsVisible(false);
        returnFocusRef.current?.focus();
    }, []);

    // Draft handoff leaves the permanent column in place and closes only the
    // compact sheet. The composer owns the next focus, not the panel toggle.
    const releaseDraft = useCallback(() => {
        openedFromToggle.current = false;
        if (!isDesktop()) setIsVisible(false);
    }, []);

    const toggle = useCallback(() => {
        if (isVisible) {
            close();
            return;
        }

        setRequest(current => ({ tab: 'ai', section: null, version: current.version + 1 }));
        returnFocusRef.current = toggleRef.current;
        openedFromToggle.current = true;
        setIsVisible(true);
    }, [ close, isVisible ]);

    // Opens the panel (an overlay below 1280 px) on a tab and expands one of its sections, which takes focus.
    // Closing a compact overlay returns focus to the control that asked (the menu toggle it came from), or to the
    // panel toggle when the request came from a closing dialog.
    const openPanel = useCallback((tab, section = null) => {
        const active = document.activeElement;
        const asker = active && active !== document.body && !active.closest?.('.modal') ? active : null;
        returnFocusRef.current = asker?.closest?.('.dropdown-menu')?.parentElement?.querySelector('.dropdown-toggle') || asker || toggleRef.current;
        openedFromToggle.current = false;
        setRequest(current => ({ tab, section, version: current.version + 1 }));
        setIsVisible(true);
    }, []);

    useEffect(() => {
        const mediaQuery = window.matchMedia(desktopQuery);
        const syncViewport = event => {
            // A wide assistant is a permanent workspace column. Returning to a
            // compact viewport closes its sheet until the agent explicitly opens it.
            setIsVisible(event.matches);
        };

        mediaQuery.addEventListener('change', syncViewport);
        return () => mediaQuery.removeEventListener('change', syncViewport);
    }, []);

    useEffect(() => {
        if (!isVisible) return undefined;

        let focusFrame;
        if (openedFromToggle.current) {
            focusFrame = window.requestAnimationFrame(() => {
                closeRef.current?.focus({ preventScroll: true });
            });
        }
        openedFromToggle.current = false;

        const handleKeyDown = event => {
            if (!window.matchMedia('(max-width: 1279.98px)').matches) return;
            if (event.defaultPrevented || document.querySelector('.modal.show, [role="dialog"][aria-modal="true"]')) return;

            if (event.key === 'Escape') {
                if (!document.querySelector('.dropdown-menu.show')) close();
                return;
            }

            if (event.key !== 'Tab') return;

            const controls = [...(panelRef.current?.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]') || [])]
                .filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0);
            const first = controls[0];
            const last = controls[controls.length - 1];

            if (!panelRef.current?.contains(document.activeElement)) {
                event.preventDefault();
                (event.shiftKey ? last : first)?.focus();
            } else if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first?.focus();
            }
        };

        window.addEventListener('keydown', handleKeyDown, true);
        return () => {
            if (focusFrame) window.cancelAnimationFrame(focusFrame);
            window.removeEventListener('keydown', handleKeyDown, true);
        };
    }, [ close, isVisible ]);

    return {
        isVisible,
        requestedTab: request.tab,
        requestedSection: request.section,
        requestedTabVersion: request.version,
        toggle,
        openPanel,
        close,
        releaseDraft,
        toggleRef,
        closeRef,
        panelRef,
    };
}
