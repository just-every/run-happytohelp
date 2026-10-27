import React, {useId, useState} from 'react';
import {escalationWrite} from './api';

function CredentialForm({base, provider, name, targetLabel, targetPlaceholder, tokenLabel, defaultUrl, children, onSaved}) {
    const id = useId();
    const [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false);
    const submit = async event => {
        event.preventDefault();
        const form = event.currentTarget;
        const fields = new FormData(form);
        const payload = {provider, target: fields.get('target').trim(), token: fields.get('token'), base_url: fields.get('base_url').trim()};
        if (!['slack', 'teams'].includes(provider)) payload.webhook_secret = fields.get('webhook_secret');
        if (provider === 'jira') payload.email = fields.get('email').trim();
        // Credentials are uncontrolled inputs, cleared before waiting on the request.
        form.querySelectorAll('input[type="password"]').forEach(input => { input.value = ''; });
        setBusy(true); setError(''); setSaved(false);
        try {
            await escalationWrite(`${base}/connections`, payload);
            setSaved(true);
            await onSaved();
        } catch (failure) { setError(failure.message); }
        finally { setBusy(false); }
    };
    return <form className="escalation-form" onSubmit={submit}>
        <fieldset disabled={busy}>
            <legend className="visually-hidden">Connect {name}</legend>
            <label htmlFor={`${id}-target`}>{targetLabel}</label>
            <input className="form-control form-control-sm" id={`${id}-target`} name="target" placeholder={targetPlaceholder} required autoComplete="off"/>
            {children && <div className="escalation-field">{React.cloneElement(children, {id: `${id}-email`})}</div>}
            <label htmlFor={`${id}-token`}>{tokenLabel}</label>
            <input className="form-control form-control-sm" id={`${id}-token`} name="token" type="password" required autoComplete="new-password"/>
            {!['slack', 'teams'].includes(provider) && <><label htmlFor={`${id}-secret`}>{name} webhook signing secret</label>
                <input className="form-control form-control-sm" id={`${id}-secret`} name="webhook_secret" type="password" required autoComplete="new-password"/></>}
            <label htmlFor={`${id}-url`}>{provider === 'jira' ? 'Jira site URL' : `${name} API base URL`}</label>
            <input className="form-control form-control-sm" id={`${id}-url`} name="base_url" type="url" defaultValue={defaultUrl} placeholder={provider === 'jira' ? 'https://your-team.atlassian.net' : undefined} required/>
            <p className="escalation-hint">Credentials are stored as workspace secrets and never shown again. Saving replaces this workspace’s {name} connection.</p>
            <button type="submit" className="btn btn-sm btn-outline-secondary">{busy ? 'Saving…' : `Save ${name} connection`}</button>
        </fieldset>
        {error && <p className="escalation-error" role="alert">{error}</p>}
        {saved && <p className="escalation-hint" role="status">{name} connection saved. Secret fields cleared.</p>}
    </form>;
}

function JiraEmail({id}) {
    return <><label htmlFor={id}>Atlassian account email</label><input className="form-control form-control-sm" id={id} name="email" type="email" autoComplete="off" required/></>;
}

export function GitHubConnectionForm(props) {
    return <CredentialForm {...props} provider="github" name="GitHub" targetLabel="Repository (owner/repository)" targetPlaceholder="your-team/product" tokenLabel="GitHub access token with Issues read and write permission" defaultUrl="https://api.github.com"/>;
}

export function LinearConnectionForm(props) {
    return <CredentialForm {...props} provider="linear" name="Linear" targetLabel="Linear team UUID" targetPlaceholder="Team UUID" tokenLabel="Linear API key" defaultUrl="https://api.linear.app"/>;
}

export function JiraConnectionForm(props) {
    return <CredentialForm {...props} provider="jira" name="Jira" targetLabel="Jira project key" targetPlaceholder="SUP" tokenLabel="Atlassian API token" defaultUrl=""><JiraEmail/></CredentialForm>;
}

export function SlackConnectionForm(props) {
    return <CredentialForm {...props} provider="slack" name="Slack" targetLabel="Default Slack channel ID" targetPlaceholder="C0123456789" tokenLabel="Slack bot token with chat:write permission" defaultUrl="https://slack.com"/>;
}

export function TeamsConnectionForm(props) {
    return <CredentialForm {...props} provider="teams" name="Teams" targetLabel="Team UUID and channel ID" targetPlaceholder="Team UUID then a slash then channel ID" tokenLabel="Microsoft Graph token with ChannelMessage.Send permission" defaultUrl="https://graph.microsoft.com"/>;
}
