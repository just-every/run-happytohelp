import {initialInboxListFilter} from './initial-inbox-list';
import type {DashboardBootstrapInput,DashboardBootstrapResult,InitialConversation,InitialReadOutcome} from './dashboard-bootstrap';

export async function readWorkspace(input:DashboardBootstrapInput,read:(path:string)=>Promise<InitialReadOutcome>):Promise<DashboardBootstrapResult> {
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
            sort:kind === 'contacts' ? 'last_seen_at' : 'title',direction:kind === 'contacts' ? 'desc' : 'asc',...(kind === 'contacts'?{visitors:'hide',total:'none'}:{})});
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
    if ('error' in result) return { status: result.error.status ?? 500, message: result.error.message,
        ...(result.error.retryAfter ? { retryAfter: result.error.retryAfter } : {}) };
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
