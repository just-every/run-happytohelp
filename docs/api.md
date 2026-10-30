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
curl --silent --show-error --config - --request POST --header "Content-Type: application/json" --data '{}' "$H2H_URL/api/v1/conversations/$CONVERSATION_ID/resolve" <<EOF_CURL
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


### Production assistant traces

`GET /api/ai-support/projects/:projectId/conversations/:conversationId/trace`
requires workspace membership and `reports.view`. It returns up to 100 generations
in creation order, immutable assistant configuration fingerprints, issued knowledge
source/version references, attempt timings, numeric provider-round usage and the
committed customer-message ID, when one exists. A completed provider attempt alone
is not proof that a customer answer was committed. Cost estimates are USD provider
accounting; missing or invalid round pricing yields `null` and `priceData: unavailable`.

The response allowlists fields. It excludes prompts, customer text, raw provider
errors, tool arguments and unknown usage metadata. Per-tool approval, scope, timing and failure receipts plus advice-procedure attribution are returned only from their retained server records. Main's cycle-aware `generations` view remains available beside the paginated `traces` view.

### Requests after reading an article

An article's **Submit a request** link carries an opaque `afterReading` receipt to
the request form. The form forwards it on submission. The server attributes at most
one article event per admitted ticket, only for a view within 30 minutes from the
same reader or authenticated contact, in the same workspace, while that customer
still has article access. Invalid receipts do not prevent support requests. Retries
never duplicate the count. This adds no tracking cookie and makes no claim that the
article caused the ticket. Existing knowledge contact export and erasure include
these events. Deployment-level `PUBLIC_HELP_HOSTS` remains the host-routing door;
leads may publish one of their workspace's deployment-approved hosts; DNS and TLS provisioning remain the hosting administrator's prerequisite.


### Native follow-ups and advice procedures

These session-authenticated doors are separate from the scoped integration API.
They inherit native workspace permissions and cookie origin checks. They do not
send customer messages automatically or add refund or other business-action tools.

At `/api/ai-support/projects/:projectId/conversations/:conversationId/obligations`,
GET lists quoted proposals and accepted history. POST proposes an exact
`messageId`/`quote`, `ownerId`, future Unix-millisecond `dueAt`, `stopCondition`
and optional linked `dependencyId`. POST `/:id/accept` requires the current
`version`, accepted `ownerId` and `dueAt`; it can explicitly set a linked
`dependencyId`. Only a human with conversation-management permission accepts
material changes. A handoff does not silently change that accepted responsibility.
POST `/:id/complete` requires a current `version`, `stopConditionMet: true`, a fresh human/customer `confirmationMessageId` and its exact `quote`; the original promise is not completion evidence. The reviewer and evidence ID remain inspectable. Completing the follow-up does not establish engineering progress. Model extraction can use `list_followup_dependencies` and `propose_followup`; the latter accepts a linked `dependencyId` or null and may propose `ownerId: "human"` for review. A customer-facing generation using either internal tool transfers to a responsible human; its model draft cannot pass customer-message admission. Operator assistance remains unsent for review. Internal reminders also chase missing or stale dependency readback before the pre-due drafting window. Reminders and pre-due drafts are permission scoped; a closed engineering
issue without current readback and observed recovery remains unconfirmed.

Leads manage advice procedures at `/api/ai-support/projects/:projectId/procedures`.
POST `/:key/versions` creates an immutable `intent`, `instructions`, `model` and
`config` (`tools`, `humanEscalation`, `maxCost`, `maxTokens`). Tools can only narrow
the application's existing read-only surface. Submit an ordinary training run
with `procedureVersionId` to evaluate that exact version: only customer-reply
cases with declared `expected.must_include_all` outcomes and the version's model
and budget qualify. These evaluations perform no business actions.

POST `/:key/releases` accepts `versionId`, `evaluationId` and a `cohortLimit` of
1–100 only after every stored case passes. POST `/:key/releases/:releaseId/cohort`
explicitly enrolls a `conversationId`. POST `.../revoke-tool` narrows authority;
POST `.../stop` stops the rollout. A stopped conversation fails closed until a
lead explicitly enrolls it in another approved release. Restored archives retain
history and stop all releases; they never restore live rollout authority.

