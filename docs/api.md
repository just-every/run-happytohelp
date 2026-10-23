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


### Production assistant traces

`GET /api/ai-support/projects/:projectId/conversations/:conversationId/trace`
requires workspace membership and `reports.view`. It returns up to 100 generations
in creation order, immutable assistant configuration fingerprints, issued knowledge
source/version references, attempt timings, numeric provider-round usage and the
committed customer-message ID, when one exists. A completed provider attempt alone
is not proof that a customer answer was committed. Cost estimates are USD provider
accounting; missing or invalid round pricing yields `null` and `priceData: unavailable`.

The response allowlists fields. It excludes prompts, customer text, raw provider
errors, tool arguments and unknown usage metadata. Per-tool approval/scope/results
and procedure attribution are explicitly unavailable until those records exist.

### Requests after reading an article

An article's **Submit a request** link carries an opaque `afterReading` receipt to
the request form. The form forwards it on submission. The server attributes at most
one article event per admitted ticket, only for a view within 30 minutes from the
same reader or authenticated contact, in the same workspace, while that customer
still has article access. Invalid receipts do not prevent support requests. Retries
never duplicate the count. This adds no tracking cookie and makes no claim that the
article caused the ticket. Existing knowledge contact export and erasure include
these events. Deployment-level `PUBLIC_HELP_HOSTS` remains the host-routing door;
lead-managed custom-domain verification and publishing are not implemented.


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
