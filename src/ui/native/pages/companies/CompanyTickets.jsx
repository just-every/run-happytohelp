import React from 'react';
import { Link } from '@tanstack/react-router';
import { dateTime } from './company-api';

export default function CompanyTickets({ projectId, tickets }) {
    return <section className="companies-panel"><div className="companies-section-heading"><div><h3>All tickets <span className="companies-count">{tickets.length}</span></h3><p className="settings-note">Support requests from this company’s members.</p></div></div>
        {tickets.length ? <div className="table-responsive"><table className="table management-table stack-table"><thead><tr><th>Ticket</th><th>Requester</th><th>Status</th><th>Updated</th></tr></thead><tbody>{tickets.map(ticket => <tr key={ticket.id}><td data-label="Ticket"><Link to={`/projects/${projectId}/conversations/${ticket.id}`}>{ticket.subject || 'Untitled ticket'}</Link></td><td data-label="Requester">{ticket.contact_name || ticket.contact_email || '—'}</td><td data-label="Status"><span className="companies-status">{ticket.status_category ? ticket.status_category.replace(/^./, letter => letter.toUpperCase()) : '—'}</span></td><td data-label="Updated">{dateTime(ticket.updated_at)}</td></tr>)}</tbody></table></div> : <p className="companies-inline-empty">No tickets from this company yet.</p>}
    </section>;
}
