# Mobile operator API and offline protocol

This is the server and portable memory-client slice of MOBILE-001. There are no native iOS or Android
clients yet. Prepared push envelopes are **not delivered notifications**: device
registration with APNs/FCM, provider transports and sandbox/device receipts remain
unimplemented. Native screens, platform lifecycle integration and encrypted offline persistence
also remain open. This API does not imply those acceptance points are complete.

All paths below start with `/api/mobile/v1`. Responses use `Cache-Control:
no-store`. Installations must serve them over HTTPS. Device bearer tokens must
never appear in URLs, logs, analytics, screenshots or persisted customer drafts.

## Pairing and authority

With a current native operator session, `POST /devices` accepts `platform`
(`ios` or `android`) and `scopes`, including `read`. Available scopes are `read`,
`notes`, `reply`, `assign`, `attachments`, `knowledge`, `approval` and `push`. Each requested
write scope must fit the operator's current permissions. Approval requires public-reply
permission and covers only the operator's stored local-computer proposals; it grants
no installation, financial, import or credential approval authority. Knowledge requires
knowledge-edit permission and returns only published articles visible to the
current ticket's customer. Attachment upload requires note or reply permission.
Local development-entry credentials and customer sessions cannot pair devices.

The response shows the random device token once, with its ID, workspace, scopes
and expiry. Only its hash is stored. A device is bound to exactly one workspace,
user and parent native session, for at most that session's remaining lifetime
or one day. A device token is accepted only as an Authorization bearer on the
mobile surface; it cannot enter native, management, integration or export APIs.
There is no cookie or query-token fallback.

`GET /devices` and `DELETE /devices/:deviceId` use the native session and list or
revoke only that user's devices in that workspace. `GET /session` uses the device
bearer and returns current scope and offline policy. `DELETE /session` signs that
device out and returns `purge:true` and `Mobile-Cache-Action: purge`. Native parent
sign-out also invalidates every derived device immediately. Membership removal,
role assignment/definition changes and second-factor changes retire the device;
restoring the old role does not revive it. Native sign-in is needed to pair again.

Every mobile request rechecks the parent session, membership, role definition,
second-factor state and workspace lifecycle. An invalid/revoked/expired session
returns 401 with `purge:true` and the purge header. Successful authentication
never guarantees a subsequent mutation: authority is rechecked inside its atomic
D1 write as well.

## Working a ticket

- `GET /tickets` returns the latest 100 permitted workspace tickets.
- `GET /tickets/:ticketId` returns the ticket, latest 200 messages, latest 100
  notes, attached media, scheduled-effect identities/versions/states and a
  short-lived opaque `frontier`. These are bounded views, not an export API.
- `POST /tickets/:ticketId/assignment` accepts `localId`, `frontier` and
  `assignee` (a current workspace user ID, or null).
- `POST /tickets/:ticketId/notes` accepts `localId`, `frontier`, `content` and
  optional `mediaIds`. Notes keep the existing private-note and mention rules.
- `POST /tickets/:ticketId/attachments` uploads 1 byte to 20 MB as a raw body,
  with `Mobile-Frontier`, `Content-Type` and optional `X-Filename` headers.
  Its response ID may be attached to a note or reply. Downloads use
  `GET /tickets/:ticketId/attachments/:mediaId` with device authority.
- `GET /tickets/:ticketId/knowledge?q=...&locale=...` returns published knowledge
  for that customer; private collection and locale rules remain in force.
- `POST /tickets/:ticketId/reply` accepts `localId`, `frontier`, `content`,
  optional `mediaIds` and optional `resolve`. The call itself is an explicit
  human send; it grants no future or scheduled authority. External mail effects
  use the native outbox and retain unknown outcomes as unknown.

A frontier pins ticket revision, last message, ticket version and scheduled
work. It expires after five minutes. Any drift refuses a new mutation (409):
read the ticket again and require the operator to review the new state. Never
silently replace the frontier on an old draft. Sending again with the original
local ID and exact reply command returns the existing message receipt; changed
content with the same ID is refused. IDs are scoped to the device. The same
command submitted concurrently creates one message.

Notes and assignment also use stable IDs. An interrupted outcome stays
`uncertain` and is not replayable: inspect the ticket/notes before a new explicit
operator action. An `effects:unconfirmed` reply response confirms the message
was saved, not that external delivery succeeded. Neither uncertainty nor an
HTTP failure authorizes a new local ID and an automatic retry.

## Reviewing prepared work

- `GET /tickets/:ticketId/approvals` lists the current operator's verified,
  completed local-computer results, reply proposals and follow-up proposals.
  It never returns another operator's results or a revoked computer's work.
- `POST /tickets/:ticketId/approvals/:jobId/follow-ups/:proposalId` with
  `{frontier}` explicitly approves that stored proposal once. It queues the
  same linked child as the native approval door, with the proposal's exact mode,
  instructions and attachment grants. Concurrent or repeated approval returns
  the original child receipt. Changed ticket/scheduled effects, revoked device,
  lost computer grant or replaced result refuse new authority atomically.
- `POST /tickets/:ticketId/approvals/:jobId/draft` with `{frontier, proposalId}`
  adopts a verified reply proposal into an editable draft with mobile attachment
  URLs and its `authoring` source. It sends nothing. Pass that source, the reviewed
  draft and its selected media IDs to the explicit reply command. Attachment
  copying rechecks the same device/frontier/source guard inside D1 after R2 work.

