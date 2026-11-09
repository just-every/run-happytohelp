import { transportFetch } from './busy';

const DEFAULT_READ_TIMEOUT_MS = 15000;

async function requestJson(url, options = {}, { signal, timeoutMs = DEFAULT_READ_TIMEOUT_MS } = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });

    const timer = timeoutMs > 0 ? setTimeout(() => {
        const error = new Error('The request took too long. Please try again.');
        error.name = 'TimeoutError';
        controller.abort(error);
    }, timeoutMs) : null;

    try {
        // A read that gets no complete answer rejects with the busy marker, so its view waits and reads again.
        const response = await transportFetch(url, { ...options, signal: controller.signal });
        if (response.status === 204) return {};

        if (!response.ok) {
            if (response.status === 401 && typeof window !== 'undefined' && window.chatSettings) {
                const requestUrl = new URL(url, window.location.origin);
                if (requestUrl.origin === window.location.origin && requestUrl.pathname.startsWith('/api/dashboard/')) {
                    window.dispatchEvent(new CustomEvent('h2h:session-expired'));
                }
            }
            const payload = await response.json().catch(() => null);
            const error = new Error(payload?.message || (typeof payload?.error === 'string' ? payload.error : payload?.error?.message) || `Request failed (${response.status}). Please try again.`);
            error.status = response.status;
            const retryAfter = Number(response.headers.get('Retry-After'));
            if (retryAfter > 0) error.retryAfter = retryAfter;
            if (payload && typeof payload === 'object') Object.assign(error, payload);
            throw error;
        }

        // A complete answer that is not JSON is a real error.
        return JSON.parse(await response.text());
    } catch (error) {
        // Fetch may report a generic AbortError while consuming a timed-out body.
        // Preserve the timeout reason so the UI offers Retry instead of hiding it.
        if (controller.signal.aborted) throw controller.signal.reason || error;
        // A write is never repeated: its outcome is unknown, and it throws what it threw before.
        if (error?.transport && (options.method || 'GET').toUpperCase() !== 'GET') throw error.cause;
        throw error;
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
    }
}

export { requestJson };
