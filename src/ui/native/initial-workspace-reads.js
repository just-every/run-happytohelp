// Exactly one navigation owns these fresh server reads. They are never shared
// with another navigation, credentials, request shape, or a later page mount.
let current;
const abortError = signal => signal?.reason || new DOMException('Request aborted', 'AbortError');
const locationMatches = entry => typeof window !== 'undefined'
    && window.location.pathname === entry.pathname && window.location.search === entry.search
    && (typeof window.chatSettings?.sessionVersion !== 'number' || window.chatSettings.sessionVersion === entry.sessionVersion);

export function expireInitialWorkspaceReads() {
    if (!current) return;
    current.live = false;
    current.reads.clear();
    current = undefined;
}

export function installInitialWorkspaceReads(entries, location, sessionVersion) {
    expireInitialWorkspaceReads();
    if (typeof window === 'undefined') return {expire() {}};
    const entry = {
        pathname: location.pathname, search: location.searchStr, sessionVersion,
        live: true, accepting: true,
        reads: new Map(Object.entries(entries || {}).map(([path, outcome]) => [path,
            // A read cut off in transit is busy (nativeRequest reads it live), never a real error.
            Promise.resolve(outcome).catch(error => ({error: {
                status: error?.status, message: error instanceof Error ? error.message : String(error), data: error?.data,
                ...(error?.transport ? {transport: true} : {}),
            }})),
        ])),
    };
    current = entry;
    return {
        // Keep already-reserved reads alive. Only their request signal, a new
        // navigation or session invalidation can retire an in-flight adoption.
        expire() { entry.accepting = false; entry.reads.clear(); },
    };
}

export async function takeInitialWorkspaceRead(path, init = {}) {
    if (typeof window === 'undefined') return undefined;
    const entry = current;
    if (!entry || !entry.accepting || typeof path !== 'string'
        || String(init.method || 'GET').toUpperCase() !== 'GET' || init.body != null || init.headers !== undefined
        || Object.keys(init).some(key => !['method','signal','credentials'].includes(key))
        || init.credentials !== undefined && init.credentials !== 'same-origin') return undefined;
    // StrictMode's discarded setup aborts before its continuation can reserve
    // the response needed by the replacement setup.
    await Promise.resolve();
    if (init.signal?.aborted) throw abortError(init.signal);
    if (current !== entry || !entry.live || !entry.accepting || !locationMatches(entry)) return undefined;
    const pending = entry.reads.get(path);
    if (!pending) return undefined;
    entry.reads.delete(path);
    const outcome = await pending;
    if (init.signal?.aborted || current !== entry || !entry.live || !locationMatches(entry)) throw abortError(init.signal);
    return outcome;
}
