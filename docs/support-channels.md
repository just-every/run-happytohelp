# Support channels

Settings → **Support channels** connects Twilio US SMS, WhatsApp Business,
Instagram Direct, Facebook Messenger, Slack Connect and Microsoft Teams to the
shared inbox. Code and network-edge tests are available for qualification.
Connected-account sandbox acceptance remains pending for every provider.

## Connect an account

An owner or administrator installs the provider app, confirms recent sign-in,
and supplies the account, sender and private credentials. Credentials are
encrypted and never read back. Configure the displayed HTTPS webhook with the
provider. Meta's verification token appears once. Reconnect rotates credentials
on the same connection, preserving thread identities, opt-out and erasure fences.

For Twilio, enter the Account SID, US +1 sender, auth token and Messaging Service
ID. Installation checks that the sender belongs to the account's service and that
Twilio reports a VERIFIED US A2P campaign. This does not perform carrier
registration or replace live deliverability qualification. Delivery callbacks
return to the connection's webhook.

For Meta, use the authorized business account and page or WhatsApp phone-number
ID, its access token and app signing secret. Subscribe to message and delivery
callbacks. Signature verification and the exact configured account/recipient are
required. The provider still owns business authorization and consent qualification.

For Slack, install a bot with `chat:write`, `channels:history`, `files:read` and
`im:history`; subscribe to shared-channel and direct-message events. Installation
checks its team/bot identity, scopes and membership in each active Slack Connect
channel. Enter allowed customer channel IDs explicitly. Slack notifications are
a separate feature and do not provide support intake.

For Teams, install a single-tenant Bot Framework app in the customer tenant and
allowed customer channels. Supply its tenant ID, bot application ID and client
secret. Configure the webhook as its messaging endpoint and enable personal scope
for private teammate linking. Incoming activities require Microsoft's RS256
signature, the configured app audience, issuer, expiry, signed service URL and
matching tenant. Replies use tenant-scoped client credentials and the original
conversation. Live app consent, installation and channel accessibility must still
be qualified in the provider sandbox.

## Reply and continue

Provider-scoped identities stay separate from unverified email identities. Shared
channel participants retain distinct attribution; the original requester stays
on the ticket. Owners map each customer channel to an existing company in
Settings. New requester identities inherit that explicit mapping. Existing
threads cannot silently be reassigned to another account.

Public replies return in the original channel. Internal notes, email, automatic
AI and away replies never enter the channel sending path. The ticket's **Support
channel** section shows blockers, delivery and status-post outcomes. **Accepted**
means provider acceptance, not customer delivery. SMS/WhatsApp callbacks and
social delivery/read events advance the matching send. A durable claim precedes
each send; unknown outcomes never replay automatically. Review the provider's
record before deliberately composing another reply.

SMS and WhatsApp STOP/UNSUBSCRIBE messages fence further sends across reconnects.
Only an authenticated START (or carrier-confirmed opt-in) from the subscriber
restores support replies to that number in that channel. Each STOP, START and
continuation agreement retains its provider event ID and timestamp as a new
consent fact. A later STOP wins; replaying an older START cannot restore consent.
Teammates, reconnects, restores and imports cannot grant consent. Replies already
queued at STOP, and replies queued during opt-out, stay blocked or cancelled for
human review after START. HELP receives an informational answer without changing
consent; Twilio-handled HELP is not answered a second time. Meta free-text replies expire after
24 hours. Wait for a new customer message, or deliberately choose a currently
approved WhatsApp text-only UTILITY template. The customer must first send
“I agree to WhatsApp support updates” in WhatsApp. The signed customer event is
recorded as continuation consent only while no opt-out fence exists. STOP takes
precedence even after START or another consent phrase; START restores support
replies only and never restores continuation consent. The template is checked against the
connected account at send time; marketing/authentication and media/interactive
templates are excluded. Sending a template does not reopen free-text replies.
There is no automatic cross-channel continuation.

## Attachments and shared-channel work

Supported image, audio, video, PDF and plain-text attachments use private native
media storage. Download origins are limited to the connected provider; credentials
never follow arbitrary redirects. Twilio's media CDN redirect is checked and gets
no account credential. Each file is limited to 10 MB, with at most five inbound
files. Teams supports Bot Framework inline image attachments. Unsupported or
unavailable attachments explicitly refuse the provider event for review.

Outbound files use one-hour grants bound to the message, conversation, active
connection and allowed channel. Revoke, credential rotation, channel removal and
erasure invalidate access. Social replies support one file each; where a provider
cannot accept a caption, send the file separately from text. Private-note files
cannot enter a public reply or download grant.

In a shared-channel ticket, choose **Link my teammate identity**, then send the
one-use code privately to the installed bot within ten minutes. The code requires
a current native session and membership; display names and email matches never
grant teammate authority. Unlink from the same ticket. Linked teammates can reply
in the provider thread, including supported attachments, or use:

- `support acknowledge` — take responsibility and open the ticket.
- `support assign provider-user-id` — assign to a linked workspace teammate.
- `support handoff provider-user-id` — transfer responsibility to a linked teammate.
- `support status` — post current public status and whether a teammate is responsible.

Commands are permission-checked again at the canonical ticket write. Assignment
and status changes from the inbox also post the current public state. Private
notes and internal group details are excluded. Duplicate events/actions do not
repeat messages or sends. Failed or uncertain status posts are visible in the
ticket and are not automatically replayed.

Attributed provider edits/deletions appear as notices in the ticket alongside
the retained original support record. They do not silently rewrite history.
Notices identify the original canonical author and provider event time. Attachment
changes are explicitly held for review without replacing the original files.
Events without an attributable original are held. Customer erasure removes the retained content and notices. Provider
delete-for-everyone and provider-terms erasure obligations remain an explicit
qualification gap; retaining a support record does not assert compliance with
those obligations.

## Revoke, erase and restore

Revoke removes credentials, invalidates attachment grants and refuses new
intake/sends. A request already accepted by the provider cannot be recalled.
Contact erasure removes local channel identity links and media, fences historical
redelivery (including shared participants), and records external provider deletion
work. Local erasure does not claim to remove provider copies.

Archives omit credentials, verification grants, identity-link codes and temporary
attachment grants. Restored connections are disconnected; in-flight message/status
sends become uncertain. Reconfigure credentials explicitly. Back up D1, R2 and
private configuration and apply migrations 250, 251, 252 and 253 in order before serving
the updated Worker, without resetting or editing the existing migration ledger.
