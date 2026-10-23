# Workspace API

A workspace owner or admin creates a named token in Settings → API tokens.
The seven scopes are `conversations:read`, `conversations:write`, `messages:write`,
`contacts:read`, `contacts:write`, `articles:read`, and `articles:write`. Token
secrets are shown once and stored only as hashes; Settings shows last use and
audit, expiry and revoke controls. The thirteen operations below retain native
workspace/role and erasure boundaries. Select only the needed scopes;
copy the secret once. Tokens belong to the workspace and continue to work when
the issuing person leaves. Revoke tokens in Settings. Optional expiry is UTC.
Every request uses an explicit bearer token. Cookies do not authenticate this
API, and it emits no CORS permissions. The default limit is 120 requests per
minute per token, configurable with `RATE_LIMITS.apiRequestsPerTokenMinute`.
Failures are JSON `{ "error": { "code": "…", "message": "…" } }`; missing or
expired credentials return 401, missing scope 403, foreign or missing resource
IDs 404, changed conversation/authority 409, and rate limits 429 with Retry-After.
Times are ISO 8601. List results contain `data` and `next_cursor`; pass the latter
as `cursor` with the same filters. `limit` is 1–100 (default 50). Conversation
status is `open`, `resolved` or `all`; `updated_since` is inclusive and `tag` is
an exact workspace tag ID or name. Order is descending time then ID; message
lists order by descending revision then ID. Cursors bind workspace and filters.

The examples use `H2H_URL`, `H2H_TOKEN`, `CONVERSATION_ID`, `CONTACT_ID`,
`ARTICLE_ID`, and the conversation's current integer `REVISION`. Supply those
values in your shell environment. Token headers enter curl through standard
input, so the token is not a command argument. Do not enable shell tracing.

List conversations (`conversations:read`):

```sh
curl --silent --show-error --config - "$H2H_URL/api/v1/conversations?status=open&limit=25" <<EOF_CURL
header = "Authorization: Bearer $H2H_TOKEN"
EOF_CURL
```

Get a conversation (`conversations:read`):

```sh
curl --silent --show-error --config - "$H2H_URL/api/v1/conversations/$CONVERSATION_ID" <<EOF_CURL
header = "Authorization: Bearer $H2H_TOKEN"
EOF_CURL
```

List messages (`conversations:read`):

```sh
curl --silent --show-error --config - "$H2H_URL/api/v1/conversations/$CONVERSATION_ID/messages" <<EOF_CURL
header = "Authorization: Bearer $H2H_TOKEN"
EOF_CURL
```

Reply (`messages:write`). Read the current revision before sending. Keep the same
localId and identical command when checking an uncertain request; a conflicting
command returns 409. Replies use native admission and delivery. API automation
has unknown outcome provenance and cannot assert a human or assisted source.

```sh
curl --silent --show-error --config - --request POST "$H2H_URL/api/v1/conversations/$CONVERSATION_ID/messages" --data "{\"localId\":\"docs-reply-1\",\"content\":\"We have received your request.\",\"expectedRevision\":$REVISION}" <<EOF_CURL
header = "Authorization: Bearer $H2H_TOKEN"
header = "Content-Type: application/json"
EOF_CURL
```

Resolve (`conversations:write`):

```sh
curl --silent --show-error --config - --request POST "$H2H_URL/api/v1/conversations/$CONVERSATION_ID/resolve" <<EOF_CURL
header = "Authorization: Bearer $H2H_TOKEN"
EOF_CURL
```

List contacts (`contacts:read`):

```sh
curl --silent --show-error --config - "$H2H_URL/api/v1/contacts" <<EOF_CURL
header = "Authorization: Bearer $H2H_TOKEN"
EOF_CURL
```

Get a contact (`contacts:read`):

```sh
curl --silent --show-error --config - "$H2H_URL/api/v1/contacts/$CONTACT_ID" <<EOF_CURL
header = "Authorization: Bearer $H2H_TOKEN"
EOF_CURL
```