A version may carry a `proposal` naming `fromVersionId`, `resolutionIds` and an
`expectedEffect`; its cited native cycles must include a reopening or negative
CSAT. POST `/:key/versions/:versionId/review` records an `approved` or `rejected`
review and `reason`; GET `.../reviews` preserves both decisions. A proposal needs
approval as well as passing evaluations before release. POST
`/:key/releases/:releaseId/check-regression` explicitly checks the rollout and
reports its gate and stops it on any attributed reopening. Native resolution reopenings also enforce that gate automatically: the exact active rollout stops, queued/running generations cancel and an active human regains responsibility. Returning to AI requires explicit enrollment in an approved release and a human handback.

GET `/api/ai-support/projects/:projectId/procedure-reports/:key` requires report
permission. It reports committed-answer resolution-cycle denominators, reopen and
negative-CSAT rates, supporting cycles (100 per page using `offset`), evaluation
coverage and numeric recorded usage. Unversioned cycles and attempts without a
committed answer are excluded from resolution denominators. Provider costs retain
unknown prices; closing a cycle never establishes verified customer recovery.


### Reviewed knowledge from support resolutions

At `/api/knowledge/:projectId/gaps`, editors inspect exact normalized no-result
search topics by locale/brand and cited reopened cycles. This groups existing
native evidence; it does not claim semantic diagnosis.

POST `/api/knowledge/:projectId/proposals` with `conversationId`, `resolutionId`,
`messageId`, exact `quote`, `title`, private `categoryId` and the workspace default
`locale`. The source must still be resolved with positive native customer
feedback. The generated draft masks known contact names, addresses, URLs,
credential labels and long identifiers. A named editor must review free text:
automatic masking does not guarantee arbitrary anonymization.

POST `/:id/reject` records a reason. POST `/:id/publish` requires edited `title`
and `content`, optional `slug`, and explicit `redactionReviewed: true`; neither
creation nor rejection publishes. GET the proposals to inspect source links,
review history and later cited resolution/reopen cycles. POST
`/:id/analyze-corrections` creates deduplicated review proposals from source or
later cited reopenings. No correction automatically changes a published article.

Customer-derived publication is conservatively limited to the source customer's
proven email-domain collection. Ordinary article/category edits cannot broaden
that scope. Public reuse and translations remain held; source erasure removes
the derived article and proposal. Native AI search/read/citation admission uses
the recipient's current proof. Unscoped search stays public only. Customer model
text is withheld until durable message admission, which revalidates every issued
source even when the model did not select it as a citation.
## Machine-created support requests

An owner or admin can issue a machine credential through the existing token
management endpoint with `source_product`, `scopes` and `bindings`. The source
label is a lowercase product identifier. `conversations:create`,
`messages:append` and `conversations:read` are independent scopes. Machine reads
are restricted to tickets originating from that credential unless an administrator
explicitly supplies creator IDs in `bindings.credentials`. Bindings also accept
`brands`, `mailboxes`, `groups`, `forms`, `priorities` and existing tag IDs in
`tags`; unknown tags are refused rather than created.

`POST /api/v1/conversations` requires `Idempotency-Key` (1–200 characters).
Keys belong to the workspace and source product, so rotating the bearer secret
does not create another ticket. An identical canonical request returns the
original status and body with `Idempotency-Replayed: true` while the ticket is inside the credential’s reach. A replay of an out-of-reach ticket answers 404. Changed bodies return
`idempotency_conflict`; an outstanding claim returns `in_progress` and
`Retry-After`. A reused source reference returns `source_ref_exists` with the
existing conversation ID only for tickets inside the credential’s reach. Refused identities return `identity_conflict` or
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
`merged_into` with the surviving ID only when it is inside the credential’s reach. Notes are machine-authored internal context.

```sh
curl --silent --show-error --config - <<CURL
url = "$H2H_URL/api/v1/conversations/$API_CONVERSATION_ID/append"
header = "Authorization: Bearer $H2H_TOKEN"
header = "Content-Type: application/json"
request = "POST"
data = "{\"kind\":\"customer\",\"localId\":\"synthetic-hh-docs-append-1\",\"content\":\"Additional context\"}"
CURL
```

