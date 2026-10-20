import { createContext, useContext, useSyncExternalStore } from 'react';
import { redirect, type AnyRouter, type ParsedLocation } from '@tanstack/react-router';
import { nativeRequest } from './transport';
import { preloadDashboardPage } from './dashboard-page-code';
import { actsOnSessionProject, projectIdFromPath } from './workspace-scope';
import { announceSessionProject } from './session-project-sync';
import { delegationAccount, loadConsent } from './delegation-loader';
import { dashboardBootstrapInput, fetchDashboardBootstrap, type DashboardBootstrapResult, type InitialConversation, type WorkspaceBootstrap } from './dashboard-bootstrap';
import { createInitialInboxReads } from './initial-inbox-reads';
import {createInitialInboxList,type InitialInboxListData} from './initial-inbox-list';
import {installInitialWorkspaceReads,expireInitialWorkspaceReads} from './initial-workspace-reads';

export const DashboardSettingsContext = createContext<any>(null);
export function useDashboardSettings() {
    const settings = useContext(DashboardSettingsContext);
    if (!settings) throw new Error('Dashboard settings require the workspace route');
    return settings;
}

export function useDashboardLocation(): ParsedLocation {
    return useDashboardSettings().dashboardLocation;
}

let sessionVersion = 0;
const listeners = new Set<() => void>();
// These route leaves statically provide their page; TanStack awaits its split
// component. Other paths still need the wildcard page's dynamic code preload.
const directDashboardPagePath = /^\/(?:conversations(?:\/[^/]+)?|projects(?:\/(?!create(?:\/|$))[^/]+\/(?:contacts|companies|articles|macros|agents|reports|settings|conversations(?:\/[^/]+)?))?)\/?$/;
export function useDashboardSessionVersion() {
    return useSyncExternalStore(listener => {
        listeners.add(listener);
        return () => { listeners.delete(listener); };
    }, () => sessionVersion, () => 0);
}

/** Retire authenticated state before loading the new session's workspace. */
export function invalidateDashboardSession(router: AnyRouter) {
    expireInitialWorkspaceReads();
    sessionVersion++;
    delete (window as any).chatSettings;
    listeners.forEach(listener => listener());
    router.clearCache();
}

/** Make `projectId` the session's active project, so project-scoped APIs agree with the URL. */
async function activateProject(projectId: string, signal: AbortSignal) {
    await nativeRequest('/api/identity/switch-project', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId }), signal,
    });
}

