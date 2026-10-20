import {takeInitialWorkspaceRead} from './initial-workspace-reads.js';
/** Native command transport. Commands are persisted by the server before UI acknowledgement. */
export async function nativeRequest(path, init = {}) {
    const initial = await takeInitialWorkspaceRead(path, init);
    if (initial) {
        if ('error' in initial) {
            notifyExpiredSession(path, initial.error.status, initial.error.data);
            throw Object.assign(new Error(initial.error.message), {status: initial.error.status, data: initial.error.data});
        }
        return initial.result;
    }
    const response = await fetch(path, { credentials: 'same-origin', ...init });
    const body = response.status === 204 ? null : await response.json();
    // A sensitive action asks for a recent step-up; once confirmed, the same request runs once more.
    if (response.status === 403 && body.code === 'step_up_required' && !init.stepUpRetried && await confirmStepUp(body)) return nativeRequest(path, { ...init, stepUpRetried: true });
    notifyExpiredSession(path, response.status, body);
    if (!response.ok) throw Object.assign(new Error(body.error?.message || body.error || `Request failed (${response.status})`), { status: response.status, data: body });
    return body;
}
/** Downloads a file the server may guard with a step-up (exports), asking for it the same way. */
export async function downloadFile(path) {
    let response = await fetch(path, { credentials: 'same-origin' });
    if (response.status === 403) {
        const body = await response.clone().json().catch(() => null);
        if (body?.code === 'step_up_required' && await confirmStepUp(body)) response = await fetch(path, { credentials: 'same-origin' });
    }
    if (!response.ok) { const body = await response.json().catch(() => ({})); throw Object.assign(new Error(body.error?.message || body.error || `Download failed (${response.status})`), { status: response.status, data: body }); }
    const name = /filename="([^"]+)"/.exec(response.headers.get('Content-Disposition') || '')?.[1] || 'download';
    const link = document.createElement('a');
    link.href = URL.createObjectURL(await response.blob()); link.download = name;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
/** Asks the dashboard's step-up dialog to confirm it is the account holder; false when declined or unavailable. */
export function confirmStepUp(details) {
    if (typeof window === 'undefined' || !window.h2hStepUp) return Promise.resolve(false);
    return window.h2hStepUp(details);
}
function notifyExpiredSession(path, status, body) {
    if (status === 401 && typeof window !== 'undefined' && body?.code === 'two_factor_required') {
        location.assign(`/two-factor?returnTo=${encodeURIComponent(location.pathname + location.search)}`);
        return;
    }
    if (status === 401 && typeof window !== 'undefined' && window.chatSettings
        && path !== '/api/identity/login' && path !== '/api/identity/password') {
        window.dispatchEvent(new CustomEvent('h2h:session-expired'));
    }
}
export async function sendCommand(projectId, conversationId, action, data) {
    if (action === 'setConversationId') return;
    if (action === 'sendMessage') {
        const frontier = await nativeRequest(`/api/conversations/${encodeURIComponent(conversationId)}`);
        return nativeRequest(`/api/conversations/${encodeURIComponent(conversationId)}/messages`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ localId: data.local_id, content: data.content, expectedRevision: frontier.revision,
                expectedLastMessageId: frontier.last_message_id, mediaIds: data.media_ids, resolve: data.resolve, authoring: data.authoring,
                ...(data.email ? data.email : {}) }),
        });
    }
    return nativeRequest(`/api/dashboard/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}/actions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...data }),
    });
}

/** Reconnect uses the persisted event cursor. Never repeats a mutation on a reconnect. */
function connectSocket(resourcePath, cursorKey, onFrame, onReconnect, onError) {
    let socket, timer, stopped = false, connected = false, attempt = 0;
    const key = cursorKey;
    let cursor = sessionStorage.getItem(key) || '';
    const open = () => {
        const url = new URL(resourcePath, location.origin);
        url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        if (cursor) url.searchParams.set('after', cursor);
        if (window.chatSettings.socketToken) url.searchParams.set('token', window.chatSettings.socketToken);
        socket = new WebSocket(url);
        socket.onopen = () => { attempt = 0; if (connected) onReconnect(); connected = true; };
        socket.onmessage = event => {
            try {
                const frame = JSON.parse(event.data);
                onFrame(frame);
                if (frame.eventId) { cursor = frame.eventId; sessionStorage.setItem(key, cursor); }
            } catch (error) { onError(error); }
        };
        // A socket closed on purpose (teardown) is not an outage: report only failures that will reconnect.
        socket.onerror = () => { if (!stopped) onError(new Error('Live connection unavailable; reconnecting.')); };
        socket.onclose = () => { if (!stopped) timer = setTimeout(open, Math.min(15000, 500 * 2 ** attempt++)); };
    };
    open();
    const dispose = () => { stopped = true; clearTimeout(timer); socket?.close(); };
    dispose.send = frame => { if (!stopped && socket?.readyState === WebSocket.OPEN) { socket.send(JSON.stringify(frame)); return true; } return false; };
    return dispose;
}

export function connectConversation(conversationId, onFrame, onReconnect, onError) {
    return connectSocket(`/api/conversations/${encodeURIComponent(conversationId)}/socket`, `h2h-event:${conversationId}`, onFrame, onReconnect, onError);
}
export function connectProject(projectId, onFrame, onReconnect, onError) {
    return connectSocket(`/api/projects/${encodeURIComponent(projectId)}/socket`, `h2h-project-event:${projectId}`, onFrame, onReconnect, onError);
}
