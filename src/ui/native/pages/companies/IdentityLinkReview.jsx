import React, { useId, useState } from 'react';
import { applyIdentityLink, identityName, previewIdentityLink, proofLabel, searchContacts } from './identity-link-api';

function IdentityCard({ contact, opened }) {
    return <div className="identity-review__identity"><span>{opened ? 'This customer' : 'Other identity'}</span><strong>{identityName(contact)}</strong>{contact.email && <span>{contact.email}</span>}<span className={`identity-links__proof${contact.proof ? ' is-verified' : ''}`}>{proofLabel(contact.proof)}</span></div>;
}

/** Choose (link) or confirm (unlink) the other identity, record the evidence, preview, then apply that exact preview. */
export default function IdentityLinkReview({ projectId, contact, action, target, linkedIds, onDone, onCancel }) {
    const [query, setQuery] = useState(''), [results, setResults] = useState(null), [chosen, setChosen] = useState(target || null);
    const [evidence, setEvidence] = useState(''), [preview, setPreview] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
    const searchId = useId(), evidenceId = useId(), linking = action === 'link';
    const run = async work => { setBusy(true); setError(''); try { await work(); } catch (failure) { setError(failure.message); } finally { setBusy(false); } };
    const search = event => { event.preventDefault(); run(async () => setResults((await searchContacts(projectId, query)).filter(row => row.id !== contact.id))); };
    const review = event => { event.preventDefault(); run(async () => setPreview(await previewIdentityLink(projectId, contact.id, { action, contact_id: chosen.id, provenance: evidence }))); };
    const apply = () => run(async () => { await applyIdentityLink(projectId, contact.id, preview); await onDone(linking ? `Linked ${identityName(chosen)} as possibly the same customer.` : `Unlinked ${identityName(chosen)}.`); });
    return <div className="identity-review" role="region" aria-label={linking ? 'Link a verified identity' : `Unlink ${identityName(chosen)}`}>
        <h3>{linking ? 'Link a verified identity' : `Unlink ${identityName(chosen)}`}</h3>
        {linking && !chosen && <><form className="identity-review__search" onSubmit={search}><label className="visually-hidden" htmlFor={searchId}>Customer name or email</label><input id={searchId} className="form-control" type="search" value={query} placeholder="Search customers by name or email" onChange={event => { setQuery(event.target.value); setResults(null); }}/><button className="btn btn-outline-secondary" disabled={busy}>{busy ? 'Searching…' : 'Find customers'}</button></form>
            {results && (results.length ? <ul className="identity-review__results">{results.map(row => <li key={row.id}><div><strong>{identityName(row)}</strong>{row.email && <span className="settings-note">{row.email}</span>}</div><button type="button" className="btn btn-white" disabled={linkedIds.has(row.id)} onClick={() => setChosen(row)}>{linkedIds.has(row.id) ? 'Linked' : 'Choose'}</button></li>)}</ul> : <p className="settings-note">No customers found.</p>)}</>}
        {chosen && !preview && <form onSubmit={review}>
            <p className="identity-review__chosen">{linking ? 'Link' : 'Unlink'} <strong>{identityName(chosen)}</strong>{linking && <button type="button" className="btn btn-link" onClick={() => { setChosen(null); setError(''); }}>Change</button>}</p>
            <label className="form-label" htmlFor={evidenceId}>{linking ? 'Evidence' : 'Reason for unlinking'}</label>
            <textarea id={evidenceId} className="form-control" rows={3} maxLength={1000} required value={evidence} placeholder={linking ? 'Where you verified that both identities belong to this customer' : 'Why these identities should no longer be linked'} onChange={event => setEvidence(event.target.value)}/>
            <div className="companies-actions identity-review__actions"><button className="btn btn-primary" disabled={busy || !evidence.trim()}>{busy ? 'Preparing…' : linking ? 'Preview link' : 'Preview unlink'}</button><button type="button" className="btn btn-outline-secondary" onClick={onCancel}>Cancel</button></div>
        </form>}
        {preview && <div className="identity-review__preview">
            <p className="identity-review__status">Preview — nothing changed yet</p>
            <div className="identity-review__identities">{[...preview.contacts].sort((a, b) => (b.id === contact.id) - (a.id === contact.id)).map(row => <IdentityCard key={row.id} contact={row} opened={row.id === contact.id}/>)}</div>
            <dl className="identity-review__facts"><div><dt>{linking ? 'Evidence' : 'Reason'}</dt><dd>{preview.provenance}</dd></div><div><dt>Records</dt><dd>Nothing is merged</dd></div><div><dt>Messages</dt><dd>No message is sent</dd></div><div><dt>Customer access</dt><dd>{preview.grants_customer_access ? 'Changes' : 'Unchanged; each customer sees only their own conversations'}</dd></div></dl>
            <div className="companies-actions identity-review__actions"><button type="button" className="btn btn-primary" disabled={busy} onClick={apply}>{busy ? 'Saving…' : linking ? 'Confirm link' : 'Confirm unlink'}</button><button type="button" className="btn btn-outline-secondary" disabled={busy} onClick={onCancel}>Cancel</button></div>
        </div>}
        {error && <p className="alert alert-danger" role="alert">{error}</p>}
        {linking && !chosen && <div className="companies-actions"><button type="button" className="btn btn-outline-secondary" onClick={onCancel}>Cancel</button></div>}
    </div>;
}
