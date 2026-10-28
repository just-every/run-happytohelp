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
    if (!access.allowed) return null;
    return <ConnectedContext key={projectId + access.identity} {...{projectId, contact, conversationId}} writable={access.writable}/>;
}
function ConnectedContext(props) {
    const {data, denied} = useCrmResource(crmRoot(props.projectId));
    if (denied || !data?.connection?.connected) return null;
    return <Context key={JSON.stringify([props.contact.id, props.conversationId, props.contact.email])} {...props}/>;
}

function Context({projectId, contact, conversationId, writable}) {
    // Ticket context always resolves the requester through the server's ticket route.
    const path = conversationId ? `/api/management/projects/${encodeURIComponent(projectId)}/conversations/${encodeURIComponent(conversationId)}/crm` : `${crmRoot(projectId)}/contacts/${encodeURIComponent(contact.id)}`;
    const {data, loading, error, notice, denied, run} = useCrmResource(path);
    return <section className="crm-panel" aria-label="HubSpot context" aria-busy={loading}>
        <div className="crm-heading"><h3>HubSpot</h3><span className="text-muted">Read only</span></div>
        <p>{contact.name || contact.provided_name || 'Customer'}</p>
        {loading && <p role="status">Loading HubSpot context…</p>}
        {error && <p role="alert" className="alert alert-danger">{error.replace(/[.!?\s]+$/, '')}. CRM values are hidden. Check your permissions and connection, then check status again.</p>}
        {data && <>
            <p role="status">{states[data.state] || states.unavailable}</p>
            <details><summary>HubSpot source identifiers</summary><dl className="crm-facts">
                <div><dt>Source account</dt><dd>{data.account_id || 'Not mapped'}</dd></div>
                <div><dt>Source contact ID</dt><dd>{data.source_contact_id || 'Not mapped'}</dd></div>
                <div><dt>Source company ID</dt><dd>{data.source_company_id || 'Not mapped'}</dd></div>
            </dl></details><dl className="crm-facts">
                <div><dt>Last checked</dt><dd>{time(data.checked_at)}</dd></div>
                <div><dt>Last refreshed</dt><dd>{time(data.refreshed_at)}</dd></div>
            </dl>
            {data.context && ['fresh', 'stale'].includes(data.state) && <ContextValues context={data.context}/>}
        </>}
        {notice && <p role="status">{notice}</p>}
        <div className="crm-actions"><button type="button" className="btn btn-sm btn-white" disabled={loading} onClick={() => run()}>Check CRM status</button>
            {writable && data && !['unmapped', 'disconnected'].includes(data.state) && <button type="button" className="btn btn-sm btn-primary" disabled={loading} onClick={() => run({method: 'POST', suffix: '/refresh'}, 'Refresh checked. The current HubSpot state is shown above.')}>Refresh HubSpot context</button>}
            <Link className="crm-link" to={`/projects/${projectId}/hubspot-settings`}>HubSpot settings</Link>
        </div>
        {!denied && (conversationId ? <p><Link className="crm-link" to={`/projects/${projectId}/contacts/${contact.id}`}>Manage this customer’s mapping</Link></p> : <HubSpotMapping {...{projectId, contact, data, loading, writable, run}}/>)}
    </section>;
}
function ContextValues({context}) {
    const fields = context.fields || {}, contact = context.contact, company = context.company;
    return <div className="crm-values">{[['Contact', contact], ['Company', company]].filter(([,record]) => record).map(([label,record]) => <div key={label}><h4>{label} context</h4><dl className="crm-facts">
        {[["Source ID",record.id],["Name",record.properties.name],["Plan",record.properties[fields.plan]],["Entitlement",record.properties[fields.entitlement]],["HubSpot owner ID",record.properties.hubspot_owner_id],["Source updated",time(record.updatedAt)]].filter(([label,value]) => label !== 'Name' || value).map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value || 'Not provided'}</dd></div>)}
    </dl></div>)}</div>;
}