Create and append attachments accept an `upload_id` belonging to the same credential,
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

Acknowledgment/consent options are not yet accepted. SMS and WhatsApp acknowledgment delivery is not implemented. Owners can configure `api_requester_hourly_cap` (1–100, default 5) through
`PUT /api/management/projects/:projectId/settings`. Each supplied requester identity
shares an atomic UTC hourly budget across credentials. The first request above the
cap is held for review; further requests return 429 `requester` with `Retry-After`
and `RateLimit-Limit`, `RateLimit-Remaining`, and `RateLimit-Reset`. Replays do not
consume capacity. Failed admissions refund reserved capacity.

Webhook envelopes include a signed `sequence` describing insertion order within
this installation. Delivery may arrive out of order. Deduplicate by event `id`;
apply state updates only when their sequence is newer than the last applied update.
Retries retain the same ID, sequence and payload. Restore does not resume deliveries. Do not treat these endpoints as complete API-002 through API-008 acceptance.

### API admission, suspension and issuer erasure

Owners and admins may set `api_abuse_terms` through
`PUT /api/management/projects/:projectId/settings` with recent step-up.
The default is an empty list. Up to 50 literal terms, each 1–200 characters,
are matched without case sensitivity in the subject, body and source reference.
A match returns `202 held_for_review` with reason `content_abuse`; Suspended
retains the request for an operator to review and release. Held requests create
no ticket, triage job, ticket-created event or outbound message. This deterministic
policy does not establish live AI content-abuse or prompt-injection qualification.

An installation administrator with recent step-up can suspend or resume a
workspace using `PUT /api/management/admin/projects/:id/suspension` with
`{"suspended":true}` or `{"suspended":false}`. Suspension preserves data and
refuses all bearer API operations with 401 on the next request. Creates recheck
workspace authority in their atomic commit; an interrupted create is whole or
absent. Installation administration and the owner's review access remain available.

An owner with recent step-up can erase a non-owner teammate using
`POST /api/management/projects/:projectId/agents/:userId/erase`. Transfer ownership
first. Accounts shared with another workspace and installation administrators
require installation review and are refused. Erasure replaces the account's name
and email with opaque former-teammate metadata, removes sign-in credentials,
sessions and profile settings, and revokes the machine credentials it issued,
removing their hashes and issuer links. Audit events and ticket history retain
opaque actor IDs, machine credential names, source references and request IDs;
audit exports label the erased human as Former teammate. Archives carry the
redacted account and inert credential metadata. Customer content is erased
separately through the requester-erasure door.

Gaps: Live AI content-abuse and prompt-injection qualification of API-created
requests is not proven. Live qualification remains for: "body text, subject and source fields can never instruct the agent or open an external effect." No live cross-product handoff (Handset HND-038) is proven.
Consent-gated SMS/WhatsApp qualification remains pending CHANNELS-001.


Customer appends honor both blocked sender addresses/domains and blocked contacts.
They return 403 `blocked_sender` without adding a message or reopening a Solved
ticket. Credential bindings and webhook credential filters follow the credential, including tickets created using the new secret.

If a source reference was claimed by a clean request while another request waited
in Suspended, releasing the held request returns 409 `source_ref_exists` with
the surviving `conversation_id`. The held request remains available for review.
The request-limit response reports the installation's configured
`apiRequestsPerTokenMinute` in `RateLimit-Limit`.


A machine credential can hold only `conversations:create`, `conversations:read`
and `messages:append`. Operator, contact and article scopes remain available to
legacy workspace tokens. Credential policy belongs to one entity; rotation adds
secrets to that entity. Settings shows one card with each secret's prefix,
expiry and last use. PATCH, rotate and revoke accept either the credential ID
or any of its secret IDs. Scope, binding and quota edits apply to every secret.
Expired or revoked credentials cannot be rotated (409).

