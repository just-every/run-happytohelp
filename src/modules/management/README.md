# Native product management

Hono routes over the edition's canonical D1 identity, conversation and media
records. The management module exports `routes` for `/api/management`,
`dashboardRoutes` for retained `/api/dashboard` contracts, `publicWidget` for
`/api/widget`, and `widgetEvents` for `/api/conversations`.

Project membership is rechecked on every request. `GET /bootstrap?projectId=` answers a
member with that project's workspace plus `sessionProjectId` (the project the session
is bound to, which the dashboard loader aligns with the URL through
`/api/identity/switch-project`) and `isPlatformAdmin`; a project the account does not
belong to and one that does not exist are refused identically with a 403 that says so;
a member whose role is below owner/admin is refused owner/admin actions with a 403 that
names the required role. Global inbox reads aggregate
only the current user's memberships. Platform administration additionally requires
an explicit `platform_admins` row; project ownership does not grant it. Widget
identity verification secrets are projected only in owner/admin widget settings, and
every project gets one at creation (migration `0106` backfills older projects).
`PUT /projects/:id/widget-settings` takes the widget settings object itself as the body
(`{theme, settings, text}`); the dashboard sends only the overrides a person edited and the
widget merges them over its own defaults (`src/modules/widget/js/context/defaults.js`).

Project settings, availability, per-audience default AI selection, AI profiles,
macros, plugins/order, contact details/blocking (a dashboard-created contact needs
a name, email or external ID), memberships/invitations, primary
project preference, profile and administration use typed field allowlists. The
retained dashboard reads original bucket IDs, messages and private notes from
canonical storage and maps original status/assignment/cursor contracts. Widget
collector actions use the customer-context module; selected insight pairs use
conversation admission; generation and operator suggestions use AI support.

Every workspace created by first-owner setup, `POST /projects` or email-verified registration is provisioned in its
creation batch by `provisioning/` (`workspaceDefaults`): one enabled starter assistant whose model follows the
installed provider key (`provisioning/models.ts`, OpenAI's when none), made the default for visitors and signed-in
users; a `starter_ai` settings marker recording what it was created with, so an untouched starter can be told from an
edited one; and, when the installation holds `INBOUND_EMAIL_TOKEN`, a reply-by-email mailbox named after the
workspace on `INBOUND_EMAIL_DOMAIN`, else `in.<website domain>`, else `localhost.test`, suffixed instead of conflicting
and enabled only when the installation sends mail. The workspace sends from the installation sender (`EMAIL_FROM`)
until its own domain is verified; `proposed_sender` (`support@<website domain>`) records the address it moves to.
Settings merge with `json_insert`, so nothing already present is
replaced; after the batch commits the one-time site read is queued. Demo inboxes are never provisioned. A default
assistant takes a new widget conversation only while its provider key is installed (`GET /projects/:id/ai` reports
which secret it needs, never key material), so without a key visitors stay with the team and no reply fails; an
explicit AI request still fails naming the missing secret. `tests/journeys/first-run.mjs` covers this through public routes.

Availability (`availability.ts`, also used by Settings → Availability) decides from the schedule and the "Accept new
conversations" switch; `live-availability.ts` adds presence-based away for the widget settings door and the away reply
(`away-reply.ts`): while they say open, the team is away when no teammate who may reply is online, unless the visitor
assistant answers (enabled, provider key installed). Presence lives in `operator_presence` (migration 240), written only
by the workspace's operator stream (`conversations/socket.ts` with `collaboration/presence.ts` and `presence-store.ts`):
the dashboard reports its idle time every 20 seconds, a row counts until it expires (90 seconds past the last report, 10
after the last stream closes) and while its member was active within the lead's idle time. Member removal and workspace
deletion clear it; archives never carry it. Leads change it through `PUT /projects/:id/availability`, which records each
change of the setting or idle time in the security log; `GET /projects/:id/presence` lists who is online.
`tests/journeys/widget.mjs` and `tests/journeys/widget-browser.mjs` cover it.

Pending invitations (`invitations.ts`, `invitation-store.ts`) are the unused invite links for one email in one
workspace, listed on `GET /projects/:projectId/agents` with `invitation_id` (the lower-cased email), `expires_at`
and a per-row `canManage` computed from the caller's role (owners: all; admins: invitations that grant the operator
role; operators: none). `POST .../invitations/:invitationId/link` issues another link (links are stored as hashes and
cannot be shown again), `POST .../resend` emails a fresh link and fails closed with 503 when no email provider is
configured, and `DELETE .../invitations/:invitationId` removes every unused link. Each re-reads the caller's membership of
the path's workspace and refuses what they may not manage. Using one link retires the others issued for the same email
(`identity/accounts.ts`). `tests/journeys/identity.mjs` covers the routes and role refusals on real local D1.

Inbox search (`inbox-search.ts`) matches a contact's name or email address as a literal,
ASCII case-insensitive substring: `%`, `_` and `\` are ordinary characters and the match
does not use `LIKE`, so the database's pattern-length limit cannot turn a long term into
a 500. A term longer than 200 characters is a 400 whose message the inbox shows. Message
text is deliberately not searched: the schema has no full-text index, and an unindexed scan
of every message per keystroke is not acceptable, so the inbox says it searches names and
email addresses. `tests/journeys/inbox.mjs` runs it on local D1.

Owners and admins can permanently erase a contact's personal data
(`contact-erasure.ts`, `contact-erasure/`): R2 objects are staged in
`contact_erasure_objects` and deleted first, then one D1 batch removes or redacts
the contact's identity, sessions, message content, attachments, customer context,
notes, AI assist options and output, imported bucket summaries, delegated-work
output, delivery addresses and legacy archive copies,
and records a non-identifying `contact_erasures` audit row. Message identity,
revision and frontier are kept (`messages.erased_at`); a client-supplied
`local_id` becomes `erased:<message id>`, a prefix admission reserves, while the
server-minted `email:<hash>` and `generation:<id>` ids later reads depend on stay
(a caller-chosen generation id must be a UUID, `ai-support/generation-id.ts`). Repeating an erasure is safe
and completes an interrupted one. `tests/journeys/erasure.mjs` proves it on real
local D1/R2; docs/PRIVACY.md describes the operator-facing behaviour.
The same batch redacts `inbound_emails.evidence_json` (migration 0104) to the
classifier's `reasons` (`contact-erasure/inbound-evidence.ts`). Request counters
(`abuse_counters`) are not erased: they hold only counts under SHA-256 keys and
expire within a day.

Migrations 0070/0071 own management records; 0103 owns contact erasure. Related core and AI migrations remain
necessary: management is an integrated capability, not a replacement database.
`tests/journeys/inbox.mjs` uses real local D1/R2, covering tenant and admin boundaries,
secret projection, original inbox filters/bucket history, notes/participants,
contact collection, missing provider configuration and email ingress identity.
Browser behavior is verified by the dashboard/widget integration lane separately.
