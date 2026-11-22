// Keep edits in this tab until the operator sends or abandons the reply. The
// server's draft id ties the edit to the exact saved reply the operator used.
export function savedReplyEditKey(projectId, conversationId, operatorId) {
    return operatorId && projectId && conversationId
        ? `h2h:saved-reply-edit:${JSON.stringify([projectId, conversationId, operatorId])}` : null;
}

export function readSavedReplyEdit(key) {
    if (!key) return null;
    try {
        const edit = JSON.parse(sessionStorage.getItem(key));
        return typeof edit?.id === 'string' && typeof edit.content === 'string' ? edit : null;
    } catch {
        return null;
    }
}

export function writeSavedReplyEdit(key, edit) {
    if (!key) return;
    try {
        if (edit) sessionStorage.setItem(key, JSON.stringify(edit));
        else sessionStorage.removeItem(key);
    } catch {
        // The live composer still works when the browser blocks tab storage.
    }
}