Create a contact (`contacts:write`):

```sh
curl --silent --show-error --config - --request POST "$H2H_URL/api/v1/contacts" --data '{"name":"Documentation Contact","email":"documentation@example.test"}' <<EOF_CURL
header = "Authorization: Bearer $H2H_TOKEN"
header = "Content-Type: application/json"
EOF_CURL
```

Update a contact (`contacts:write`). Erasing or erased contacts refuse updates.
Erasure is a separate owner/admin operation and is not exposed here.

```sh
curl --silent --show-error --config - --request PUT "$H2H_URL/api/v1/contacts/$CONTACT_ID" --data '{"name":"Updated Contact"}' <<EOF_CURL
header = "Authorization: Bearer $H2H_TOKEN"
header = "Content-Type: application/json"
EOF_CURL
```

List articles, including drafts (`articles:read`):

```sh
curl --silent --show-error --config - "$H2H_URL/api/v1/articles" <<EOF_CURL
header = "Authorization: Bearer $H2H_TOKEN"
EOF_CURL
```

Get an article (`articles:read`):

```sh
curl --silent --show-error --config - "$H2H_URL/api/v1/articles/$ARTICLE_ID" <<EOF_CURL
header = "Authorization: Bearer $H2H_TOKEN"
EOF_CURL
```

Create a draft (`articles:write`):

```sh
curl --silent --show-error --config - --request POST "$H2H_URL/api/v1/articles" --data '{"title":"Documentation Draft","slug":"documentation-draft","content":"Draft body","status":"draft"}' <<EOF_CURL
header = "Authorization: Bearer $H2H_TOKEN"
header = "Content-Type: application/json"
EOF_CURL
```

Update and publish (`articles:write`). Status is `draft` or `published`;
`categoryIds` must all belong to this workspace. Public help pages expose only
published articles under the native knowledge rules.

```sh
curl --silent --show-error --config - --request PUT "$H2H_URL/api/v1/articles/$ARTICLE_ID" --data '{"title":"Published Guide","content":"Published guide body","status":"published"}' <<EOF_CURL
header = "Authorization: Bearer $H2H_TOKEN"
header = "Content-Type: application/json"
EOF_CURL
```

Workspace owners/admins administer connections. Settings → Webhooks supports `conversation.created`, `message.created`,
`conversation.resolved` and `conversation.rated`. Events contain identifiers and
revision/outcome/rating values, never transcript text, email addresses or rating
comments. Imported history and undo emit none. Configurations are immutable
versions: disable a connection and create a new one to change its destination or
signing key. Disabled destinations refuse pending delivery. Contact erasure
removes retained event bodies and pending delivery payloads; safe attempt
metadata remains. A test is explicit and is recorded in the delivery log.

