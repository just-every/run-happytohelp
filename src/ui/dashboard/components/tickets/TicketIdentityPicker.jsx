import React, { useEffect, useState } from 'react';
import { nativeRequest } from '../../../native/transport';

const contactData = contact => contact.metadata_json ? { ...contact, ...JSON.parse(contact.metadata_json) } : contact;
const contactLabel = contact => {
    const name = contact.provided_name || contact.name || contact.display_name;
    const email = contact.provided_email || contact.email;
    return name && email && name !== email ? `${name} (${email})` : name || email || contact.external_id || 'Unnamed contact';
};
const available = contact => !['is_deleted', 'is_erased', 'is_erasing', 'is_blocked'].some(key => Boolean(contact[key]));

function ContactPicker({ id, label, projectId, value, onChange, currentContact, disabled }) {
    const [selected, setSelected] = useState(currentContact?.id === value ? contactData(currentContact) : null);
    const [query, setQuery] = useState(''), [page, setPage] = useState(1), [result, setResult] = useState(null);
    const [loadError, setLoadError] = useState(''), [searchError, setSearchError] = useState(''), [loading, setLoading] = useState(false);
    const base = `/api/management/projects/${encodeURIComponent(projectId)}/contacts`;
    useEffect(() => {
        setLoadError('');
        if (!value || selected?.id === value) return;
        if (currentContact?.id === value) { setSelected(contactData(currentContact)); return; }
        const controller = new AbortController();
        nativeRequest(`${base}/${encodeURIComponent(value)}`, { signal: controller.signal }).then(response => {
            if (!controller.signal.aborted) setSelected(contactData(response.data));
        }).catch(failure => { if (!controller.signal.aborted) setLoadError(failure.message); });
        return () => controller.abort();
    }, [base, value, selected?.id, currentContact]);
    useEffect(() => {
        if (disabled) return;
        const controller = new AbortController(); setLoading(true); setSearchError('');
        const timer = setTimeout(() => {
            const search = new URLSearchParams({ search: query, page: String(page), limit: '20', sort: 'name', direction: 'asc', total: 'none' });
            nativeRequest(`${base}?${search}`, { signal: controller.signal }).then(response => {
                if (!controller.signal.aborted) setResult({ ...response, data: response.data.map(contactData) });
            }).catch(failure => { if (!controller.signal.aborted) setSearchError(failure.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
        }, query ? 200 : 0);
        return () => { clearTimeout(timer); controller.abort(); };
    }, [base, query, page, disabled]);
    const current = selected?.id === value ? selected : null;
    const contacts = (result?.data || []).filter(contact => contact.id !== value && available(contact));
    return <div className="form-group ticket-field">
        <label className="form-label" htmlFor={id}>{label}</label>
        <select id={id} className="form-select" value={value || ''} required disabled={disabled} onChange={event => {
            const selectedId = event.target.value;
            if (!selectedId) { setSelected(null); onChange(''); return; }
            const contact = [current, ...(result?.data || [])].find(item => item?.id === selectedId);
            setSelected(contact); onChange(selectedId);
        }}>
            <option value="">Choose a contact</option>
            {value && <option value={value}>{current ? contactLabel(current) : loadError ? 'Contact unavailable' : 'Loading contact…'}</option>}
            {contacts.map(contact => <option key={contact.id} value={contact.id}>{contactLabel(contact)}</option>)}
        </select>
        {!disabled && <>
            <label className="form-label mt-2" htmlFor={`${id}-search`}>Find a contact</label>
            <input id={`${id}-search`} className="form-control" aria-label={`Search ${label.toLowerCase()} contacts`} type="search" placeholder="Search name or email" maxLength={500} value={query} onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }} onChange={event => { setQuery(event.target.value); setPage(1); }}/>
            {loading && <p role="status" className="form-text">Searching contacts…</p>}
            {!loading && result && !contacts.length && <p className="form-text">No other available contacts match.</p>}
            {result && (page > 1 || result.pagination.hasMore) && <nav className="d-flex align-items-center gap-2" aria-label={`${label} contact pages`}>
                <button type="button" className="btn btn-link btn-sm" disabled={loading || page === 1} onClick={() => setPage(currentPage => currentPage - 1)}>Previous</button>
                <span className="form-text">Page {page}</span>
                <button type="button" className="btn btn-link btn-sm" disabled={loading || !result.pagination.hasMore} onClick={() => setPage(currentPage => currentPage + 1)}>Next</button>
            </nav>}
        </>}
        {(loadError || searchError) && <p role="alert" className="text-danger">{loadError || searchError}</p>}
    </div>;
}

export default function TicketIdentityPicker(props) {
    if (props.type === 'system') return <div className="form-group ticket-field"><label className="form-label" htmlFor={props.id}>{props.label}</label><input id={props.id} className="form-control" value="System" readOnly/></div>;
    if (props.type === 'agent') return <div className="form-group ticket-field"><label className="form-label" htmlFor={props.id}>{props.label}</label><select id={props.id} className="form-select" required disabled={props.disabled} value={props.value || ''} onChange={event => props.onChange(event.target.value)}>
        <option value="">Choose a teammate</option>
        {props.value && !props.agents.some(agent => agent.id === props.value) && <option value={props.value} disabled>No longer a workspace member</option>}
        {props.agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name}{agent.email && agent.email !== agent.name ? ` (${agent.email})` : ''}</option>)}
    </select></div>;
    return <ContactPicker {...props}/>;
}