These doors require the explicitly paired `approval` scope. They reuse native
proposal, attachment and reply provenance rules. Native approval UI and device
execution remain unproved. No mobile operation installs credentials or transports
push notifications.

## Memory-only offline client

`src/modules/mobile/client.ts` exports `MobileClient`, a portable controller for
this protocol. It is not wired into the web inbox and is not a native app. It owns
only process memory: ticket transcripts, queue/knowledge/approval reads, unsent
text and attachment buffers. It has no storage adapter, disk cache, service worker,
command queue or retry worker. HTTP requests omit cookies, refuse redirects and
use `cache: no-store`. This implements ct's approved first offline slice
(23 October); it does not establish native cache-erasure acceptance.

After pairing, create a client with the application's HTTPS origin and
`credential: {deviceId: paired.id, projectId, token, scopes, expiresAt}`. Only a
loopback development origin may use HTTP. The controller copies the credential;
the host must also discard its own pairing response and any displayed strings.

The public lifecycle is:

1. `reconnect()` checks `/session`, refreshes all open/drafted tickets and their
   scheduled effects, then becomes `online`. A connection event merely changes
   `offline` to `reconnect-required`; it never issues a write. `state` and
   `subscribe()` let the host show offline/reconnecting/signed-out state.
2. `openTicket(id)`, `tickets()`, `knowledge(id)` and `approvals(id)` load current
   permitted data. `saveDraft(id, content)` and `stageAttachment(id, file)` keep
   unsent work in memory, including while offline. Every draft needs explicit
   `reviewDraft(id)` against the refreshed ticket before `sendDraft(id)`.
3. `setOffline()` retains unsent work but disables send, notes, assignment and
   approval. It invalidates every draft's review. Reconnect never replaces an old
   draft's frontier silently or sends pending work. The server also guards each
   explicit write against role, message, ticket and schedule drift.
4. `sendDraft()` uploads selected bytes and submits the stable local reply ID
   once. A known refusal retains the draft for refresh/review. An interrupted or
   unknown outcome is `uncertain`, cannot be sent or reviewed again, and requires
   ticket inspection before an operator explicitly discards/replaces it. A saved
   reply with `effects:unconfirmed` confirms storage, not external delivery.
5. `signOut()` starts one explicit server revocation attempt and purges locally
   immediately, including offline. Its `serverRevoked` result distinguishes an
   acknowledged revocation from an unconfirmed one; it never retries. A 401,
   purge header/body, 403, expired credential, `authorityChanged()` or
   `workspaceChanged()` also purges customer data, drafts and credentials.
6. `dispose()` purges on process/host exit and detaches listeners. In a browser,
   offline/online/pagehide hooks are connected by default, including pagehide
   before a back-forward-cache restore. A native host must bind its own network,
   authority, workspace and process lifecycle events to these methods before it
   can claim native acceptance. A new client starts without previous data.

Purge drops owned references, clears cached objects in place, zeroes attachment
buffers, cancels in-flight reads and rejects late responses from the old session.
JavaScript cannot erase an immutable string already copied by a consumer: hosts
must clear their own views, clipboard, snapshots and temporary file copies too.
The controller does not prove OS backup exclusion, native secure storage,
app-switcher protection or deletion on a disconnected device before it learns
revocation. Those remain native-device proof obligations.

Persistent native offline drafts remain a named Gap: a device-keychain key,
encrypted-at-rest drafts and the same purge events are the target. No persistent
customer data or background send is enabled by this implementation.

## Redacted push preparation and deep links

`PUT /push` with `{ "enabled": true }` opts this device into preparation; false
opts out and deletes its old links. It accepts no provider registration token.
The device must hold `push` scope. Existing native teammate notification
selection, per-kind inbox preference and current ticket permission determine the
audience. Preparation reads only committed notices created since device pairing.
Imports, machine mail,
self-notices and revoked devices retain their native suppression rules.

`GET /push/prepared` prepares up to 100 recent notices on demand and exposes
that device's envelopes, marked
`delivery: "not-configured"`. Each contains a generic HappyToHelp title, a generic
support notice and `h2h://open/<opaque-link-id>`. No customer text, names,
addresses, attachment names, workspace IDs or ticket IDs enter the payload.
This preparation surface is not an APNs/FCM delivery or a device receipt.

A native client would resolve the opaque ID through `GET /links/:linkId` using
its device bearer. The server revalidates membership, device, workspace,
customer-erasure fences and expiry before returning a workspace/ticket route.
A link from another device, workspace or expired/revoked session is refused;
the link alone never authorizes customer-data access. Universal/app-link OS
registration and the native screens remain unimplemented.

## Upgrade and proof boundary

Migration `250_mobile_devices.sql` is additive. Apply it before the updated
Worker serves traffic; back up D1/R2 and private settings first. It introduces
only derived device authority, frontier/command receipts and opaque link
metadata. It migrates no existing session into a mobile credential and enables
no provider delivery. Existing owners and support history are unchanged. Rer
archives and sanitized SQL backups exclude device credentials, frontiers, command
receipts and prepared links; pairing must be repeated after restore.

The existing native admission, role, ticket and notification journeys now also
exercise these mobile public doors in `tests/helpers/mobile.mjs`. They prove
server behavior with real D1/R2 and the application router. They do not prove
iOS/Android binaries, offline OS storage, APNs/FCM networking or receipt on a
physical device. MOBILE-001 stays partial.
