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

export function removeReference(content, token) {
    return content.split(token).join('');
}

export function mergeReferences(current, incoming = []) {
    return [...new Map([...current, ...incoming].map(reference => [reference.token, reference])).values()];
}

export function referenceSummary(content = '') {
    return content.replace(referencePattern, ' [Knowledge reference] ');
}
