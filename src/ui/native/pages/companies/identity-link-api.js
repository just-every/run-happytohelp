import { nativeRequest } from '../../transport';
import { jsonRequest, projectPath } from './company-api';

// Reviewed identity associations: operator context only, never a merge, a send or customer access.
const linkPath = (projectId, contactId) => `${projectPath(projectId)}/contacts/${encodeURIComponent(contactId)}/identity-links`;
export const identityLinks = (projectId, contactId) => nativeRequest(linkPath(projectId, contactId));
export const previewIdentityLink = async (projectId, contactId, intent) => (await nativeRequest(`${linkPath(projectId, contactId)}/preview`, jsonRequest('POST', intent))).preview;
export const applyIdentityLink = (projectId, contactId, preview) => nativeRequest(linkPath(projectId, contactId), jsonRequest('POST', preview));
export const searchContacts = async (projectId, search) => (await nativeRequest(`${projectPath(projectId)}/contacts?${new URLSearchParams({ search, page: '1', limit: '20', sort: 'name', direction: 'asc' })}`)).data;
export const recentConversations = async (projectId, contactId) => (await nativeRequest(`${projectPath(projectId)}/contacts/${encodeURIComponent(contactId)}/conversations?page=1`)).data.slice(0, 3);
// The server reviews links only for an available customer: not blocked, being erased, erased or deleted.
export const identityUnavailable = contact => ['is_blocked', 'is_erasing', 'is_erased', 'is_deleted'].some(flag => contact[flag]);
export const identityName = contact => contact.name || contact.email || contact.external_id || 'Unnamed customer';
export const proofLabel = proof => proof === 'signed_widget' ? 'Signed website identity' : proof === 'mailbox' ? 'Verified mailbox' : 'Not verified';
