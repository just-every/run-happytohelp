import React, {useRef, useState} from 'react';
import {crmRoot, crmJson, useCrmAccess, useCrmResource} from './useCrmResource';
import './crm.css';

export default function HubSpotConnection({projectId}) {
    const access = useCrmAccess(projectId);
    if (!access.allowed) return <p role="alert">HubSpot requires a workspace owner or admin with customer management permission. Ask your owner for access.</p>;
    return <Connection key={projectId + access.identity} projectId={projectId} writable={access.writable}/>;
}
function Connection({projectId, writable}) {
    const {data, loading, error, notice, denied, run} = useCrmResource(crmRoot(projectId));
    const token = useRef(null), [account, setAccount] = useState(''), [plan, setPlan] = useState(''), [entitlement, setEntitlement] = useState('');
    const [disconnect, setDisconnect] = useState(false);
    const connect = event => {
        event.preventDefault();
        const secret = token.current.value;
        token.current.value = '';
        setDisconnect(false);
        run(crmJson('PUT', {account_id: account, token: secret, properties: {plan, entitlement}}), 'HubSpot connected. Map each customer explicitly; previous mappings were removed.');
    };
    return <section className="workspace-settings crm-panel connections-page" aria-label="HubSpot connection" aria-busy={loading}>
        <h2>Read-only account context</h2>
        <p>HubSpot remains your account system of record. Connect a private app with exactly these scopes:</p>
        <ul><li><code>crm.objects.contacts.read</code></li><li><code>crm.objects.companies.read</code></li></ul>
        <p>Extra scopes are refused. No CRM fields are written, no customers are matched automatically, and CRM mappings never grant customer or ticket access.</p>
        <section aria-label="HubSpot setup instructions"><h3>Get your account ID and token</h3><ol>
            <li>Sign in to the intended HubSpot account as a super admin. Open the account menu in the upper right and copy its numeric Hub ID into HubSpot account ID. It also appears in the account URL; see <a href="https://knowledge.hubspot.com/account-management/manage-multiple-hubspot-accounts">HubSpot’s account guide</a>.</li>
            <li>For a new app, follow <a href="https://developers.hubspot.com/docs/apps/developer-platform/build-apps/create-an-app">HubSpot’s app creation guide</a>: install its CLI, run <code>hs account auth</code>, then <code>hs project create</code>, select App, private distribution and static authentication. In <code>app-hsmeta.json</code>, keep only the two required read scopes listed above, then run <code>hs project upload</code>.</li>
            <li>In HubSpot Development → Projects, open the project and app. On Distribution, use Standard install → Install now and approve those scopes for the intended account. On the app’s Distribution tab, click Show beside the access token and copy it into Private app token below; see <a href="https://developers.hubspot.com/docs/apps/developer-platform/build-apps/manage-apps-in-hubspot#install-an-app-with-a-static-token">HubSpot’s static token instructions</a>.</li>
            <li>Already have a legacy private app? In Development → Legacy apps, open it, check its scopes, then Auth → Show token → Copy. <a href="https://developers.hubspot.com/docs/apps/legacy-apps/private-apps/overview">HubSpot’s legacy app guide</a> covers this path. New legacy private apps can no longer be created.</li>
        </ol><p>Keep the token private. Connecting here verifies the account and scopes before any customer mapping.</p></section>
        {loading && <p role="status">Checking HubSpot connection…</p>}
        {error && <p role="alert" className="alert alert-danger">{error.replace(/[.!?\s]+$/, '')}. Check the account, exact scopes and your current permissions, then try again. Re-enter the private token to reconnect.</p>}
        {notice && <p role="status" className="alert alert-success">{notice}</p>}
        {data && <p role="status">{data.connection?.connected ? `Connected to HubSpot account ${data.connection.account_id}` : 'HubSpot disconnected'}{data.connection?.updated_at && <> · Updated {new Date(data.connection.updated_at).toLocaleString()}</>}</p>}
        <button type="button" className="btn btn-white" disabled={loading} onClick={() => run()}>Check connection</button>
        {denied ? <p role="alert">Connection controls are hidden while access is refused. Ask your owner to restore your permissions, then check the connection again.</p> : !writable ? <p role="alert">Your role needs integrations.install to connect or disconnect HubSpot.</p> : <>
            <form onSubmit={connect} className="crm-form" autoComplete="off">
                <label>HubSpot account ID<input className="form-control" required inputMode="numeric" pattern="[0-9]+" maxLength={200} value={account} onChange={e => setAccount(e.target.value)}/></label>
                <label>Private app token<input ref={token} className="form-control" type="password" required maxLength={10000} autoComplete="new-password"/></label>
                <p className="settings-note">The submitted token is cleared immediately. Connecting again removes every previous mapping.</p>
                <label>Plan property (optional)<input className="form-control" placeholder="support_plan" pattern="[a-z][a-z0-9_]*" maxLength={100} value={plan} onChange={e => setPlan(e.target.value)}/></label>
                <label>Entitlement property (optional)<input className="form-control" placeholder="support_entitlement" pattern="[a-z][a-z0-9_]*" maxLength={100} value={entitlement} onChange={e => setEntitlement(e.target.value)}/></label>
                <p className="settings-note">Use HubSpot internal property names. Leave blank if you do not use these fields.</p>
                <button className="btn btn-primary" disabled={loading}>Connect HubSpot</button>
            </form>
            {data?.connection?.connected && <div className="mt-4">{disconnect ? <><p>Disconnect HubSpot and remove all customer mappings and cached context?</p><div className="crm-actions"><button type="button" className="btn btn-danger" disabled={loading} onClick={async () => {if (await run({method: 'DELETE'}, 'HubSpot disconnected. Mappings and cached context removed.')) setDisconnect(false);}}>Confirm disconnect</button><button type="button" className="btn btn-white" onClick={() => setDisconnect(false)}>Cancel disconnect</button></div></> : <button type="button" className="btn btn-outline-danger" disabled={loading} onClick={() => setDisconnect(true)}>Disconnect HubSpot</button>}</div>}
        </>}
    </section>;
}
