import React, { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { nativeRequest } from '../../transport';
import { useConfirmation } from '../ConfirmDialog';
import { companyRequest, projectPath } from './company-api';

export default function CompanyMembers({ projectId, company, members, canManage, onChanged }) {
    const [query, setQuery] = useState(''), [results, setResults] = useState(null), [pagination, setPagination] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    const { ask, dialog } = useConfirmation();
    useEffect(() => { setResults(null); setQuery(''); setError(''); }, [company.id]);
    const search = async (page = 1) => {
        setBusy(true); setError('');
        try { const response = await nativeRequest(`${projectPath(projectId)}/contacts?${new URLSearchParams({ search: query, page: String(page), limit: '20', sort: 'name', direction: 'asc' })}`); setResults(response.data); setPagination(response.pagination); }
        catch (failure) { setError(failure.message); } finally { setBusy(false); }
    };
    const link = contact => ask({ title: `Link ${contact.name || contact.email} to ${company.name}?`, confirmLabel: 'Link contact', busyLabel: 'Linking…', body: <><p>This adds the contact to {company.name}. If they belong to another company, their membership moves here.</p>{company.portalCompanyView && <p><strong>Company portal sharing is enabled.</strong> Verified members can view this contact’s tickets, and this contact can view company tickets.</p>}</>, run: async () => { await companyRequest(projectId, company.id, `/members/${encodeURIComponent(contact.id)}`, 'PUT', {}); await onChanged(); } });
    const unlink = contact => ask({ title: `Unlink ${contact.name || contact.email}?`, confirmLabel: 'Unlink contact', busyLabel: 'Unlinking…', body: <p>This removes their membership of {company.name}. Their contact record and tickets remain. Company portal access through this membership ends.</p>, run: async () => { await companyRequest(projectId, company.id, `/members/${encodeURIComponent(contact.id)}`, 'DELETE', {}); await onChanged(); } });
    const ids = new Set(members.map(member => member.id));
    return <section className="companies-panel"><div className="companies-section-heading"><div><h3>Members <span className="companies-count">{members.length}</span></h3><p className="settings-note">Contacts linked to this company.</p></div></div>
        {members.length ? <ul className="companies-member-list">{members.map(contact => <li key={contact.id}><span className="management-avatar" aria-hidden="true">{(contact.name || contact.email || '?').slice(0, 1).toUpperCase()}</span><div className="companies-member-name"><Link to={`/projects/${projectId}/contacts/${contact.id}`}>{contact.name || contact.email || 'Unnamed contact'}</Link><span className="settings-note">{contact.email}</span></div>{canManage && <button className="btn btn-link" onClick={() => unlink(contact)} aria-label={`Unlink ${contact.name || contact.email}`}>Unlink</button>}</li>)}</ul> : <p className="companies-inline-empty">No members yet. Link an existing contact below.</p>}
        {error && <p className="alert alert-danger" role="alert">{error}</p>}
        {canManage && <div className="companies-member-search"><h4>Link an existing contact</h4><form onSubmit={event => { event.preventDefault(); search(); }}><label className="visually-hidden" htmlFor="company-contact-search">Contact name or email</label><input id="company-contact-search" className="form-control" type="search" value={query} placeholder="Search contacts by name or email" onChange={event => { setQuery(event.target.value); setResults(null); }}/><button className="btn btn-outline-secondary" disabled={busy}>{busy ? 'Searching…' : 'Find contacts'}</button></form>
            {results && <><ul className="companies-member-results">{results.map(contact => <li key={contact.id}><div><strong>{contact.name || contact.email || 'Unnamed contact'}</strong><span className="settings-note">{contact.email}</span></div><button className="btn btn-white" disabled={busy || ids.has(contact.id)} onClick={() => link(contact)}>{ids.has(contact.id) ? 'Linked' : 'Link contact'}</button></li>)}</ul>{!results.length && <p className="settings-note">No contacts found.</p>}{pagination && <div className="companies-actions"><button className="btn btn-white" disabled={busy || pagination.page <= 1} onClick={() => search(pagination.page - 1)}>Previous</button><span className="settings-note">Page {pagination.page}</span><button className="btn btn-white" disabled={busy || !pagination.hasMore} onClick={() => search(pagination.page + 1)}>Next</button></div>}</>}
        </div>}{dialog}
    </section>;
}
