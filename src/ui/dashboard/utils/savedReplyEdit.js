// Keep the active draft in this tab, even before a saved reply has arrived.
// When there is a server draft, its ID ties attachments to the correct use.
export function savedReplyEditKey(projectId, conversationId, operatorId) {
    return operatorId && projectId && conversationId
        ? `h2h:saved-reply-edit:${JSON.stringify([projectId, conversationId, operatorId])}` : null;
}

export function readSavedReplyEdit(key) {
    if (!key) return null;
    try {
        const edit = JSON.parse(sessionStorage.getItem(key));
        return (edit?.id === null || typeof edit?.id === 'string') && typeof edit.content === 'string' ? edit : null;
    } catch {
        return null;
    }
}

export function writeSavedReplyEdit(key, edit) {
    if (!key) return;
    try {
        if (edit) sessionStorage.setItem(key, JSON.stringify({ ...edit, revision: crypto.randomUUID() }));
        else sessionStorage.removeItem(key);
    } catch {
        // The live composer still works when the browser blocks tab storage.
    }
}

export function clearSentReplyEdit(key, sentEdit) {
    if (sentEdit && JSON.stringify(readSavedReplyEdit(key)) === JSON.stringify(sentEdit)) {
        writeSavedReplyEdit(key, null);
    }
}