Reach combines the origin credential with the ticket's current brand, mailbox
and group, plus its origin form. Moving a ticket out of a credential's reach
removes that credential's access. Lists omit it and named-resource operations
return 404. Priority and tag bindings are create-time value restrictions.
A policy change or ticket move during an append is checked again at commit.
Legacy workspace tokens retain workspace-wide reach.

Requester admission recognizes normalized email, provided email, phone, external
ID and API external ID. A block on any contact sharing a key applies to customer
appends and held-request release as well as create. Address and domain rules
apply to email keys. Erasure fences return `identity_erased`; internal notes
are machine content and are unaffected by requester blocks.

An API hold retains the complete ticket plan, including tags, placement, form,
source reference and attachments. Release rechecks current credential policy,
requester admission, tags and reference uniqueness. It may override requester-cap
and content-abuse holds, but never a standing block or erasure fence. Release
records the operator and machine source and sends no retroactive acknowledgment.
The original idempotency key continues to replay its original 202 receipt.

Consuming an upload removes its row and original object after the ticket copy
commits. Scheduled cleanup removes expired unused uploads and retries object
deletions. Each credential may hold 50 outstanding uploads by default; installation
configuration `API_UPLOAD_LIMITS` can set a positive integer `outstanding` limit.
Excess uploads return 429 `credential` with retry and rate-limit headers.
All JSON write doors require `application/json` (415 otherwise) and reject
oversized bodies or content with 413 `payload_too_large`.

Exports carry the credential entity as metadata, without bearer hashes or
secrets. Restore revokes every credential and every secret; imported requests
remain inert and do not replay.


## Read-only HubSpot context (native administration)

The initial CRM connection is available through native authenticated administration
routes. It is separate from machine API credentials. Only a workspace owner or
admin with the relevant native permissions can use it. Customer sessions cannot
read CRM records, and a mapping never grants customer access or changes native
identity links, company membership, entitlements or plan authority.

All paths below start with `/api/management/projects/{projectId}`; the dashboard
mount offers the same operations. Keep the native session and provider token in
private request configuration, never command arguments or logs.

| Operation | Method and path | Input or result |
| --- | --- | --- |
| Inspect connection | `GET /crm/hubspot` | Account ID, connected flag and required scopes; no credential |
| Connect or rotate | `PUT /crm/hubspot` | `token`, numeric `account_id`, optional `properties` mapping `plan` and `entitlement` to provider property names; recent native step-up required |
| Map customer | `PUT /crm/hubspot/contacts/{contactId}` | Numeric `source_contact_id`; optional native `company_id` and numeric `source_company_id` together |
| Inspect customer | `GET /crm/hubspot/contacts/{contactId}` | Source IDs, context, source update times, last successful refresh and last check |
| Refresh customer | `POST /crm/hubspot/contacts/{contactId}/refresh` | Empty object; reads the explicitly mapped source again |
| Inspect ticket | `GET /conversations/{conversationId}/crm` | Context for the ticket's native requester |
| Refresh ticket | `POST /conversations/{conversationId}/crm/refresh` | Empty object; requester and authority rechecked at commit |
| Unmap customer | `DELETE /crm/hubspot/contacts/{contactId}` | Removes mapping and cached context only |
| Disconnect | `DELETE /crm/hubspot` | Recent native step-up; deletes the credential and every CRM mapping in this workspace |

Use a HubSpot private app with exactly `crm.objects.contacts.read` and
`crm.objects.companies.read`. Extra scopes, including write scopes, are refused.
HappyToHelp checks the private app's account and scopes through HubSpot's token
information endpoint before storing its encrypted credential and again on every
refresh. No returned URL is fetched, redirects are refused, responses are bounded
and requests are never automatically retried. Reads use the fixed HubSpot API
origin. The token information request is a read-only POST; object requests are GET.

Mapping is an explicit operator decision. Contact email must match at refresh and
readback. A company mapping also needs existing native membership, a matching
native domain and a source contact association with that company. Competing source
mappings are refused with 409. Native identity or membership changes hide cached
context until the mismatch is resolved. Context becomes `stale` after five minutes;
`identity_mismatch`, `permission_lost`, `scope_refused` and `unavailable` refresh
outcomes clear its cached content rather than present it as current. Connection
rotation clears mappings so a changed account cannot inherit them. Disconnect
returns `disconnected` without cached content. Customer erasure removes affected
mappings and cached personal data. Archives clear CRM credentials and cached
context on export and import; the receiving owner must explicitly reconnect.

