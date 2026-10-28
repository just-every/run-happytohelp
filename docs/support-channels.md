# Support channels

Settings → **Support channels** connects text support from Twilio US SMS,
WhatsApp Business, Instagram Direct, Facebook Messenger and explicitly allowed
Slack customer channels to the shared inbox. This is an implementation for
qualification. Connected-account acceptance remains pending. Teams support apps,
live provider qualification remain pending. Supported attachments and approved
text utility templates are available for qualification.

## Connect an account

An owner or administrator with integration installation permission confirms their
recent sign-in, installs the provider app, then enters its account ID, sender ID,
access token and signing secret. Tokens are encrypted with the existing
installation integration key. Readback never returns them. The verification token
appears once; copy it into Meta's webhook verification configuration and dismiss
it. Configure the displayed HTTPS webhook URL with the provider.

For Twilio, supply a US +1 sender and its Account SID. The signing secret is that
account's auth token. Confirm that the provider has completed A2P 10DLC
registration. The checkbox records the administrator's attestation; it does not
verify or complete carrier registration. Configure Twilio's inbound webhook for
form-encoded POSTs. Delivery callbacks must return to this connection's webhook.

For Meta, use an authorized business account and page or WhatsApp phone-number ID,
its authorized access token and the app secret. Webhooks must include the exact
account and recipient identity configured here. Subscribe to the relevant message
and delivery events. A configured connection alone does not prove provider
permissions, delivery, customer consent or business approval.

For Slack, install a bot in the customer workspace and selected shared channels.
Enter its team ID, bot user ID, bot token, signing secret and an explicit list of
customer channel IDs. Subscribe to message events for those channels. Text intake
requires `channels:history` and replies require `chat:write`; private-channel
intake is not enabled. Authenticated file intake requires `files:read`.
Slack notification settings are a separate feature. This connection does not yet
install the app through OAuth or verify the granted scopes against Slack.

## Inbox and delivery

Provider-scoped customer identities create separate contacts; an unverified
channel identity never merges into an email contact. Slack replies stay in their
original thread. Open the ticket's **Support channel** section for its source,
blocker and recorded send outcomes. Public replies and supported attachments return in the original
channel. Private notes never enter that sending path. Automatic AI, email and away
reply effects are suppressed for these channel conversations.

A durable message claim precedes a provider send. Redelivery of the same signed
message does not create a second message. A saved public reply with an unknown
provider outcome is never automatically replayed, including after process
recovery. Check the provider before any deliberately new reply. **Accepted** means
provider acceptance, not customer delivery. Settings includes counts of accepted,
failed, blocked and unknown sends. SMS and WhatsApp status callbacks can advance
recorded delivery outcomes; Instagram/Messenger delivery/read callbacks also advance matching sends.

SMS and WhatsApp STOP/UNSUBSCRIBE messages prevent further sends. Teammates cannot
override opt-out. A verified provider opt-in recovery flow is still pending, so
reconnecting does not reset consent. Meta free-text replies are refused after the
24-hour customer reply window. Wait for a new customer message, or explicitly choose a currently approved text-only
UTILITY template in the ticket. Continuation requires the customer to have sent
“I agree to WhatsApp support updates” through the signed WhatsApp webhook. STOP
remains fenced, including after another consent phrase or reconnect. The template
is checked against the connected account at send time; marketing, authentication,
and media/interactive templates are excluded. Sending it does not reopen the
free-text window. There is no automatic switch to email, another number or channel.

Supported attachments are downloaded from approved provider hosts into private
conversation storage, with no arbitrary redirects, a 10 MB per-file limit and at
most five inbound files. Unsupported, oversized or unavailable files explicitly
refuse the event for review. Outbound files use one-hour grants fenced by current
connection, conversation and erasure authority. Social channels accept one file
per reply; Messenger/Instagram attachments and audio must be sent separately from
text where the provider does not support captions. Revoke invalidates grants. Slack edited/deleted and other
noncustomer subtypes are held with an audit record; they do not rewrite the
canonical transcript. Acknowledgment, assignment and handoff from Slack/Teams,
account/company mapping and bidirectional status synchronization are pending.

## Revoke, erase and restore

Revoke removes local credentials and refuses new intake/sends. A request already
accepted by a provider cannot be recalled. Reconnecting the same account preserves
thread identities, opt-out and erasure fences. Erasing a contact removes local
channel identity links and blocks historical redelivery from recreating it. It
also records explicit external-provider deletion work; local erasure does not
claim to delete provider copies.

Archives preserve channel mappings and erasure fences, omit credentials and
verification grants, disconnect restored connections and mark in-flight sends
uncertain. Reconfigure provider credentials explicitly after restore. Apply
migrations `250_support_channels.sql` and `251_support_channel_media.sql` before serving the updated Worker; back up
D1, R2 and private configuration first, and retain the existing migration ledger.
