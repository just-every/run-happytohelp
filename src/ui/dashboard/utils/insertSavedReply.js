/**
 * Puts a saved reply into the composer without disturbing what is already typed.
 * An empty draft becomes exactly the reply. Otherwise the reply becomes its own paragraph
 * next to the caret's line, so no typed sentence is ever split or overwritten: before that
 * line when the caret sits at its very start, after it otherwise (a selection is left alone).
 * Link references use a space separator; other replies use a blank line.
 * Returns the new draft and where the caret belongs afterwards.
 */
export function insertSavedReply(draft, reply, selectionStart = draft.length, selectionEnd = selectionStart, separator = '\n\n') {
    if (!draft.trim()) return { text: reply, caret: reply.length };

    const caret = Math.min(Math.max(0, selectionEnd), draft.length);
    const atLineStart = caret === 0 || draft[caret - 1] === '\n';
    let at = caret;
    if (!atLineStart) {
        const lineEnd = draft.indexOf('\n', caret);
        at = lineEnd === -1 ? draft.length : lineEnd;
    }

    const before = draft.slice(0, at);
    const after = draft.slice(at);
    // Top up whatever line breaks already border the reply to one blank line.
    const breaks = text => (text.match(/\n/g) || []).length;
    const lead = before.trim() ? separator === ' ' ? (/\s$/.test(before) ? '' : ' ') : '\n'.repeat(Math.max(0, 2 - breaks(before.match(/\s*$/)[0]))) : '';
    const trail = after.trim() ? separator === ' ' ? (/^\s/.test(after) ? '' : ' ') : '\n'.repeat(Math.max(0, 2 - breaks(after.match(/^\s*/)[0]))) : '';

    return { text: before + lead + reply + trail + after, caret: before.length + lead.length + reply.length };
}