export async function loadDashboard({ location, abortController, parentMatchPromise }: {
    location: ParsedLocation; abortController: AbortController;
    parentMatchPromise: Promise<{ loaderData?: WorkspaceBootstrap }>;
}) {
    expireInitialWorkspaceReads();
    const directPage = directDashboardPagePath.test(location.pathname);
    const code = directPage ? undefined : preloadDashboardPage(location.pathname);
    const version = sessionVersion;
    const { signal } = abortController;
    // Connected applications and the consent screen name their workspace in `account_id` instead of the path.
    const urlProjectId = projectIdFromPath(location.pathname) ?? delegationAccount(location);
    const fail = (error: any): never => {
        if (error.status === 401 && version === sessionVersion && !signal.aborted) {
            delete (window as any).chatSettings;
            throw redirect({ to: '/login', search: { returnTo: location.href }, replace: true, ignoreBlocker: true });
        }
        throw error;
    };
    const requireBootstrap = (result: DashboardBootstrapResult) => {
        if ('status' in result) return fail(Object.assign(new Error(result.message), { status: result.status }));
        return result;
    };
    let settings: any;
    let projectUnavailable: string | undefined;
    let initialConversation: InitialConversation | undefined;
    let initialInboxList: InitialInboxListData | undefined;
    let initialTags: {path: string; outcome: Promise<any>} | undefined;
    let initialManagement: {path: string; outcome: Promise<any>} | undefined;
    try {
        const [result] = await Promise.all([
            parentMatchPromise.then(parent => {
                if (!parent.loaderData) throw new Error('The workspace could not be loaded.');
                return parent.loaderData.bootstrap;
            }), code,
        ]);
        signal.throwIfAborted();
        ({ settings, projectUnavailable, initialConversation, initialInboxList, initialTags, initialManagement } = requireBootstrap(result));
        // The URL names the workspace: bind the session to it before any page reads its data.
        if (urlProjectId && !projectUnavailable && settings.sessionProjectId !== urlProjectId) {
            await activateProject(urlProjectId, signal);
            settings = { ...settings, sessionProjectId: urlProjectId };
        }
    } catch (error: any) {
        // A project the account does not belong to (or that does not exist) is a page state, not a failed load.
        if (!urlProjectId || error.status !== 403) fail(error);
        projectUnavailable = urlProjectId;
        initialConversation = undefined;
        initialInboxList = undefined;
        initialTags = undefined;
        initialManagement = undefined;
        // Membership can change between the server read and client activation.
        // Re-read the remaining account exactly as for an unavailable project.
        const input = dashboardBootstrapInput(location);
        const fallback = requireBootstrap(await fetchDashboardBootstrap({
            data: { inbox: input.inbox ? 'global' : undefined }, signal,
        }));
        settings = fallback.settings;
    }
    // A direct inbox route can become a workspace notice, and an account with no
    // workspace renders Projects instead of the direct route's selected page.
    if (!directPage || settings.accountOnly || projectUnavailable) {
        await preloadDashboardPage(location.pathname, { ...settings, projectUnavailable });
    }
    const delegationConsent = await loadConsent(location, signal);
    if(location.pathname==='/projects' && (location.search as Record<string,unknown>).onboarding==='setup' && settings.project?.id){
        throw redirect({to:'/$',params:{_splat:`projects/${settings.project.id}/activation`},search:{},replace:true});
    }
    if (version !== sessionVersion) throw new Error('Your session changed. Reload the workspace.');
    signal.throwIfAborted();
    announceSessionProject(settings.sessionProjectId);
    const search = location.search as Record<string, unknown>;
    // Pages such as /local-agent/authorize have no project in the URL but act on the session's.
    const projectId = projectUnavailable ? undefined : urlProjectId ?? (actsOnSessionProject(location.pathname) ? settings.project?.id : undefined);
    const initialReads: Record<string, any> = {};
    if (!projectUnavailable && urlProjectId && settings.project?.id === urlProjectId && settings.sessionProjectId === urlProjectId) {
        // The scoped bootstrap already read the same account and active project.
        // The unscoped endpoint omits only inbox counts; don't query it twice at mount.
        const {inboxViewCounts, ...bootstrap} = settings;
        initialReads['/api/management/bootstrap'] = {result: bootstrap};
        if (initialTags) initialReads[initialTags.path] = initialTags.outcome;
        if (initialManagement) initialReads[initialManagement.path] = initialManagement.outcome;
    }
    return {
        ...settings, apiUrl: '/api/dashboard', projectId, projectUnavailable, isGlobalInbox: !projectId, sessionVersion: version, delegationConsent,
        initialInboxReads: createInitialInboxReads(initialConversation),
        initialInboxList: createInitialInboxList(initialInboxList, location),
        initialWorkspaceReads: installInitialWorkspaceReads(initialReads, location, version),
        dashboardLocation: { ...location, search: { ...search, ...(search.q == null ? {} : { q: String(search.q) }) } },
    };
}

// The splat leaf supplies pathname identity; explicit search deps distinguish
// concurrent query navigations. Blocking reloads retain the completed workspace.
export const dashboardLoaderOptions = {
    ssr: false as const,
    loader: { handler: loadDashboard, staleReloadMode: 'blocking' as const },
    loaderDeps: ({ search }: { search: Record<string, unknown> }) => search,
    shouldReload: true,
    staleTime: 0,
    gcTime: 0,
    pendingMs: Infinity,
    pendingMinMs: 0,
};
