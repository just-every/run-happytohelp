# Customer portal

The customer portal lets a customer sign in by email, send a request and follow
its conversation with your team. Share `/portal/:project` for your workspace.
Customers see their own requests. An operator can explicitly grant a company
access to its members’ requests; this starts off. Sharing an email domain alone
does not grant access to anyone else's tickets.

## Sign in

Enter your email address and request a sign-in link. Open the email within
15 minutes. Each link works once and opens a customer session for that workspace.
If a link has expired, was already used, or you lost the email, request another
one with the same address to recover your requests. An operator changing the
contact record’s email does not remove access from your proven sign-in address
or give that history to the edited address. Preferences shows the address you
proved when signing in. Use **Sign out** when finished on a shared device.

This customer sign-in is separate from teammate accounts. It does not change
native passwords, passkeys, authenticator apps or team two-factor requirements.
An imported address or an address typed into a widget alone does not prove
ownership of earlier conversations. The portal links eligible verified history;
it does not expose unproven history just because an email address matches.

Portal verification, authenticated inbound mail and a widget signature naming
the same mailbox share one requester. If an older installation split those
proven identities, the customer’s next sign-in joins their requests, replies
and survey ownership. Unauthenticated mail and typed widget addresses stay separate.

Outbound email and the installation's public origin must be configured for
sign-in links. Local development suppresses customer email; it does not establish
that a deployed mail provider can deliver links.

## Send and follow requests

Open **New request** at `/portal/:project/requests/new`, choose a published
[request form](request-forms.md), and complete its subject, message and questions.
Your identity comes from your verified customer session. You do not need a
Turnstile bot check while signed in, even if anonymous requests are unavailable
because Turnstile is not configured.

The request list shows **Open** and **Solved**. Internal waiting states and
custom team status labels are not exposed. Open a request to read the customer
conversation, download its attachments, or send a reply. Attach a file to a reply
where needed. A reply can reopen a solved request; **Reopen request** also
reopens a request the team has solved. A closed request cannot be reopened: send
a new request instead. If the request changed while you were reading it, reload
before replying or reopening.

Requests and attachments are checked against your current customer identity and
workspace. A missing, deleted or inaccessible request does not become visible
through a direct link. Signing in to another workspace does not grant access to
this one's requests.

## Preferences and feedback

Open **Preferences** to choose your preferred request-form language (English,
Spanish or French) and whether to receive
replies to your requests by email or support surveys. Turn off **Receive replies
to your requests by email** to stop reply notification emails for your customer
identity in that workspace. You can still read replies in the portal. Turning
it back on allows future reply notifications.

Survey preferences are separate from reply notifications. Turning off **Receive
support surveys** cancels pending invitations, invalidates available survey
links and stops future invitations for your customer identity in that workspace.
Turning surveys back on applies to future support experiences; it does not
restore old links.

When an eligible solved request has an available survey, its feedback link opens
the same signed survey as the email invitation. It does not create another
survey or another response. Links share the single-use, expiry, opt-out and
resolution-cycle rules described in [Customer satisfaction surveys](customer-satisfaction.md).
Reopening a request invalidates the earlier cycle's invitation. A survey link
is shown only while it is available; signing in does not bypass its rules.

## API reference

All routes are scoped to `/api/portal/:projectId`:

| Method and path | Purpose |
| --- | --- |
| `POST /access/request` | Request a sign-in email with `email` and an optional local `returnTo` path |
| `GET /access/verify?token=…` | Consume the email link and establish the customer session |
| `POST /access/logout` | End the customer session |
| `GET /tickets` | List own requests and explicitly entitled company requests |
| `POST /tickets` | Create a request with `formId` and the forms submission fields |
| `GET /tickets/:ticketId` | Read a request and its customer conversation |
| `POST /tickets/:ticketId/reply` | Send a reply |
| `POST /tickets/:ticketId/reopen` | Reopen a solved request |
| `POST /tickets/:ticketId/attachments` | Upload a reply attachment |
| `GET /tickets/:ticketId/attachments/:mediaId` | Download an attachment on that request |
| `GET /preferences` | Read notification preferences |
| `POST` or `PUT /preferences` | Change notification preferences |

Ticket operations require the portal cookie. Mutations require a matching Origin or Referer and enforce the
current identity; they cannot use a teammate session as customer proof. Creation
uses the [forms submission fields](request-forms.md#api-reference) and the
verified portal session; `turnstileToken` is not required. Preferences contain
`locale` (`en`, `es` or `fr`) and the boolean `surveyEmails` and `updateEmails`.
`updateEmails` controls reply notification emails; `surveyEmails` controls survey
invitations independently. Replies use a
unique `localId`, `content`, `expectedRevision` and optional `mediaIds`; reopening
also requires `expectedRevision`. Reload after a conflict instead of replaying a
stale change.

## Company requests

Your support team may give your company access to shared requests. When it does, the request list names your company and includes requests from its current members. You can read and reply to those requests. Your replies keep your identity as their author. Without that entitlement, you see only your own requests. Requests outside your company remain private.

The support team manages membership and access in [Companies](companies-and-csv.md). Removing membership or access takes effect immediately.
