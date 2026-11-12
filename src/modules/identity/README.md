# Identity

Hono routes for `/api/identity`: first-owner setup, login and sessions, invitation acceptance, password recovery,
self-service registration and widget sessions. Passwords are PBKDF2 hashes of 12 to 1024 characters
(`credentials.ts`); sessions, reset tokens, invitation tokens and verification tokens are stored only as SHA-256 hashes.

Local development uses a native rer dev v2 wrapper: open the private `RER_OPEN`
address after `RER_READY` to enter as the real owner through the checkout's key
gate. It retains native passwords, sessions, roles and prior owner data. The
wrapper is excluded from production output. Preview uses native password sign-in.
Local visitor and teammate email is validated and suppressed with no message store,
viewer or external sending; the signed-out UI offers no local email request flow.

Public helpers for the signed-out pages:

- `GET /auth-options` (`options.ts`) returns `{setupRequired, registrationAvailable, recoveryAvailable}`. Registration
  needs `REGISTRATION_ENABLED=true`, an email provider and `APP_ORIGIN`, and stays closed until the first owner exists;
  recovery needs the provider and `APP_ORIGIN` (`availability.ts`, also the guard on `POST /register` and
  `POST /forgot-password`, which answer 503 when unavailable).
- `POST /link-status` (`link-status.ts`) takes `{kind: 'invitation' | 'reset' | 'verify-email', token}` and answers
  `missing`, `invalid`, `expired`, `used` or `valid` (with the workspace and email, and for invitations whether the
  invitee already has an account and which account is signed in). It consumes nothing and counts against no limit.

First-run setup (`setup.ts`) is one screen: email, password, the setup token only when the server needs one, and the website.
`POST /bootstrap` derives what is missing (`workspace-defaults.ts`: the workspace name from the public website or the company
email domain, the owner name from the email, a default colour), keeps explicit values as given, writes the `derived` marker
into the project settings, adds the workspace defaults from `management/provisioning` to the same batch, and then sends the
owner one welcome email (`welcome-email.ts`) through the durable send path under `welcome:<projectId>`. An uncertain send is
never repeated. The response says what happened to it (`welcomeEmail`: `suppressed`, `sent`, `not_configured`,
`failed` or `uncertain`). Local development returns `suppressed` without storing the email or sending externally.
Tests: `tests/journeys/identity.mjs` and `tests/journeys/first-run-browser.mjs`.

Accepting one invitation link retires the other links issued for the same email in that workspace. Pending
invitation management (copy link, resend, revoke) lives in the management module.
Tests: `tests/journeys/identity.mjs`.

`GET /widget/profile` hydrates the widget's saved contact into React memory on
reload. It accepts an explicit live visitor Bearer capability and returns only
the owning contact's id, name, email, and existing verification status with
`Cache-Control: no-store`. The SQL that reads these fields also checks current
session ownership, project membership, expiration, revocation, workspace deletion,
and contact deletion/erasure fences. It performs no writes and returns no metadata.
The entry guard rejects cookie-only and native `int_` credentials before CORS can
query D1. The widget never adds the returned profile to local storage. Tests live
in `tests/journeys/first-run.mjs` and `tests/journeys/first-run-browser.mjs`.

The collector stores visitor-entered name/email as `provided_name` and
`provided_email` metadata for operator context and erasure. For unsigned contacts
these also update the displayed canonical fields. A typed email marks the contact
`email_unproven`: it is a notification destination, never inbound mail authority
(only a signed identifier that is the address proves it). Existing verified identities
keep their canonical name/email, external identifier and verification state;
collector input cannot promote or demote verification. The guarded write returns
the current canonical fields and verification state atomically, including when
verification changes after admission. Session, workspace, conversation ownership
and privacy fences are checked again at the write. Owner/API contact editing
remains a separate authorized path. `verified` describes the existing signed
contact identity, not a separate attestation of a visitor-provided email address.
Later signed business-metadata refreshes retain existing collected aliases,
including explicit nulls, and recheck current contact privacy fences. The other
signed metadata fields keep their existing replacement semantics.
`tests/journeys/first-run.mjs` covers actual HMAC admission through collector
writes and repeated sessions, profile readback, unsigned controls, owner edits,
erasure and write races.

## Two-factor sign-in (`two-factor/`)

Native accounts add TOTP authenticator apps (`totp.ts`, RFC 6238; the key is sealed
with `INTEGRATION_ENCRYPTION_KEY`) and WebAuthn passkeys or security keys
(`webauthn.ts`, attestation "none", ES256/RS256, sign-count checked), with ten
single-use recovery codes stored as hashes (`recovery-codes.ts`). A password or
email-link sign-in creates the session; `session_factors` records what it has
proven. `src/platform/auth.ts` lets a session that still owes its factor
(`verify`), or that a workspace policy requires to enrol (`enrol`), reach only the
two-factor doors. `factors.ts` refuses wrong, replayed (one use per time step) and
spent answers, limits them to five per fifteen minutes and audits each refusal;
`password-proof.ts` holds a re-entered password (step-up, password change) to the
same claimed count. Invitations are issued only by the management door.

`step-up.ts` guards exports, erasure, role changes (including admin and owner
invitations and their re-issued links), credential installs (every factor, a
teammate's reset link, the sign-in email), workspace deletion and the policy: the second factor within 15 minutes, or the password for
an account without one; the local `rer dev` entry is installation custody.
`policy-routes.ts` holds Settings → Security (policy by role, ending unproven
sessions) and the owner's reset of a teammate (own recent factor, email, audit).
`owner-recovery.ts` mounts `recovery-authority/` under the existing identity
module. Its first-owner predicate uses `owner_setup.singleton=1` and its exact
principal, reconciles original Business/import/setup workspace bindings, and
refuses sentinel or ambiguous anchors. Managed challenges and custody use the
P2/P7 canonical, bounded HS256 protocol and the actual per-installation runtime
key. Custody revocation raises a durable generation watermark; authorize and
completion recheck it. The manual password/key variant has the same strict
principal and replacement-factor requirement, retaining spent-key history.

Shared-account recovery accepts a fresh native primary proof, then current
factor-backed owner consent from every target membership workspace. Native
membership and credential epochs invalidate stale requests and approvals.
Passkey registration stages only public material; a fresh UV assertion from that
new private key is required before admission. Completion checks every predicate in the same D1 batch as its unique consume,
credential replacement, session/link revocation and audit. The recovery
capability has no native session authority. All new live capability tables are
excluded from portability; custody acknowledgement is cleared on restore while
the watermark and manual-key replay fences remain.

Tests: `tests/journeys/identity.mjs`, `tests/journeys/identity-browser.mjs` and the
populated recovery flow in `tests/journeys/restore.mjs`. Deployment declarations
and installed platform qualification are separate integration work.
