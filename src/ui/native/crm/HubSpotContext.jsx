import React from 'react';
import {Link} from '@tanstack/react-router';
import {crmRoot, useCrmAccess, useCrmResource} from './useCrmResource';
import HubSpotMapping from './HubSpotMapping';
import './crm.css';
const states = {
    unmapped: 'Unmapped — choose source IDs on the customer record.',
    disconnected: 'Disconnected — reconnect in Settings, then map this customer again.',
    fresh: 'Fresh — identity checked against HubSpot.',
    stale: 'Stale — refresh to check the latest identity and account context.',
    identity_mismatch: 'Identity mismatch — check the native email, company domain and source association before remapping.',
    permission_lost: 'Grant revoked or refused — check the HubSpot private app and reconnect in Settings.',
    scope_refused: 'Read-only scopes refused — reconnect with exactly the two required read scopes.',
    unavailable: 'Unavailable — HubSpot could not be read. Try refreshing again.'
};
const time = value => value ? new Date(value).toLocaleString() : 'Not yet';
export default function HubSpotContext({projectId, contact, conversationId}) {
    const access = useCrmAccess(projectId);
    if (!access.allowed) return <section className="crm-panel" aria-label="HubSpot context"><h3>HubSpot</h3><p>CRM context requires a workspace owner or admin with customer management permission. Ask your owner for access.</p></section>;
    return <Context key={JSON.stringify([projectId, contact.id, conversationId, access.identity])} {...{projectId, contact, conversationId}} writable={access.writable}/>;
}
function Context({projectId, contact, conversationId, writable}) {
    // Ticket context always resolves the requester through the server's ticket route.
    const path = conversationId ? `/api/management/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}/crm` : `${crmRoot(projectId)}/contacts/${encodeURIComponent(contact.id)}`;
    const {data, loading, error, notice, run} = useCrmResource(path);
    return <section className="crm-panel" aria-label="HubSpot context" aria-busy={loading}>
        <div className="crm-heading"><h3>HubSpot</h3><span className="text-muted">Read only</span></div>
        <p>{contact.name || contact.provided_name || 'Customer'} · Native customer <span>{contact.id}</span></p>
        {loading && <p role="status">Loading HubSpot context…</p>}
        {error && <p role="alert" className="alert alert-danger">{error} CRM values are hidden. Check your permissions and connection, then check status again.</p>}
        {notice && <p role="status">{notice}</p>}
        {data && <>
            <p role="status">{states[data.state] || states.unavailable}</p>
            <dl className="crm-facts">
                <div><dt>Source account</dt><dd>{data.account_id || 'Not mapped'}</dd></div>
                <div><dt>Source contact ID</dt><dd>{data.source_contact_id || 'Not mapped'}</dd></div>
                <div><dt>Source company ID</dt><dd>{data.source_company_id || 'Not mapped'}</dd></div>
                <div><dt>Last checked</dt><dd>{time(data.checked_at)}</dd></div>
                <div><dt>Last refreshed</dt><dd>{time(data.refreshed_at)}</dd></div>
            </dl>
            {data.context && ['fresh', 'stale'].includes(data.state) && <ContextValues context={data.context}/>}
        </>}
        <div className="crm-actions"><button type="button" className="btn btn-sm btn-white" disabled={loading} onClick={() => run()}>Check CRM status</button>
            {writable && data && !['unmapped', 'disconnected'].includes(data.state) && <button type="button" className="btn btn-sm btn-primary" disabled={loading} onClick={() => run({method: 'POST', suffix: '/refresh'}, 'Refresh checked. See the resulting state above.')}>Refresh HubSpot context</button>}
            <Link to={`/projects/${projectId}/hubspot-settings`}>HubSpot settings</Link>
        </div>
        {conversationId ? <p><Link to={`/projects/${projectId}/contacts/${contact.id}`}>Manage this customer’s mapping</Link></p> : <HubSpotMapping {...{projectId, contact, data, loading, writable, run}}/>}
    </section>;
}
function ContextValues({context}) {
    const fields = context.fields || {}, contact = context.contact, company = context.company;
    return <div className="crm-values">{[['Contact', contact], ['Company', company]].filter(([,record]) => record).map(([label,record]) => <div key={label}><h4>{label} context</h4><dl className="crm-facts">
        {[["Source ID",record.id],["Name",record.properties.name],["Plan",record.properties[fields.plan]],["Entitlement",record.properties[fields.entitlement]],["Owner ID",record.properties.hubspot_owner_id],["Source updated",record.updatedAt]].filter(([label,value]) => label !== 'Name' || value).map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value || 'Not provided'}</dd></div>)}
    </dl></div>)}</div>;
}
