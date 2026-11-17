/**
 * Which project a dashboard URL names, and what kind of page it is.
 *
 * The URL is the only place the active workspace is chosen. The loader
 * (`dashboard-state.tsx`) activates that project in the session before any
 * workspace data loads; the shell and pages read the result from the loader.
 */

/** Dashboard pages outside `/projects/<id>` that act on the session's active project. */
const sessionProjectPaths = new Set(['/local-agent/authorize']);

/** The project id in `/projects/<id>/...`, or undefined for `/projects`, `/projects/create` and non-project paths. */
export function projectIdFromPath(pathname: string): string | undefined {
    const segment = pathname.match(/^\/projects\/([^/]+)/)?.[1];
    if (!segment || segment === 'create') return undefined;
    try { return decodeURIComponent(segment); } catch { return segment; }
}

/** True for pages that act on the session's active project although the URL does not name it. */
export function actsOnSessionProject(pathname: string): boolean {
    return pathname.startsWith('/users/') || sessionProjectPaths.has(pathname.replace(/\/+$/, ''));
}

/** The inbox renders for `/`, `/conversations...` and `/projects/<id>/conversations...`, except when the project is unavailable. */
export function isInboxPath(pathname: string, settings: { accountOnly?: boolean; projectUnavailable?: string }): boolean {
    if (settings.accountOnly || settings.projectUnavailable) return false;
    return pathname === '/' || pathname.startsWith('/conversations') || /\/conversations(?:\/|$)/.test(pathname);
}

/** Live inbox state belongs to one session, agent and workspace scope; a change remounts it. */
export function workspaceScopeKey(settings: { sessionVersion?: unknown; currentAgent?: { id?: string }; isGlobalInbox?: boolean; projectId?: string; project?: { id?: string } }): string {
    return `${settings.sessionVersion}:${settings.currentAgent?.id}:${settings.isGlobalInbox ? 'global' : settings.projectId}:${settings.project?.id}`;
}