Erasing a contact also sends every enabled webhook a `contact.erased` event,
whatever it subscribes to: `{"contact_id": "...", "external_id": "..."}`, where
`external_id` is your own identifier for the customer (or `null`). Delete what your
system keeps about that customer and answer with a 2xx; the contact's erasure
record shows the request as completed. See [Personal data](PRIVACY.md#connected-providers).

The signature is Base `integrations.webhook.v1`: HMAC-SHA256 with the one-time
32-byte hex key over the UTF-8 JSON array `["integrations.webhook.v1", tenant,
destinationId, event, id, timestamp, exactBody]`. Headers are `webhook-tenant`,
`webhook-destination`, `webhook-event`, `webhook-id`, `webhook-timestamp` and
`webhook-signature` (`v1=<hex>`). Verify original bytes, expected tenant and
destination, timestamp freshness and replay identity before applying an effect.
See the copied Base [receiver guide](../src/vendor/base/modules/integrations/receiver.md).

Deliveries use ordinary platform HTTPS fetch with manual redirects. Every 3xx fails without following its Location. Requests are limited to 1 MiB, responses (including streams) to 64 KiB, and the entire request/response to 10 seconds. Public HTTPS destination syntax and literal IP validation remain enforced; this edition does not claim DNS pinning. HTTP 5xx, 408, timeouts and redirects remain uncertain and are never automatically replayed. Only HTTP 429 retries automatically within Base’s four-attempt policy, retaining the same logical identity and exact signed body. Receivers must deduplicate the webhook ID before applying effects.

In Connections → Delivery log, a current owner/admin can deliberately resend an
uncertain webhook after checking its receiver. The warning matters: the receiver
may already have applied it, so resending can duplicate effects. There is one
action per logical delivery, with its original attempt history retained.
`POST /api/management/projects/:projectId/connections/deliveries/:id/resend`
uses the native session and JSON `{ "attempt": <observed attempt number> }`.
It returns HTTP 202 with the same ID queued; dispatch happens separately. It
requires the current owner/admin, the same workspace, the original enabled
webhook destination, and unerased event/contact data at commit. Changed state,
stale attempt, destination/configuration or authority is refused; refresh and
inspect the new outcome before deciding again. Anonymous users, operators and
foreign-workspace deliveries cannot approve a resend. Slack and other states
have no resend action.

A deliberate resend does not reset the automatic retry budget: before four
attempts, a 429 may use the remaining original attempts. At or beyond four,
each explicit approval authorizes exactly one additional attempt; a 429 then
ends as rejected. If that additional attempt is uncertain, a fresh deliberate
approval may authorize another. Attempt numbers keep increasing, and each
approval records the actor, time, delivery ID and approved next attempt in the
workspace audit. The original destination reference, exact body, fingerprint,
four-attempt policy and existing attempts are retained. No request redirects,
new destinations or automatic replay of uncertainty are enabled.

Slack supports both incoming webhooks and bot tokens with channel IDs, escapes
text, and shares conservative durable delivery. Local recorded responses do not
establish live Slack acceptance: **live Slack: not-supplied**.

Slack posts one durable notification for a new native conversation once its first visitor message is committed. The notification includes up to 500 characters of that native visitor message, escaped through Base's Slack renderer. Empty widget conversations wait for that context. Erasure suppresses pending delivery and removes retained payloads; it cannot remove messages already accepted by Slack.


## Managed MCP tools

Connect a Streamable HTTP MCP client to `/api/v1/mcp` with a workspace bearer
token. This stateless endpoint accepts JSON-RPC over POST, with protocol versions
`2025-03-26` and `2025-06-18`; it uses no cookies, browser session, SSE stream or
server session ID. A newer client proposal negotiates down to `2025-06-18`.
Initialize, then use `tools/list` and `tools/call`. The catalog
shows only tools the current token scopes permit. Revocation and expiry apply to
every request, including discovery. Tool results carry native JSON in a text
content block; a native refusal has `isError: true`. Authentication failures use
HTTP 401 and the normal API error body.

Read tools are `list_conversations`, `get_conversation`, `list_messages`,
`list_contacts` and `list_articles`. Lists accept native `limit`/`cursor` paging.
Conversation lists also accept `status`, `updated_since` and `tag`.
`get_conversation` and `list_messages` require `id`. The `reply` tool requires
`messages:write`, `id`, `localId`, `content`, `expectedRevision` and, when present,
`expectedLastMessageId`. Read the current frontier first and retain the exact
command when reconciling an uncertain request. `resolve_conversation` requires
`conversations:write` and `id`. Tool calls use the same native route guards,
erasure fences and idempotency as REST. They cannot select another workspace or
an arbitrary URL. A tool call consumes both an MCP authentication request and a
native operation against the per-token rate limit.

## Zapier Platform connector

`connectors/zapier/index.mjs` exports an app definition for an owner-controlled
Zapier Platform project using platform version 17.0.0. Use it as the project's
entry export, install the matching Zapier Platform CLI/core in that project,
validate and deploy it there, then authorize the HTTPS HappyToHelp origin and a
workspace token in Zapier's private connection fields. Never put a token in the
definition or a Zap field. No hosted Zapier catalog deployment or live-account
qualification is claimed by this source definition.

The connection test and **Updated Conversation** polling trigger need
`conversations:read`. **Find Conversation** reads its current revision and last
message ID. **Reply to Conversation** additionally needs `messages:write` and an
explicit stable reply ID, content and current revision. Carry the last message ID
from the read when present. Retries retain the same reply ID and command; a stale
frontier is refused and must be reviewed before creating a new command.

Polling pages at most 1000 current conversations per invocation. A larger result
refuses the whole poll instead of silently truncating it; use native signed
webhooks for larger workspaces. Poll IDs include the conversation's update time,
revision and status, while `conversation_id` remains its native ID for actions.
This trigger reports current state rather than an event-history replay. Workspace
scope, erasure and token revocation apply on every page and action.

## Help Scout read synchronization

An owner or admin can connect one Help Scout Inbox mailbox per workspace through
`POST /api/management/projects/:projectId/connections/helpscout`, using their
native session and a recent step-up. The JSON fields are `mailboxId`,
`accessToken`, `webhookSecret` and `startFrom` (an ISO timestamp in the past).
Supply these from a private answers file or client secret fields; keep provider
credentials out of command arguments, logs and source. The installation needs
`INTEGRATION_ENCRYPTION_KEY`. Credentials are encrypted for this workspace and
never returned by the read endpoint. The connector makes only GET requests to
`https://api.helpscout.net/v2`; use a dedicated provider authorization with only
the mailbox read access you need. It never writes to Help Scout.

`POST .../connections/helpscout/sync` fetches conversations modified since the
retained cursor, with a five-minute overlap, complete customer details and every
thread page, including private notes. Every changed conversation becomes an
ordinary **Move in** review. Open that review and approve its fingerprint before
any native record changes. Import warnings and unsupported fields stay visible
there. Imported history never sends replies, notifications or support events.
An unchanged snapshot is not staged again; a new snapshot of an already imported
source is reviewed under Move in's conflict rules and cannot overwrite native
edits or silently replay old messages. This is staged coexistence, not automatic
live ticket mirroring: applying incremental changes to existing imported tickets
still needs an explicit merge/reconciliation implementation. Attachment metadata
is retained in the review; Help Scout attachment bytes are not fetched here.

`GET .../connections/helpscout` shows read scope, connection state, pending work,
cursor, last successful sync, safe error code and recent import run IDs/states.
A failed or incomplete read keeps its prior cursor. A sync refuses more than
20 conversations, 200 threads per conversation, ten pages per list, 60 provider
requests or 2 MiB of provider responses; it never treats a truncated read as a
complete sync. Each request has a ten-second deadline and refuses redirects.
Choose a later reviewed start date or a smaller provider mailbox if a first
snapshot exceeds these bounds. No automatic cursor skipping is offered.

Configure Help Scout's conversation webhook to
`/api/helpscout/:projectId/events`, with the same private webhook secret. The
original body is verified against `X-HelpScout-Signature` using Help Scout's
base64 HMAC-SHA1 protocol. The event and mailbox must match the supported
conversation notification and connection. Duplicate signed notifications are
deduplicated; the receipt retains only a digest. A notification marks pending
work and never imports its body or authorizes a native write. An owner/admin
performs sync explicitly; notifications do not start background polling.

`DELETE .../connections/helpscout` disconnects and removes both credentials;
native import history stays. Repeating POST with renewed provider credentials
reconnects the original mailbox, preserving its cursor and content receipts.
Concurrent syncs, changed connections and revoked native authority are refused.
Move in's erased-identity fences apply before new source custody is admitted:
redelivered or changed copies cannot restore an erased customer. Restored exports
carry native import history and erasure tombstones; reconnect the provider after
restore because its credentials and active sync state are excluded.

Provider-edge journeys qualify these local boundaries. No held-key Help Scout
test-account receipt or live Zapier deployment is claimed.
