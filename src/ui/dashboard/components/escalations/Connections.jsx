import React from 'react';
import {GitHubConnectionForm, JiraConnectionForm, LinearConnectionForm, SlackConnectionForm} from './ConnectionForms';
import {providerNames} from './api';

const forms = {github: GitHubConnectionForm, linear: LinearConnectionForm, jira: JiraConnectionForm, slack: SlackConnectionForm};

export default function Connections({base, connections, onSaved}) {
    return <details className="escalation-connections">
        <summary>Workspace connections</summary>
        <p className="escalation-hint">Connect each tracker separately. Configure signed webhooks to bring issue updates back to this ticket.</p>
        {Object.entries(forms).map(([provider, ProviderForm]) => {
            const connection = connections.find(item => item.provider === provider);
            return <details key={provider} className="escalation-provider">
                <summary>{providerNames[provider]} <span className="escalation-hint">{connection?.connected ? 'Connected' : 'Not connected'}</span></summary>
                {connection?.connected && <p className="escalation-hint">Connected to <strong>{connection.target}</strong></p>}
                {connection?.webhook_url && <div className="escalation-webhook"><span>Webhook endpoint</span><code>{connection.webhook_url}</code></div>}
                <ProviderForm base={base} onSaved={onSaved}/>
            </details>;
        })}
    </details>;
}
