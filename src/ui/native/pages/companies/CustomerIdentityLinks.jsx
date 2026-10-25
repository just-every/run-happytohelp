import React, { useCallback, useEffect, useState } from 'react';
import { useDashboardSettings } from '../../dashboard-state';
import { Section } from '../forms';
import { identityLinks, identityUnavailable } from './identity-link-api';
import LinkedIdentities, { IdentityDecisions } from './LinkedIdentities';
import IdentityLinkReview from './IdentityLinkReview';
import './identity-links.css';

/** "Possibly the same customer": reviewed links between verified identities, as staff context only. */
export default function CustomerIdentityLinks({ projectId, contact }) {
    const allowed = (useDashboardSettings().projects?.[projectId]?.access?.permissions || []).includes('contacts.manage');
    const [data, setData] = useState(null), [error, setError] = useState(''), [notice, setNotice] = useState(''), [review, setReview] = useState(null);
    const load = useCallback(async () => setData(await identityLinks(projectId, contact.id)), [projectId, contact.id]);
    const unavailable = identityUnavailable(contact);
    useEffect(() => {
        let active = true; setData(null); setError(''); setReview(null); setNotice('');
        if (!allowed || unavailable) return undefined;
        identityLinks(projectId, contact.id).then(result => { if (active) setData(result); }).catch(failure => { if (active) setError(failure.message); });
        return () => { active = false; };
    }, [projectId, contact.id, allowed, unavailable]);
    if (!allowed) return null;
    const done = async message => { setReview(null); setNotice(message); try { await load(); } catch (failure) { setError(failure.message); } };
    const start = next => { setNotice(''); setReview(next); };
    return <div className="identity-links"><Section title={<>Possibly the same customer <span className="identity-links__label">Context only</span></>} description="Verified identities a teammate linked to this customer. Nothing is merged or sent, and each customer still sees only their own conversations.">
        {unavailable && <p className="identity-links__empty">Linked identities are hidden while this customer is blocked.</p>}
        {notice && <p className="alert alert-success" role="status">{notice}</p>}
        {error && <p className="alert alert-danger" role="alert">{error}</p>}
        {!data && !error && !unavailable && <p role="status">Loading linked identities…</p>}
        {data && <>
            <LinkedIdentities projectId={projectId} links={data.links} onUnlink={target => start({ action: 'unlink', target })}/>
            {review ? <IdentityLinkReview key={`${review.action}:${review.target?.id || ''}`} projectId={projectId} contact={contact} action={review.action} target={review.target} linkedIds={new Set(data.links.map(link => link.contact.id))} onDone={done} onCancel={() => setReview(null)}/>
                : <div className="companies-actions identity-links__start"><button type="button" className="btn btn-outline-secondary" onClick={() => start({ action: 'link' })}>Link a verified identity</button></div>}
            <IdentityDecisions history={data.history}/>
        </>}
    </Section></div>;
}
