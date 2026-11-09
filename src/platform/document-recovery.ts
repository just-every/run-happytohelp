import { dashboardPath } from './dashboard-path';
import { documentEndMarker, documentRecoveryScript } from './document-recovery-script';

/**
 * A dashboard document streams its workspace bootstrap, so a dropped connection or a Worker restart can cut it after
 * its headers. The browser then keeps a document that never finishes parsing: no app script ever runs. So the Worker
 * writes, ahead of Start's own bytes, a head carrying the recovery script (document-recovery-script.ts):
 *  - uncompressed (`Content-Encoding: identity`): a compressing encoder holds every byte until the stream ends, and the
 *    script must reach the browser before the bootstrap resolves. Documents already carry `Cache-Control: no-transform`
 *    (document-headers.ts), so the edge does not compress them in production either;
 *  - a heartbeat comment each second while the document waits at a safe point (after a closed script element), so a
 *    document that is merely slow keeps arriving and is never mistaken for a cut one;
 *  - an end marker after the document's last byte, which tells the script the document is complete.
 * Start's own doctype, html and head follow: the parser ignores the repeated doctype and head.
 */
const prefix = `<!DOCTYPE html><html lang="en"><head><script>${documentRecoveryScript}</script>`;
const heartbeat = '<!---->';
const heartbeatMs = 1000;
const scriptClose = new TextEncoder().encode('</script>');

const endsWithScriptClose = (bytes: Uint8Array) =>
    bytes.length >= scriptClose.length && scriptClose.every((byte, index) => bytes[bytes.length - scriptClose.length + index] === byte);

/** Inline scripts run under the document's policy as it stands: none, or one whose script source allows inline code
 *  (a nonce or hash there would turn 'unsafe-inline' off). A stricter policy keeps the document as Start wrote it. */
function allowsInlineScripts(policy: string | null) {
    if (!policy) return true;
    const directives = new Map(policy.split(';').map(part => part.trim().split(/\s+/)).filter(([name]) => name).map(([name, ...sources]) => [name.toLowerCase(), sources]));
    const sources = directives.get('script-src-elem') ?? directives.get('script-src') ?? directives.get('default-src');
    return !sources || sources.includes("'unsafe-inline'") && !sources.some(source => /^'(?:nonce-|sha\d{3}-|strict-dynamic)/.test(source));
}

/** Dashboard document GETs only; every other response is returned as it is. */
export function withDocumentRecovery(request: Request, response: Response): Response {
    if (request.method !== 'GET' || response.status !== 200 || !response.body
        || !/^text\/html(?:;|$)/i.test(response.headers.get('Content-Type') || '')
        || !dashboardPath.test(new URL(request.url).pathname)
        || !allowsInlineScripts(response.headers.get('Content-Security-Policy'))) return response;

    const upstream = response.body.getReader(), encoder = new TextEncoder();
    let pending: Promise<ReadableStreamReadResult<Uint8Array>> | undefined, safe = true;
    const body = new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(encoder.encode(prefix)); },
        async pull(controller) {
            for (;;) {
                pending ??= upstream.read();
                let timer: ReturnType<typeof setTimeout> | undefined;
                const next = await Promise.race([pending, new Promise<'quiet'>(resolve => { timer = setTimeout(resolve, heartbeatMs, 'quiet'); })]);
                clearTimeout(timer);
                if (next === 'quiet') {
                    if (!safe) continue;
                    controller.enqueue(encoder.encode(heartbeat));
                    return;
                }
                pending = undefined;
                if (next.done) {
                    controller.enqueue(encoder.encode(documentEndMarker));
                    controller.close();
                    return;
                }
                if (!next.value.byteLength) continue;
                safe = endsWithScriptClose(next.value);
                controller.enqueue(next.value);
                return;
            }
        },
        cancel(reason) { return upstream.cancel(reason); },
    });
    const document = new Response(body, response);
    document.headers.set('Content-Encoding', 'identity');
    return document;
}
