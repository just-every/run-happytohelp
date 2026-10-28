import React, { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { dateTime } from './company-api';
import { identityName, proofLabel, recentConversations } from './identity-link-api';

// The linked identity's own recent conversations, shown to staff as context only.
function LinkedHistory({ projectId, contactId }) {
    const [rows, setRows] = useState(null), [error, setError] = useState('');
    useEffect(() => { let active = true; recentConversations(projectId, contactId).then(result => { if (active) setRows(result); }).catch(failure => { if (active) setError(failure.message); }); return () => { active = false; }; }, [projectId, contactId]);
    if (error) return <p className="settings-note" role="alert">{error}</p>;
    if (!rows) return <p className="settings-note" role="status">Loading conversations…</p>;
    return rows.length ? <ul className="identity-links__history">{rows.map(row => <li key={row.id}><Link to={`/projects/${projectId}/conversations/${row.id}`}>{row.preview || 'Open conversation'}</Link><span className="settings-note">{row.resolved_at ? 'Closed' : 'Open'} · {dateTime(row.updated_at)}</span></li>)}</ul> : <p className="settings-note">No conversations yet.</p>;
}

export default function LinkedIdentities({ projectId, links, onUnlink }) {
    if (!links.length) return <p className="identity-links__empty">No linked identities. Link one only after verifying both belong to this customer.</p>;
    return <ul className="identity-links__list" aria-label="Linked identities">{links.map(link => <li key={link.contact.id}>
        <span className="management-avatar" aria-hidden="true">{identityName(link.contact).slice(0, 1).toUpperCase()}</span>
        <div className="identity-links__body">
            <div className="identity-links__name"><Link to={`/projects/${projectId}/contacts/${link.contact.id}`}>{identityName(link.contact)}</Link><span className={`identity-links__proof${link.contact.proof ? ' is-verified' : ''}`}>{proofLabel(link.contact.proof)}</span></div>
            {link.contact.email && <span className="settings-note">{link.contact.email}</span>}
            <p className="identity-links__meta">Linked by {link.actor_name || link.actor_id} · {dateTime(link.created_at)}</p>
            <p className="identity-links__evidence"><span>Evidence</span>{link.provenance}</p>
            <LinkedHistory projectId={projectId} contactId={link.contact.id}/>
        </div>
        <button type="button" className="btn btn-link" aria-label={`Unlink ${identityName(link.contact)}`} onClick={() => onUnlink(link.contact)}>Unlink</button>
    </li>)}</ul>;
}

export function IdentityDecisions({ history }) {
    if (!history.length) return null;
    return <div className="identity-links__decisions"><h3>Link history</h3><ol>{history.map(entry => <li key={entry.id}>
        <strong>{entry.action === 'linked' ? `Linked ${identityName(entry.contact)}` : `Unlinked ${identityName(entry.contact)}`}</strong>
        <span className="settings-note">{entry.actor_name || entry.actor_id} · <time dateTime={new Date(entry.at).toISOString()}>{dateTime(entry.at)}</time></span>
        <p className="identity-links__evidence"><span>{entry.action === 'linked' ? 'Evidence' : 'Reason'}</span>{entry.provenance}</p>
    </li>)}</ol></div>;
}
