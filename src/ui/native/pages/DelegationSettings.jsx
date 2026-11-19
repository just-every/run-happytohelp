import React, { useCallback, useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useDashboardLocation } from '../dashboard-state';
import { Section } from './forms';
import DelegationExits from './DelegationExits';
import CopyCommand from '../setup-help/CopyCommand';
import '../setup-help/setup-help.css';
import { dateTime, failureMessage, postDelegationForm, readDelegation, scopeLabels } from './delegation-shared';

const statusOf = grant => grant.revokedAt ? 'revoked' : grant.expiresAt <= Date.now() ? 'expired' : 'active';

function Grants({ grants, onRevoke, busy }) {
    if (!grants.length) return <p className="delegation-page__empty">No applications have access yet. When you approve a request from a registered application, it is listed here, where you can revoke it at any time.</p>;
    return <ul className="delegation-grants">{grants.map(grant => {
        const status = statusOf(grant);
        return <li className="delegation-grant" key={grant.id}>
            <div className="delegation-grant__head"><h3>{grant.clientId}</h3><span className={`delegation-grant__status is-${status}`}>{status}</span></div>
            <p className="delegation-grant__meta">Expires {dateTime(grant.expiresAt)}</p>
            <ul className="delegation-grant__list">{grant.scopes.map(scope => <li key={scope}>{scopeLabels[scope] || scope}<code>{scope}</code></li>)}</ul>
            <ul className="delegation-grant__list delegation-grant__targets">{grant.targets.map(target => <li key={target}><code>{target}</code></li>)}</ul>
            {!grant.revokedAt && <button type="button" className="btn btn-white btn-sm" disabled={busy} onClick={() => onRevoke(grant)}>Revoke</button>}
        </li>;
    })}</ul>;
}

/** What a connected application is, why you would add one, and the values the application needs from this workspace. */
function About({ projectId, workspaceName }) {
    return <div className="sh-steps mb-4 delegation-about">
        <p><b>What a connected application is</b></p>
        <p>Another app you run that may read some of this workspace, but only after a person here approves it. Today that app is <b>Slate</b>, the open-source team wiki made alongside HappyToHelp (<a href="https://github.com/just-every/run-slate" target="_blank" rel="noreferrer">github.com/just-every/run-slate</a>). Connected, a specialist can start an investigation from a conversation (“Investigate with Slate” in its side panel), Slate reads that conversation and your help articles, and it can correct an outdated article. Customer replies stay in HappyToHelp; Slate never answers a customer.</p>
        <p>You do not need this to use HappyToHelp. Add one only if you run Slate.</p>
        <ol>
            <li>Open <b>Developer values</b> to copy the Slate settings for <b>{workspaceName}</b>.
                <details>
                    <summary>Developer values</summary>
                    <p>Paste these into Slate’s settings. When running Slate on your computer, add <code>SLATE_</code> to the start of each name in Slate’s <code>.dev.vars</code> file.</p>
                    <CopyCommand tooltipLabel="Copy Slate settings" text={`HAPPYTOHELP_DELEGATION_ORIGIN=${typeof window === 'undefined' ? '' : window.location.origin}\nHAPPYTOHELP_DELEGATION_ACCOUNT_ID=${projectId}\nHAPPYTOHELP_DELEGATION_CLIENT_ID=slate`}/>
                </details>
            </li>
            <li>Register Slate below with the same Client identifier (<code>slate</code>), its address and its callback URL.</li>
            <li>In Slate, start the connection. HappyToHelp shows what Slate asks to read or change; choose <b>Allow selected access</b>. Access lasts 30 days and is listed under “Access you have granted”, where you can revoke it.</li>
        </ol>
        <p className="sh-note">Every field and permission explained: <a href="/docs/connected-applications">Connected applications guide</a>.</p>
    </div>;
}