The settings screens and ticket panels, browser qualification, live provider
qualification, other CRMs and approved CRM writes remain pending under CRM-001.

### Teams ticket handoffs

The selected-context escalation dialog supports a Teams channel configured by a
workspace owner or administrator. Use a Microsoft Graph delegated token with
`ChannelMessage.Send` permission and a target consisting of the team UUID, a slash,
and the channel ID. The configured Graph origin is fixed; provider redirects are
refused. Tokens remain encrypted workspace credentials and exports strip them.
An expired token requires deliberate reconnection; there is no automatic refresh.

`POST /api/escalations/projects/:projectId/conversations/:conversationId/teams`
uses the existing selected `message_ids`, `attachment_ids` and `request_id` fields.
Only the configured channel is eligible. Preview does not send; confirmation sends
plain text containing the ticket reference and chosen context. A successful result
retains the Teams message link. An explicit authentication or permission refusal
is recorded as failed. Other delivery failures remain uncertain and neither state
is automatically replayed. Repeating the same completed request returns its stored
result; concurrent claims send at most once. The installing administrator must
still have integration installation authority when the send starts.

Sharing a handoff never publishes a customer reply or confirms recovery. An
operator writes and explicitly sends any customer update in the ordinary reply
composer. Teams inbound status and automatic fix-shipped drafts are not implemented.
The ESCALATION-001 clause remains partial pending policy and live qualification.

## Managed connectors (API-001)

The unpublished Zapier app definition is
`src/modules/api-integrations/zapier-app.mjs`. Install it privately with the
workspace API origin and bearer credential. Its request templates use native
find/create contact, reply, resolve and draft-article operations. Find contacts
with `GET /api/v1/contacts?email=…` (exact, case-insensitive); search and create
require their separate read and write scopes. Replies retain `localId` replay
and `expectedRevision` conflict protection. Creation and customer-side append
retain the machine protocol's admission and erasure fences; Zapier grants no
additional authority. App publication and live Zapier qualification remain R-11.

REST hooks use `POST /api/v1/zapier/hooks` with
`{"event":"contact.updated","url":"https://receiver.example.com/events"}`.
The response shows `{id, secret, event}` once. Use
`DELETE /api/v1/zapier/hooks/{id}` to unsubscribe; only the subscribing
credential can remove it. `GET /api/v1/zapier/sample?event=contact.updated`
reads up to five current native records, never fabricated samples. Conversation,
contact and article events respectively require `conversations:read`,
`contacts:read` and `articles:read`. Native source-product reach still applies.
Hooks use the same signed, bounded delivery pipeline and uncertain-outcome
reconciliation as owner-created webhooks. Revocation disables every destination
bound to that credential; expiry and lost scopes also fence sending.

Alongside conversation events, `contact.created`, `contact.updated` and
`article.published` contain only the record ID. Their intents commit in the same
transaction as the domain write; historical import apply/undo stays inert.
Verify the `v1=` SHA-256 HMAC over the UTF-8 JSON array
`["integrations.webhook.v1", tenant, destination, event, id, timestamp, rawBody]`
using the hex-decoded secret. Bind tenant and destination to the subscription
and compare signatures in constant time; reject changed bytes or destination.
Do not treat an unsigned ID alone as a verified event.

### HTTP MCP

`POST /api/v1/mcp` accepts JSON-RPC 2.0 `initialize`,
`notifications/initialized`, `tools/list` and `tools/call` over bearer-only HTTP.
It returns the negotiated `2025-03-26` protocol and no CORS permissions. Native
sessions and provider credentials cannot authenticate it. `tools/list` includes
only tools the credential's scopes permit. Tools list/read conversations,
messages, contacts and articles, create/update contacts, draft articles, reply
and resolve. Calls delegate to the native guarded routes: tenant reach, private
note exclusion, erasure, quotas, usage audits and revocation stay enforced.
A refused tool returns `result.isError: true` and the native error inside text
content; invalid/revoked bearer credentials and exhausted quotas retain HTTP
401/429. This is a session-free JSON HTTP transport; streaming/resumption and
real Claude, ChatGPT, Codex or Copilot compatibility require R-21 qualification.
The held Base company-policy API remains separate.

