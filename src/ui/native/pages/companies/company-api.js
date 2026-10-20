import { nativeRequest } from '../../transport';

export const projectPath = projectId => `/api/management/projects/${encodeURIComponent(projectId)}`;
export const companyPath = (projectId, id) => `${projectPath(projectId)}/companies${id ? `/${encodeURIComponent(id)}` : ''}`;
export const jsonRequest = (method, value) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
export const companyRequest = (projectId, id, suffix = '', method = 'GET', value) => nativeRequest(`${companyPath(projectId, id)}${suffix}`, method === 'GET' ? {} : jsonRequest(method, value));
export const dateTime = value => value ? new Date(value).toLocaleString() : '—';
export const attributeValue = value => value === true ? 'Yes' : value === false ? 'No' : value === null || value === undefined || value === '' ? '—' : Array.isArray(value) ? value.join(', ') : String(value);

/** Read just the RFC 4180 header, leaving row validation and the import plan to the server. */
export function csvHeaders(csv) {
    const source = csv.replace(/^\uFEFF/, ''), headers = [];
    let value = '', quoted = false;
    for (let index = 0; index < source.length; index++) {
        const character = source[index];
        if (character === '"') {
            if (quoted && source[index + 1] === '"') { value += '"'; index++; }
            else quoted = !quoted;
        } else if (!quoted && (character === ',' || character === '\n' || character === '\r')) {
            headers.push(value); value = '';
            if (character !== ',') return headers;
        } else value += character;
    }
    if (quoted) throw new Error('The CSV header has an unclosed quote.');
    return [...headers, value];
}
