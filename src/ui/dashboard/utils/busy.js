// The server answers 503 when its database is briefly busy: that is a wait, never a failure. Views keep what
// they show, say they are busy (role="status") and read again after Retry-After, at most this long.
const BUSY_RETRY_CAP_SECONDS = 10;
const BUSY_RETRY_DEFAULT_SECONDS = 3;

/** A read that got no complete answer (a dropped connection, a restarting runtime) is busy too, never a real
 * error: it carries this marker. transportFetch below is the one place that classifies it. */
export const transportFailure = cause => Object.assign(
    new Error('The connection to the workspace was interrupted.', {cause}), {transport: true});
export const isBusy = error => error?.status === 503 || error?.transport === true;
export const busyWait = error => 1000 * Math.min(BUSY_RETRY_CAP_SECONDS, error?.retryAfter > 0 ? error.retryAfter : BUSY_RETRY_DEFAULT_SECONDS);
/** The one classification of a transport failure: fetch() rejects (other than an abort), or the answer's body
 * errors before its end. Both reject with the busy marker; an answer that did arrive is the caller's to judge.
 * `ended` runs once the body has ended or been cut (not on an abort), so a caller can settle what it still
 * expected from that body; a caller that streams the body passes it, and gets the body wrapped in a stream that
 * reports the cut. A caller that only reads the whole body passes none. */
export async function transportFetch(input, init = {}, ended) {
    const aborted = error => error?.name === 'AbortError' || init.signal?.aborted;
    let response;
    try {
        response = await fetch(input, init);
    } catch (error) {
        if (aborted(error)) throw error;
        ended?.();
        throw transportFailure(error);
    }
    // A null-body status (204, 205, 304) may still carry an empty stream, which a Response cannot be built with.
    if (!response.body || [204, 205, 304].includes(response.status)) { ended?.(); return response; }
    // A caller that reads the whole body (text or json) needs no stream of its own: the answer keeps the browser's own
    // body, which tooling and the network panel can still read, and a cut body rejects those reads as a transport failure.
    if (!ended) {
        for (const read of ['text', 'json', 'arrayBuffer', 'blob', 'formData']) {
            const own = response[read].bind(response);
            Object.defineProperty(response, read, {value: async () => {
                try { return await own(); } catch (error) { throw aborted(error) ? error : transportFailure(error); }
            }});
        }
        return response;
    }
    const reader = response.body.getReader();
    const body = new ReadableStream({
        async pull(controller) {
            let chunk;
            try {
                chunk = await reader.read();
            } catch (error) {
                if (aborted(error)) { controller.error(error); return; }
                controller.error(transportFailure(error));
                ended?.();
                return;
            }
            if (chunk.done) { controller.close(); ended?.(); } else controller.enqueue(chunk.value);
        },
        cancel(reason) { return reader.cancel(reason); },
    });
    return new Response(body, {status: response.status, statusText: response.statusText, headers: response.headers});
}