```json
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_conversations","arguments":{"limit":25}}}
```

### Reviewed Help Scout coexistence

An owner/admin with recent step-up connects at
`PUT /api/management/projects/{projectId}/connections/helpscout` with
`app_id`, `app_secret`, `webhook_secret` and numeric-string `mailbox_id`.
Credentials use the existing workspace encryption custody and are never read
back. `GET` returns connection metadata; `DELETE` disconnects, deleting the
credentials while preserving the mailbox, incremental cursor and page position.
Reconnect with rotated credentials for that same mailbox. A different mailbox
cannot inherit the cursor. Archives strip credentials and active pull claims;
reconnect after restoring.

Explicit `POST …/helpscout/pull` with `{}` obtains a client-credentials token,
then reads the fixed `https://api.helpscout.net/v2/` origin. Conversations use
`modifiedSince` and ascending `modifiedAt` under the selected mailbox. One pull
stages at most one conversation list page (25 conversations), with complete
conversation/customer detail and thread pages. A continuation retains the page
URL and original scan start; only completing that scan advances `cursor`.
Responses are unmodified leaves in a JSON array submitted in process to the
ordinary Help Scout import door with the reviewer's own native session. Each
conversation has its own reviewed run, so an erased-identity 410 skips that
conversation with a count and reason while unrelated conversations can stage.
Existing import source/hash fences make old imports no-ops or conflicts,
never additional native copies. Nothing applies without the person's ordinary
import review and approval. An interruption does not advance cursor/page state.
The first successful scan's start time becomes the inclusive incremental cursor;
changes during a scan are included by the next scan.

HTTPS refuses redirects, bounds each request to 10 seconds and each response to
64 KiB, and limits a pull to 30 seconds, 128 calls and 2 MiB total. A limit
refusal leaves the cursor in place. HTTP 429 is `rate_limited`; 401/403 is
`credentials_refused`; transport, size and pagination failures have safe error
classes. No automatic retry loop or provider error text is stored or displayed.
OAuth app installation/account qualification remains external under R-11.

Configure the provider's webhook URL as
`/api/helpscout/projects/{projectId}/webhook`. Intake requires
`X-HelpScout-Signature`: base64 HMAC-SHA1 of the exact raw body using the
configured webhook secret. Verification uses constant-time WebCrypto comparison
and a 64 KiB body bound. Only a SHA-256 body digest and receipt time are stored;
identical deliveries count once. Intake only records changes waiting; it never
imports, applies or contacts a provider. Help Scout credentials/signatures grant
no native API/MCP authority, and native API credentials grant no Help Scout
management or intake authority.

### Connection health and manual reconciliation

Owner/admin-only `GET /api/management/projects/{projectId}/connections/connectors`
and the existing Connections settings show API tokens, MCP, webhooks, Slack,
Zapier hooks and Help Scout. Rows show scopes/events, configuration, recent
queued/uncertain/failed delivery counts, safe attempt summaries and health.
`failing` means a retained failed delivery or Help Scout error; `degraded` means
uncertain delivery; `ok` means no observed failure, with unconfigured rows
explicitly labeled. API and MCP share bearer authority and its latest 200 usage receipts; a
refused scope or quota marks both rows degraded, without presenting either as
a provider outage. Delivery counts cover the most recent 200 intents;
configuration/scopes cover at most 100 active destinations/credentials.
Uncertain webhook reconciliation names the observed attempt and offers one
explicit resend approval. Help Scout shows cursor, last pull, waiting events,
erased skips and a manual pull. Secrets, destination URLs, provider error bodies
and customer text never enter the catalog. Unattended scheduled pulls and
automatic apply are not implemented; imports remain person-reviewed.
