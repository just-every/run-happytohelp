const referencePattern = /⟦k:[a-f0-9]{32}⟧/g;

export function referenceParts(content = '') {
    const parts = [];
    let start = 0;
    for (const match of content.matchAll(referencePattern)) {
        parts.push({text: content.slice(start, match.index), start});
        parts.push({token: match[0], start: match.index});
        start = match.index + match[0].length;
    }
    parts.push({text: content.slice(start), start});
    return parts;
}

/** Cards already supply paragraph spacing visually. Keep those separators in
 * stored content, outside the editable text ranges and their caret offsets. */
export function editableReferenceParts(content) {
    return referenceParts(content).map((part,index,parts) => {
        if (part.token) return part;
        const leading = index > 0 ? part.text.match(/^(?:\r?\n){1,2}/)?.[0].length || 0 : 0;
        const trailing = index < parts.length - 1 ? part.text.match(/(?:\r?\n){1,2}$/)?.[0].length || 0 : 0;
        return {...part,start:part.start + leading,text:part.text.slice(leading,Math.max(leading,part.text.length - trailing))};
    });
}

/** Keep the visible block boundaries in the opaque text that is saved and sent. */
export function separateReferences(content, references = []) {
    const parts = referenceParts(content);
    const isLink = token => references.find(reference => reference.token === token)?.mode === 'link';
    return parts.map((part,index) => {
        if (part.token) return part.token;
        const before = parts[index - 1]?.token, after = parts[index + 1]?.token;
        if (!part.text) return before && after ? (isLink(before) && isLink(after) ? ' ' : '\n\n') : '';
        let text = part.text;
        if (before && !(isLink(before) ? /^\s/.test(text) : /^\r?\n/.test(text))) text = (isLink(before) ? ' ' : '\n\n') + text;
        if (after && !(isLink(after) ? /\s$/.test(text) : /\r?\n$/.test(text))) text += isLink(after) ? ' ' : '\n\n';
        return text;
    }).join('');
}

export function removeReference(content, token) {
    return content.split(token).join('');
}

export function mergeReferences(current, incoming = []) {
    return [...new Map([...current, ...incoming].map(reference => [reference.token, reference])).values()];
}

export function referenceSummary(content = '') {
    return content.replace(referencePattern, ' [Knowledge reference] ');
}
