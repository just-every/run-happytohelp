# Customer satisfaction surveys

HappyToHelp can ask a customer to rate a resolved conversation by email or its
permitted messaging channel. Each
invitation is tied to that conversation's current resolution and can be answered
without opening the chat widget. An eligible signed-in customer can also open
the available survey from their solved request in the [customer portal](customer-portal.md).
The portal uses the same signed link as email, with the same single-use, expiry,
opt-out and resolution-cycle rules; it does not create a second invitation.
Messaging surveys follow the consent, reply-window and registration rules below.

## Set up surveys

Open **Project settings → Surveys**. Turn
on **Send surveys after resolution**, then choose a **Rating scale**
(**Thumbs up / down** or **1–5 rating**), **Send delay (minutes)**, **Link
lifetime (days)** and **Survey language**. Changes save automatically. Each signed link is single-use
and expires after the chosen lifetime. After a customer submits a response, **Change your feedback** opens a
fresh single-use link; the original link can no longer be used. Changes apply
to new resolution cycles. Turning surveys off cancels invitations that have not
yet been sent.

Customers can opt out from a survey email or turn off **Receive support surveys**
in the portal’s **Preferences**. Portal opt-out cancels pending invitations,
invalidates available survey links and stops future invitations for that
customer in the workspace. Turning surveys back on applies to future support
experiences; it does not restore old links. The separate preference for reply
notification emails does not control survey invitations. If a conversation is
reopened, its old invitation link is no longer valid. Any earlier response remains in the
history for that resolution cycle; a later resolution has its own survey and
history.

Email invitations require an eligible customer with a verified address. Messaging
invitations require the native provider thread described below. Imported
conversations, conversations without a proven human customer message and
machine-generated email are not surveyed. HappyToHelp does not automatically
retry an invitation whose delivery is uncertain. In local development, email
is suppressed.

## Read and follow up on responses

The results show **Rated cycles**, **Positive**, **Low scores**, **Invitations**
and **Opted out**. Use **Show low scores only** to find responses that may need
follow-up, or export **Survey results CSV**. Each response can include a reason
(**Speed**, **Clarity**, **Outcome** or **Other**) and an optional comment. A
survey response does not close a complaint or change a conversation's status.
The report includes previous and reopened resolution cycles; unanswered
invitations are excluded from the satisfaction rate.
Use **Revoke survey link** to invalidate an invitation, and **Load more results**
to continue through the list.

The chat widget's existing thumbs-up/thumbs-down rating remains available for
the customer who opened that conversation. Widget ratings are retained with
their resolution cycle and can be updated in the widget. They do not require an
email invitation. Imported ratings remain historical records and do not create
survey invitations.

Survey settings and reports belong to each workspace. The survey email uses the
workspace's configured sending setup and the selected survey language; configure
outbound email for email invitations. Messaging invitations use their connected
provider and do not require configured outbound mail.

## Messaging surveys

SMS, WhatsApp, Instagram and Messenger use the same survey settings and the
conversation's original channel. A signed provider event must have created a
native support thread; imports never supply survey authority. No phone number
or page-scoped customer ID is retained on the survey invitation row.

Dispatch rechecks the live connection, customer opt-out and erasure fences,
SMS sender registration, and the 24-hour WhatsApp/Instagram/Messenger reply
window. A refused invitation is suppressed permanently; its reason is available
in the support-channel conversation's delivery receipts. It never switches to
email or another channel. SMS/WhatsApp STOP fences replies and existing survey
links; START restores only that number and channel for future cycles, and HELP
grants no survey consent. Survey opt-out links stop future satisfaction surveys
for that customer throughout the workspace.

Each invitation is durably claimed before contacting the provider. Repeated
scheduler runs and redelivered webhooks cannot send a second invitation. Failed
and uncertain requests are never replayed automatically. Customers answer and
change their feedback through the signed web link without a session. Surveys
are never sent as WhatsApp templates, and in-channel digit replies do not record
a rating. Results retain the invitation provider and exact cycle; erasure clears
comments from current results, prior history and CSV exports.

Signed provider fixtures prove these rules locally. Live Twilio/Meta delivery,
consent and A2P/template-registration receipts, and live mail delivery remain
UNMET-EXTERNAL; fixture success does not qualify connected accounts.
