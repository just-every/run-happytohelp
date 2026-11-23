import { useCallback, useEffect, useRef, useState } from 'react';

const desktopQuery = '(min-width: 1280px)';

const isDesktop = () => typeof window !== 'undefined' && window.matchMedia(desktopQuery).matches;

export default function useConversationAssistant() {
    const [ visibleMode, setVisibleMode ] = useState(() => isDesktop() ? 'desktop' : null);
    const isVisible = visibleMode !== null;
    const toggleRef = useRef(null);
    const closeRef = useRef(null);
    const panelRef = useRef(null);
    const openedFromToggle = useRef(false);
    const returnFocusRef = useRef(null);
    // The tab (and, on Ticket, the section) the panel was last asked to show; the version repeats a request.
    const [ request, setRequest ] = useState({ tab: 'ai', section: null, version: 0 });

    const close = useCallback(() => {
        setVisibleMode(null);
        returnFocusRef.current?.focus();
    }, []);

    // Draft handoff leaves the permanent column in place and closes only the
    // compact sheet. The composer owns the next focus, not the panel toggle.
    const releaseDraft = useCallback(() => {
        openedFromToggle.current = false;
        setVisibleMode(mode => mode === 'compact' ? null : mode);
    }, []);

    const toggle = useCallback(() => {
        const mode = isDesktop() ? 'desktop' : 'compact';
        if (visibleMode === mode) {
            close();
            return;
        }

        setRequest(current => ({ tab: 'ai', section: null, version: current.version + 1 }));
        returnFocusRef.current = toggleRef.current;
        openedFromToggle.current = true;
        setVisibleMode(mode);
    }, [ close, visibleMode ]);

    // Opens the panel (an overlay below 1280 px) on a tab and expands one of its sections, which takes focus.
    // Closing a compact overlay returns focus to the control that asked (the menu toggle it came from), or to the
    // panel toggle when the request came from a closing dialog.
    const openPanel = useCallback((tab, section = null) => {
        const active = document.activeElement;
        const asker = active && active !== document.body && !active.closest?.('.modal') ? active : null;
        returnFocusRef.current = asker?.closest?.('.dropdown-menu')?.parentElement?.querySelector('.dropdown-toggle') || asker || toggleRef.current;
        openedFromToggle.current = false;
        setRequest(current => ({ tab, section, version: current.version + 1 }));
        setVisibleMode(isDesktop() ? 'desktop' : 'compact');
    }, []);

    useEffect(() => {
        const mediaQuery = window.matchMedia(desktopQuery);
        const syncViewport = () => {
            // Only an explicit action in the compact viewport can open the sheet.
            setVisibleMode(mediaQuery.matches ? 'desktop' : null);
        };

        mediaQuery.addEventListener('change', syncViewport);
        syncViewport();
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
        isCompactOpen: visibleMode === 'compact',
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
