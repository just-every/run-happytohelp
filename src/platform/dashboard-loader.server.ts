import { env } from 'cloudflare:workers';
import { getRequest, setResponseHeader } from '@tanstack/react-start/server';
import { app } from '../app';
import type { Env } from './env';
import {initialInboxListFilter} from '../ui/native/initial-inbox-list';
import type { DashboardBootstrapInput, DashboardBootstrapResult, InitialConversation, InitialReadOutcome } from '../ui/native/dashboard-bootstrap';

/** Fixed native reads under the caller's real origin and credentials. No
 * internal response cookie is forwarded, and no workspace switch runs here. */
export async function dashboardBootstrap(input: DashboardBootstrapInput): Promise<DashboardBootstrapResult> {
    const request = getRequest();
    let bindings = env as unknown as Env;
    if (import.meta.env.DEV && import.meta.env.RER_LOCAL_ORIGIN && bindings.H2H_LOCAL === 'true' && !bindings.RER_INSTALLATION_ID) {
        bindings = { ...bindings, APP_ORIGIN: import.meta.env.RER_LOCAL_ORIGIN };
    }
    setResponseHeader('Cache-Control', 'no-store');

    const read = async (path: string): Promise<InitialReadOutcome> => {
        try {
            const response = await app.fetch(new Request(new URL(path, request.url), {
                headers: request.headers, signal: request.signal,
            }), bindings);
            const body = await response.json() as any;
            if (response.ok) return { result: body };
            const retryAfter = Number(response.headers.get('Retry-After'));
            return { error: {
                status: response.status,
                message: body.error?.message || body.error || `Request failed (${response.status})`,
                data: body,
                ...(retryAfter > 0 ? { retryAfter } : {}),
            } };
        } catch (error) {
            return { error: { message: error instanceof Error ? error.message : String(error) } };
        }
    };
    const bootstrap = (projectId?: string) => {
        const query = new URLSearchParams();
        if (projectId) query.set('projectId', projectId);
        if (input.inbox) query.set('inbox', projectId ? 'project' : 'global');
        return read('/api/management/bootstrap' + (query.size ? `?${query}` : ''));
    };

    const tagPath = input.inbox === 'project' && input.projectId
        ? `/api/dashboard/projects/${encodeURIComponent(input.projectId)}/tags` : undefined;
    const initialTags = tagPath ? {path: tagPath, outcome: read(tagPath)} : undefined;
    const initialManagement = input.managementKind && input.projectId ? (() => {
        const kind = input.managementKind;
        const query = kind === 'agents' ? '' : '?' + new URLSearchParams({search:'',page:'1',
            sort:kind === 'contacts' ? 'last_seen_at' : 'title',direction:kind === 'contacts' ? 'desc' : 'asc'});
        return {path:`/api/management/projects/${input.projectId}/${kind}${query}`,
            outcome:read(`/api/management/projects/${encodeURIComponent(input.projectId!)}/${kind}${query}`)};
    })() : undefined;

    // Each optional read settles into an outcome immediately. A missing record
    // or a failed resource retains that component's existing error and retry.
    let initialConversation: Promise<InitialConversation> | undefined;
    if (input.projectId && input.conversationId) {
        const projectId = input.projectId, conversationId = input.conversationId;
        const base = `/api/dashboard/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}`;
        initialConversation = Promise.all([
            read(base),
            read(base + '/buckets?newest_with_messages=1'),
            read('/api/delegation/connections?projectId=' + encodeURIComponent(projectId)),
        ]).then(([conversation, buckets, connections]) => ({ projectId, conversationId, conversation, buckets, connections }));
    }

    let result = await bootstrap(input.projectId);
    if ('result' in result && input.projectId && result.result.accountOnly) {
        result = { error: { status: 403, message: 'No access' } };
    }
    let projectUnavailable: string | undefined;
    if ('error' in result && result.error.status === 403 && input.projectId) {
        projectUnavailable = input.projectId;
        result = await bootstrap();
    }
    if ('error' in result) return { status: result.error.status ?? 500, message: result.error.message };
    // Start the selected first page as soon as fresh counts choose its view.
    // Keep the outcome nested so streaming settings never waits for this read.
    const initialInboxList = input.inbox && !projectUnavailable && !result.result.accountOnly ? (() => {
        const projectId = input.inbox === 'project' ? input.projectId : undefined;
        const filter = initialInboxListFilter(input.inboxSearch, result.result.inboxViewCounts);
        const base = projectId ? `/api/dashboard/projects/${encodeURIComponent(projectId)}/conversations` : '/api/dashboard/conversations';
        return {projectId, filter, outcome: read(base + '?' + new URLSearchParams(filter))};
    })() : undefined;
    return {
        settings: result.result,
        initialInboxList,
        ...(!projectUnavailable && !result.result.accountOnly ? {initialTags,initialManagement} : {}),
        projectUnavailable,
        ...(!projectUnavailable && !result.result.accountOnly && initialConversation
            ? { initialConversation: await initialConversation } : {}),
    };
}
