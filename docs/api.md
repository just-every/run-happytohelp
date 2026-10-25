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

## Machine-created support requests

An owner or admin can issue a machine credential through the existing token
management endpoint with `source_product`, `scopes` and `bindings`. The source
label is a lowercase product identifier. `conversations:create`,
`messages:append` and `conversations:read` are independent scopes. Machine reads
are restricted to that credential's rotation family unless an administrator
explicitly supplies creator IDs in `bindings.credentials`. Bindings also accept
`brands`, `mailboxes`, `groups`, `forms`, `priorities` and existing tag IDs in
`tags`; unknown tags are refused rather than created.

`POST /api/v1/conversations` requires `Idempotency-Key` (1–200 characters).
Keys belong to the workspace and source product, so rotating the bearer secret
does not create another ticket. An identical canonical request returns the
original status and body with `Idempotency-Replayed: true`. Changed bodies return
`idempotency_conflict`; an outstanding claim returns `in_progress` and
`Retry-After`. A reused source reference returns `source_ref_exists` with the
existing conversation ID. Refused identities return `identity_conflict` or
`identity_erased`.

Keep `H2H_TOKEN` in the shell's private environment as in the examples above.
The secret enters curl through standard input, never a command argument.

```sh
curl --silent --show-error --config - <<CURL
url = "$H2H_URL/api/v1/conversations"
header = "Authorization: Bearer $H2H_TOKEN"
header = "Content-Type: application/json"
header = "Idempotency-Key: synthetic-hh-docs-1"
request = "POST"
data = "{\"requester\":{\"external_id\":\"synthetic-hh-docs-1\"},\"subject\":\"Support request\",\"body\":\"Please help with this request\",\"source_ref\":{\"product\":\"synthetic-hh-docs\",\"ref\":\"synthetic-hh-docs-1\",\"url\":\"https://example.test/requests/1\"}}"
CURL
```

`POST /api/v1/conversations/:id/append` accepts `kind: customer` or `kind: note`,
`content` and a stable `localId`. A customer append reopens Solved tickets and
creates a linked follow-up for Closed tickets. Merged tickets return
`merged_into` with the surviving ID. Notes are machine-authored internal context.

```sh
curl --silent --show-error --config - <<CURL
url = "$H2H_URL/api/v1/conversations/$API_CONVERSATION_ID/append"
header = "Authorization: Bearer $H2H_TOKEN"
header = "Content-Type: application/json"
request = "POST"
data = "{\"kind\":\"customer\",\"localId\":\"synthetic-hh-docs-append-1\",\"content\":\"Additional context\"}"
CURL
```

Create and append attachments accept an `upload_id` belonging to the same credential family,
or a public HTTPS `url`, `filename` and lowercase hexadecimal `sha256`. URL
fetches refuse redirects, have a ten-second deadline and a 20 MB per-file limit;
unsupported types return 415 and oversized files return 413. All attachments
must validate before a ticket, message or note is committed. Append-only credentials
can use the same bounded upload endpoint; private note files remain operator-only.

Machine issuance accepts `create_per_minute` (default 20, maximum 60) and
`create_per_day` (default 1000, maximum 10000). Installation workspace ceilings
are 120 per minute and 20000 per day. A refused create returns 429 with code
`credential` or `workspace`, `Retry-After` and `RateLimit-Limit`,
`RateLimit-Remaining`, `RateLimit-Reset`. Replays do not consume create quota.

Owners and admins rotate through `POST /connections/tokens/:id/rotate` under the
same project management prefix, with `overlap_seconds` (default zero, maximum
604800). Rotation requires step-up. Old secrets retire at their overlap deadline;
revocation requires step-up and takes effect on the next request.

Webhook destinations may select `conversation.status_changed` and
`conversation.assigned`, and restrict delivery with `credential_id` or
`source_product`. Status and assignment payloads contain identifiers and status
values, with source references for machine-created conversations. The existing
signature and retry protocol applies.

Exported credential metadata carries an inert `revoked:<id>` storage placeholder
instead of the bearer hash and a revocation timestamp. Restore cannot use old
secrets. Request replay bodies and append responses are not exported; restored
idempotency records cannot replay a response.

### Current machine API limits

Acknowledgment/consent options are not yet accepted. SMS and WhatsApp acknowledgment delivery is not implemented. Requester
holds currently use a fixed five-create hourly cap; configurable caps and a
separate requester 429 policy remain pending. Source back-links and machine
credential metadata are stored, but their complete Settings and inbox display
is pending. Do not treat these endpoints as complete API-002 acceptance.
