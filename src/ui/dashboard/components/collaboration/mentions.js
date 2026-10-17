/** Stable identity in the note itself. Names remain readable even if a teammate is renamed later. */
export function mentionText(member) {
    const name = String(member.name || 'Teammate').replace(/[\[\]\r\n]/g, ' ').slice(0, 120).trim() || 'Teammate';
    return `@[${name}](user:${member.id})`;
}
export function mentionIds(content) {
    return [...new Set([...String(content).matchAll(/@\[([^\]\n]{1,120})\]\(user:([^\s)\n]{1,200})\)/g)].map(match => match[2]))];
}
export const collaborationPath = (projectId, conversationId) => `/api/dashboard/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}`;
