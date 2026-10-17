import {inboxViewFilter,normalizeInboxView} from '../dashboard/components/inboxViewDefinitions';

/** Match the list component's actual view/search semantics, using this read's
 * fresh workspace counts to choose the default view. */
export function initialInboxListFilter(search = {}, counts) {
    const view = normalizeInboxView(search.view, counts);
    const query = search.q == null ? '' : String(search.q);
    return {...inboxViewFilter(view, query, search.assigned_to, search.search_scope),
        ...(search.tag ? {tag: String(search.tag)} : {}),
        ...(['only','include'].includes(search.snoozed) ? {snoozed: search.snoozed} : {}),
        ...Object.fromEntries(['saved_view','filters','sort'].filter(key => search[key]).map(key => [key,String(search[key])]))};
}
const filterKey = params => JSON.stringify(Object.entries(params || {})
    .filter(([,value]) => value !== undefined && value !== null)
    .map(([key,value]) => [key,String(value)]).sort(([a],[b]) => a.localeCompare(b)));
const abortError = signal => signal?.reason || new DOMException('Request aborted', 'AbortError');

/** A single navigation's pending first page. The host expires unused data after
 * its initial child effects; live refresh, retry and pagination never adopt it. */
export function createInitialInboxList(raw, location) {
    if (!raw) return undefined;
    let remaining = Promise.resolve(raw.outcome).catch(error => ({error: {
        message: error instanceof Error ? error.message : String(error),
    }}));
    const key = filterKey(raw.filter), path = location.pathname, search = location.searchStr;
    return {
        id: crypto.randomUUID(),
        expire() { remaining = undefined; },
        async take(params, scope) {
            await Promise.resolve();
            if (scope.signal?.aborted) throw abortError(scope.signal);
            if (!remaining || !scope.isCurrent() || scope.projectId !== raw.projectId
                || scope.path !== path || scope.search !== search || filterKey(params) !== key) return undefined;
            const pending = remaining;
            remaining = undefined;
            const outcome = await pending;
            if (scope.signal?.aborted || !scope.isCurrent()) throw abortError(scope.signal);
            if (outcome.error) {
                const error = Object.assign(new Error(outcome.error.message), outcome.error);
                if (error.status === 401 && typeof window !== 'undefined' && window.chatSettings) {
                    window.dispatchEvent(new CustomEvent('h2h:session-expired'));
                }
                throw error;
            }
            return outcome;
        },
    };
}