function ClientForm({ projectId, onRegistered }) {
    const [error, setError] = useState(''), [pending, setPending] = useState(false);
    const submit = async event => {
        event.preventDefault();
        const form = event.currentTarget, data = new FormData(form);
        setPending(true); setError('');
        try {
            await postDelegationForm('/delegation/settings/clients', {
                account_id: projectId, id: data.get('id'), origin: data.get('origin'), redirect_uri: data.get('redirect_uri'),
                ...(data.get('allow_loopback') ? { allow_loopback: '1' } : {}),
            });
            form.reset();
            await onRegistered(String(data.get('id')));
        } catch (failure) { setError(failureMessage(failure)); } finally { setPending(false); }
    };
    return <form className="delegation-client-form" onSubmit={submit}>
        {error && <div role="alert" className="alert alert-danger">{error}</div>}
        <div className="form-group"><label className="form-label" htmlFor="client-id">Client identifier</label>
            <input id="client-id" name="id" className="form-control" required maxLength={200} aria-describedby="client-id-help"/>
            <div id="client-id-help" className="form-text">A short name you choose for this application, for example <code>slate</code>. Put the same name in the application’s own settings (for Slate, <code>HAPPYTOHELP_DELEGATION_CLIENT_ID</code>).</div></div>
        <div className="form-group"><label className="form-label" htmlFor="client-origin">Slate origin</label>
            <input id="client-origin" name="origin" type="url" className="form-control" required placeholder="https://wiki.example.com" aria-describedby="client-origin-help"/>
            <div id="client-origin-help" className="form-text">The address you open the application at, with nothing after the host: for example <code>https://wiki.example.com</code>, not <code>https://wiki.example.com/app</code>. An address that ends a request’s approval anywhere else is refused.</div></div>
        <div className="form-group"><label className="form-label" htmlFor="client-callback">Exact callback URL</label>
            <input id="client-callback" name="redirect_uri" type="url" className="form-control" required placeholder="https://wiki.example.com/api/connectors/oauth/happytohelp/callback" aria-describedby="client-callback-help"/>
            <div id="client-callback-help" className="form-text">The page HappyToHelp sends you back to after you approve, so the application learns it may connect. It must be on the address above and match the application’s setting character for character. For Slate it is the Slate address followed by <code>/api/connectors/oauth/happytohelp/callback</code>.</div></div>
        <div className="form-check"><input id="client-loopback" name="allow_loopback" type="checkbox" value="1" className="form-check-input"/>
            <label className="form-check-label" htmlFor="client-loopback">Allow loopback development</label>
            <div className="form-text">Turn on only while you try an application running on this same computer (for example Slate started with <code>rer dev</code> at <code>http://127.0.0.1:8787</code>): it accepts plain <code>http://</code> addresses on <code>localhost</code> and <code>127.0.0.1</code>. Leave it off for an application on the internet, which must use <code>https://</code>.</div></div>
        <button className="btn btn-primary" disabled={pending}>Register client</button>
    </form>;
}

/** Connected applications for one project: what each application may read or change, and who can register one. */
export default function DelegationSettings({ projectId, projects }) {
    const location = useDashboardLocation(), cancelled = location.search?.cancelled != null;
    const [state, setState] = useState({ loading: !!projectId, data: null, error: '' }), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
    const load = useCallback(() => readDelegation(`/delegation/settings/data?account_id=${encodeURIComponent(projectId)}`)
        .then(data => setState({ loading: false, data, error: '' }))
        .catch(error => setState({ loading: false, data: null, error: failureMessage(error) })), [projectId]);
    useEffect(() => { if (projectId) { setState({ loading: true, data: null, error: '' }); load(); } }, [projectId, load]);
    if (!projectId) return <div className="workspace-settings delegation-page">
        <Section title="Choose a workspace" description="Connected applications belong to a workspace. Choose which one to review.">
            <ul className="delegation-projects">{Object.values(projects || {}).map(project => <li key={project.id}>
                <Link to="/delegation/settings" search={{ account_id: project.id }}>{project.name}</Link></li>)}</ul>
            <DelegationExits settings={false}/>
        </Section></div>;
    const revoke = async grant => {
        setBusy(true); setNotice('');
        try { await postDelegationForm('/delegation/settings/revoke', { account_id: projectId, id: grant.id }); await load(); }
        catch (failure) { setState(current => ({ ...current, error: failureMessage(failure) })); } finally { setBusy(false); }
    };
    const { loading, data, error } = state;
    return <div className="workspace-settings delegation-page">
        {cancelled && <div role="status" className="alert alert-secondary">Connection cancelled. No access was granted.</div>}
        {notice && <div role="status" className="alert alert-success">{notice}</div>}
        {error && <><div role="alert" className="alert alert-danger">{error}</div><DelegationExits projectId={projectId} settings={false}/></>}
        {loading && <p role="status" aria-busy="true">Loading connected applications…</p>}
        {data && <>
            <About key={projectId} projectId={projectId} workspaceName={projects?.[projectId]?.name || 'this workspace'}/>
            <Section title="Access you have granted" description="Applications you have approved to work with this workspace. Revoking stops the application immediately.">
                <Grants grants={data.grants} onRevoke={revoke} busy={busy}/>
            </Section>
            <Section title="Registered applications" description="Only registered applications can ask for access. The callback address is fixed when you register it.">
                {data.clients.length ? <ul className="delegation-clients">{data.clients.map(client => <li key={client.id}><strong>{client.id}</strong> — {client.origin} — {client.redirectUri}</li>)}</ul>
                    : <p className="delegation-page__empty">No applications are registered.</p>}
                {data.canRegister ? <ClientForm projectId={projectId} onRegistered={id => { setNotice(`Registered ${id}.`); return load(); }}/>
                    : <p className="delegation-page__empty">Owners and admins can register applications.</p>}
            </Section>
        </>}
    </div>;
}
