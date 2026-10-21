import './first-run.css';
import React, { useEffect, useRef } from 'react';
import { Outlet } from '@tanstack/react-router';
import { useDashboardSettings, useDashboardLocation } from './dashboard-state';
import { isInboxPath, workspaceScopeKey } from './workspace-scope';
import { useSessionProjectGuard } from './session-project-sync';
import { InboxPage, WorkspacePages } from './dashboard-page-code';
import Navigation from './Navigation';
import { NavigationGuard } from './NavigationGuard';
import { MobileNavigationProvider } from './MobileNavigation';
import { InboxNavigationProvider } from './inbox-navigation-state';
import DemoWorkspaceBanner from './demo/DemoWorkspaceBanner';
import WorkspaceLiveCounts from './WorkspaceLiveCounts';
export default function DashboardClient({ settings }) {
    const pathname = useDashboardLocation().pathname;
    const isInbox = isInboxPath(pathname, settings);
    useSessionProjectGuard(settings.projectId);
    const initialReadMount = useRef(null);
    useEffect(() => {
        const initial = settings.initialWorkspaceReads;
        if (!initial) return;
        const mount = {};
        initialReadMount.current = mount;
        const timer = setTimeout(() => initial.expire(), 0);
        return () => {
            clearTimeout(timer);
            queueMicrotask(() => {
                // A StrictMode replacement installs its lease synchronously.
                if (initialReadMount.current === mount) initial.expire();
            });
        };
    }, [settings.initialWorkspaceReads]);
    useEffect(() => {
        document.body.className = `${isInbox ? 'conversation-workspace' : 'workspace-page'} workspace-themed`;
    }, [isInbox]);
    // The workspace chrome is always paper, ink and aqua; the workspace's own colour belongs to its widget and help centre.
    // Dark display mode swaps the brand tokens (brand-tokens.css); Light and Balanced both render the light tokens.
    useEffect(() => {
        const apply = appearance => { document.body.dataset.theme = appearance?.display_mode === 'dark' ? 'dark' : 'light'; };
        apply(settings.isGlobalInbox ? {} : settings.project);
        const update = event => apply(event.detail);
        window.addEventListener('workspace-appearance',update);
        return () => { window.removeEventListener('workspace-appearance',update); delete document.body.dataset.theme; };
    }, [settings]);
    return <NavigationGuard><MobileNavigationProvider><InboxNavigationProvider>
        <a className="workspace-skip-link" href="#workspace-main">Skip to main content</a>
        <Navigation settings={settings} />
        {/* The inbox holds these connections itself, with its listing. */}
        {!isInbox && <WorkspaceLiveCounts key={workspaceScopeKey(settings)} settings={settings} />}
        <main id="workspace-main" tabIndex={-1}>
            <DemoWorkspaceBanner settings={settings} />
            <Outlet />
        </main>
    </InboxNavigationProvider></MobileNavigationProvider></NavigationGuard>;
}

export function DashboardContent({ Inbox = InboxPage, Workspace = WorkspacePages, Conversation }) {
    const settings = useDashboardSettings();
    const pathname = useDashboardLocation().pathname;
    const isInbox = isInboxPath(pathname, settings);
    return isInbox
        ? <Inbox settings={settings} Conversation={Conversation} />
        : <Workspace settings={settings} />;
}
