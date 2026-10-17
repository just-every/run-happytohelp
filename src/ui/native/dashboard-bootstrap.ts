import { createServerFn } from '@tanstack/react-start';
import type { ParsedLocation } from '@tanstack/react-router';
import { delegationAccount } from './delegation-loader';
import { isInboxPath, projectIdFromPath } from './workspace-scope';
import type {InboxListSearch,InitialInboxListData} from './initial-inbox-list';

export type DashboardBootstrapInput = {
    projectId?: string;
    inbox?: 'project' | 'global';
    conversationId?: string;
    inboxSearch?: InboxListSearch;
    managementKind?: 'contacts' | 'macros' | 'agents';
};
export type InitialReadOutcome = { result: any } | {
    error: { status?: number; message: string; data?: any };
};
export type InitialConversation = {
    projectId: string;
    conversationId: string;
    conversation: InitialReadOutcome;
    buckets: InitialReadOutcome;
    connections: InitialReadOutcome;
};
export type DashboardBootstrapResult = {
    settings: any;
    projectUnavailable?: string;
    initialConversation?: InitialConversation;
    initialInboxList?: InitialInboxListData;
    initialTags?: { path: string; outcome: Promise<InitialReadOutcome> };
    initialManagement?: { path: string; outcome: Promise<InitialReadOutcome> };
} | { status: number; message: string };
export type WorkspaceBootstrap = { bootstrap: Promise<DashboardBootstrapResult> };

function validateBootstrapInput(input: DashboardBootstrapInput): DashboardBootstrapInput {
    if (!input || typeof input !== 'object' || Array.isArray(input)
        || Object.keys(input).some(key => !['projectId', 'inbox', 'conversationId', 'inboxSearch', 'managementKind'].includes(key))) {
        throw new Error('Invalid workspace request');
    }
    for (const key of ['projectId', 'conversationId'] as const) {
        const value = input[key];
        if (value !== undefined && (typeof value !== 'string' || !value || value.length > 512 || /[\u0000-\u001f\u007f]/.test(value))) {
            throw new Error('Invalid workspace request');
        }
    }
    if (input.inbox !== undefined && input.inbox !== 'project' && input.inbox !== 'global') throw new Error('Invalid workspace request');
    if ((input.inbox === 'project' || input.conversationId) && !input.projectId) throw new Error('Invalid workspace request');
    if (input.conversationId && input.inbox !== 'project') throw new Error('Invalid workspace request');
    if (input.managementKind !== undefined && (!input.projectId || !['contacts','macros','agents'].includes(input.managementKind))) throw new Error('Invalid workspace request');
    if (input.inboxSearch !== undefined && (!input.inboxSearch || typeof input.inboxSearch !== 'object' || Array.isArray(input.inboxSearch)
        || Object.entries(input.inboxSearch).some(([key,value]) => !['view','q','tag','assigned_to','search_scope','saved_view','filters','sort','snoozed'].includes(key) || value !== undefined && typeof value !== 'string'))) {
        throw new Error('Invalid workspace request');
    }
    return { projectId: input.projectId, inbox: input.inbox, conversationId: input.conversationId, inboxSearch: input.inboxSearch, managementKind: input.managementKind };
}

// Only this handler imports Worker bindings and the native app. Clients receive
// the server-function RPC stub, with a fixed operation and validated scope.
export const fetchDashboardBootstrap = createServerFn({ method: 'GET' })
    .inputValidator(validateBootstrapInput)
    .handler(async ({ data }): Promise<DashboardBootstrapResult> => {
        const { dashboardBootstrap } = await import('../../platform/dashboard-loader.server');
        return dashboardBootstrap(data);
    });

export function dashboardBootstrapInput(location: ParsedLocation): DashboardBootstrapInput {
    const projectId = projectIdFromPath(location.pathname) ?? delegationAccount(location);
    const detail = location.pathname.match(/^\/projects\/[^/]+\/conversations\/([^/]+)\/?$/);
    let conversationId = detail?.[1];
    if (conversationId) {
        try { conversationId = decodeURIComponent(conversationId); } catch { /* Native routing retains malformed segments. */ }
    }
    const inbox = isInboxPath(location.pathname, {}) ? (projectId ? 'project' : 'global') : undefined;
    const search = location.search as Record<string,unknown>;
    const inboxSearch: InboxListSearch = {
        view: typeof search.view === 'string' ? search.view : undefined,
        q: search.q == null ? undefined : String(search.q),
        tag: search.tag ? String(search.tag) : undefined,
        assigned_to: typeof search.assigned_to === 'string' ? search.assigned_to : undefined,
        search_scope: typeof search.search_scope === 'string' ? search.search_scope : undefined,
        snoozed: search.snoozed === 'only' || search.snoozed === 'include' ? search.snoozed : undefined,
        saved_view: typeof search.saved_view === 'string' ? search.saved_view : undefined,
        filters: typeof search.filters === 'string' ? search.filters : undefined,
        sort: typeof search.sort === 'string' ? search.sort : undefined,
    };
    const managementKind = location.pathname.match(/^\/projects\/[^/]+\/(contacts|macros|agents)\/?$/)?.[1] as DashboardBootstrapInput['managementKind'];
    return { projectId, inbox, conversationId: projectId && inbox === 'project' ? conversationId : undefined, managementKind,
        inboxSearch: inbox ? inboxSearch : undefined };
}

/** Return the promise as data so Start can stream the document and page assets
 * while native authentication and workspace reads are still in progress. */
export function loadWorkspaceBootstrap({ location, abortController }: {
    location: ParsedLocation; abortController: AbortController;
}): WorkspaceBootstrap {
    return { bootstrap: fetchDashboardBootstrap({ data: dashboardBootstrapInput(location), signal: abortController.signal }) };
}
