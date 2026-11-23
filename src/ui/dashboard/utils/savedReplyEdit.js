// Keep active reply drafts in this tab across conversation changes. Session
// storage also restores them when the operator reloads the tab.
const tabEdits = new Map();

// When there is a server draft, its ID ties attachments to the correct use.
export function savedReplyEditKey(projectId, conversationId, operatorId) {
    return operatorId && projectId && conversationId
        ? `h2h:saved-reply-edit:${JSON.stringify([projectId, conversationId, operatorId])}` : null;
}

export function readSavedReplyEdit(key) {
    if (!key) return null;
    if (tabEdits.has(key)) return tabEdits.get(key);
    try {
        const edit = JSON.parse(sessionStorage.getItem(key));
        return (edit?.id === null || typeof edit?.id === 'string') && typeof edit.content === 'string' ? edit : null;
    } catch {
        return null;
    }
}

export function writeSavedReplyEdit(key, edit) {
    if (!key) return;
    const current = edit ? { ...edit, revision: crypto.randomUUID() } : null;
    if (current) tabEdits.set(key, current);
    else tabEdits.delete(key);
    try {
        if (current) sessionStorage.setItem(key, JSON.stringify(current));
        else sessionStorage.removeItem(key);
    } catch {
        // Keep the in-tab edit (or its deletion) if reload storage is unavailable.
        if (!current) tabEdits.set(key, null);
    }
}

export function clearSentReplyEdit(key, sentEdit) {
    if (sentEdit && JSON.stringify(readSavedReplyEdit(key)) === JSON.stringify(sentEdit)) {
        writeSavedReplyEdit(key, null);
    }
}
