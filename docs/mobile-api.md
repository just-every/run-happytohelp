# Mobile operator API and offline protocol

This is the server-side slice of MOBILE-001. There are no native iOS or Android
clients yet. Prepared push envelopes are **not delivered notifications**: device
registration with APNs/FCM, provider transports and sandbox/device receipts remain
unimplemented. Native approval screens and protected offline persistence also
remain open. This API does not imply those acceptance points are complete.

All paths below start with `/api/mobile/v1`. Responses use `Cache-Control:
no-store`. Installations must serve them over HTTPS. Device bearer tokens must
never appear in URLs, logs, analytics, screenshots or persisted customer drafts.

## Pairing and authority

With a current native operator session, `POST /devices` accepts `platform`
(`ios` or `android`) and `scopes`, including `read`. Available scopes are `read`,
`notes`, `reply`, `assign`, `attachments`, `knowledge` and `push`. Each requested
write scope must fit the operator's current permissions. Knowledge requires
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

## Offline client obligations

The conservative default is **memory-only customer data and drafts**. The
protocol advertises this policy on session/ticket responses. No server offline
cache or draft store exists. A future native client must show offline status,
disable send/assignment/approval, and keep unsent text only in process memory.
It must discard customer data, attachment bytes, drafts and device credentials
on sign-out, authority loss, workspace change or process exit. It must not use
OS backups, app-switcher snapshots, notification text, browser caches or shared
storage as a customer cache. Only the session credential may use platform secure
credential storage in a future native implementation, subject to its sign-out
and revocation proof. That implementation is not provided by this server slice.

Reconnect first checks `/session`, then refreshes each open ticket and its
scheduled effects. A 401 purges immediately; role changes require native
sign-in. No offline command queue, background resend, scheduled-effect replay
or approval grant is provided. Persistent encrypted drafts require a separately
reviewed retention/key-custody policy and native-device evidence; they must not
be inferred from this API. A server can revoke access, but cannot prove deletion
of bytes on a disconnected device. Native cache-erasure acceptance remains open.

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

Migration `277_mobile_devices.sql` is additive. Apply it before the updated
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
