import React from 'react';

const Link = ({href, children}) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
const randomSecret = <code>openssl rand -hex 32</code>;

/** Setup belongs beside the credential fields; these links are the provider's own guides. */
export default function ConnectionSetup({provider,base}) {
    if (provider === 'github') return <div className="escalation-setup">
        <p>You need repository administration access to register its webhook. This connection is separate from GitHub knowledge OAuth.</p>
        <ol>
            <li>Open the repository on GitHub. Copy its owner and repository name from the URL as <code>owner/repository</code>.</li>
            <li>Follow GitHub’s <Link href="https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens">personal access token guide</Link>: Settings → Developer settings → Personal access tokens → Fine-grained tokens. Choose the resource owner and only this repository. Grant repository Issues read and write; Metadata read is included. Choose an expiry, generate and copy the token. Obtain organization approval if required.</li>
            <li>Generate a private random webhook secret with {randomSecret}. Paste it and the token below. Keep the API base URL as <code>https://api.github.com</code> and save to reveal this connection’s Webhook endpoint.</li>
            <li>In the repository’s Settings → Webhooks → Add webhook, paste that endpoint as Payload URL, select <code>application/json</code>, paste the same secret, select Issues events and activate. See <Link href="https://docs.github.com/en/webhooks/using-webhooks/creating-webhooks">creating a webhook</Link>. GitHub signs raw payloads as <code>X-Hub-Signature-256: sha256=…</code>; see <Link href="https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries">signature validation</Link>.</li>
        </ol>
    </div>;
    if (provider === 'linear') return <div className="escalation-setup">
        <ol>
            <li>In Linear Settings → Security &amp; access, create a personal API key with access to the intended team and permission to read issues, create issues and create comments. Copy it securely. See the <Link href="https://linear.app/developers/graphql">Linear API guide</Link>.</li>
            <li>To get the team UUID, use Linear’s Copy model UUID command for the team, or run <code>{'query { teams { nodes { id name } } }'}</code> in Linear’s GraphQL explorer using that key. Match the team name and copy its <code>id</code>; the short team key is not its UUID.</li>
            <li>Generate a temporary private signing secret with {randomSecret}. Save it with the team UUID, API key and the default <code>https://api.linear.app</code> API base URL to reveal the Webhook endpoint. This temporary value only lets you save the connection; it cannot validate Linear deliveries.</li>
            <li>As a Linear workspace administrator, open Settings → API → Webhooks, create a webhook using that endpoint, choose the same team and Issues resource. Open the webhook’s detail page and copy its signing secret. Replace the temporary secret below, re-enter the same API key and save again; the endpoint stays the same. Linear supplies <code>Linear-Signature</code> as a hexadecimal HMAC-SHA256 digest of the raw body. Follow <Link href="https://linear.app/developers/webhooks">Linear webhook setup and signing</Link>.</li>
        </ol>
    </div>;
    if (provider === 'jira') return <div className="escalation-setup">
        <ol>
            <li>Open your Jira Cloud site and the project’s settings/details. Copy the project key (the prefix before the number in its issue keys) and your site origin, such as <code>https://your-team.atlassian.net</code>. The project must support Task issues. Your account needs Browse projects, Create issues and Add comments there.</li>
            <li>Follow Atlassian’s <Link href="https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/">email and API token guide</Link> to create an API token in your Atlassian account security settings. Use a token without scopes for the site-based REST API used here; scoped tokens requiring the Atlassian gateway are not supported by this form. Paste your account email and token below.</li>
            <li>Generate a private webhook secret with {randomSecret}, paste it below and save to reveal the Webhook endpoint. As a Jira administrator, open System → Webhooks, create a webhook with that URL, filter to your project and subscribe to issue created, updated and deleted events. Set its Secret to the same value.</li>
            <li>See <Link href="https://developer.atlassian.com/cloud/jira/platform/webhooks/">Jira webhook registration and secure deliveries</Link>. This receiver requires <code>X-Hub-Signature: sha256=…</code> over the raw body. Unsigned hooks and OAuth JWT callbacks are not accepted.</li>
        </ol>
    </div>;
    if (provider === 'slack') return <div className="escalation-setup">
        <ol>
            <li>Use Slack’s <Link href="https://docs.slack.dev/quickstart/">app quickstart</Link> to create an app for your workspace. Under OAuth &amp; Permissions → Bot Token Scopes, add <Link href="https://docs.slack.dev/reference/scopes/chat.write/"><code>chat:write</code></Link>, install the app to the workspace and approve access. Copy its Bot User OAuth Token into the password field below.</li>
            <li>Open the destination channel, open its details and copy the channel ID. Invite the app to that channel, including private channels. Paste the ID below and keep the API base URL as <code>https://slack.com</code>, then save.</li>
            <li>This connection posts selected support context and reads back the message permalink. It has no inbound callback or signing secret, and needs no OAuth redirect URL or Events API setup here. Separate Slack notifications are configured in <Link href={base.replace('/api/escalations', '') + '/slack-settings'}>Slack settings</Link>.</li>
        </ol>
    </div>;
    return <div className="escalation-setup">
        <ol>
            <li>Follow Microsoft’s <Link href="https://learn.microsoft.com/en-us/graph/auth-v2-user">delegated access token guide</Link>. In Microsoft Entra, register an application in your work/school tenant. Record its tenant and application/client IDs. Add Microsoft Graph delegated <code>ChannelMessage.Send</code> permission; obtain consent and sign in as a member who can post to the channel.</li>
            <li>Register your own OAuth client’s redirect URI, authorize with that exact URI and exchange the returned code for a Microsoft Graph access token as the guide describes. Any client secret stays in your OAuth client. Paste only the access token here. This form does not host an OAuth callback or refresh tokens; replace the token when it expires. App-only migration tokens and incoming webhook URLs cannot send ordinary messages here. See <Link href="https://learn.microsoft.com/en-us/graph/api/channel-post-messages?view=graph-rest-1.0">channel message permissions</Link>.</li>
            <li>In Teams, choose Get link to channel. Its <code>groupId</code> is the team UUID; decode the channel identifier after <code>/l/channel/</code> in that link. Enter <code>team UUID / channel ID</code> below. You can also use Microsoft’s <Link href="https://learn.microsoft.com/en-us/graph/api/channel-list?view=graph-rest-1.0">list channels guide</Link> to read the channel <code>id</code> (that lookup separately needs its documented read permission).</li>
            <li>Keep the API base URL as <code>https://graph.microsoft.com</code> and save. This sends a selected-context handoff only; no inbound webhook or signing secret is needed.</li>
        </ol>
    </div>;
}
