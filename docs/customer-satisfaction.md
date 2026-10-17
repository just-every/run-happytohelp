# Customer satisfaction surveys

HappyToHelp can ask a customer to rate a resolved conversation by email. Each
invitation is tied to that conversation's current resolution and can be answered
without opening the chat widget. An eligible signed-in customer can also open
the available survey from their solved request in the [customer portal](customer-portal.md).
The portal uses the same signed link as email, with the same single-use, expiry,
opt-out and resolution-cycle rules; it does not create a second invitation.
Surveys in other messaging channels are not available yet.

## Set up email surveys

Open **Reports → Satisfaction surveys** and expand **Survey settings**. Turn
on **Send email surveys after resolution**, then choose a **Rating scale**
(**Thumbs up / down** or **1–5 rating**), **Send delay (minutes)**, **Link
lifetime (days)** and **Survey language**. Choose **Save survey settings** to
apply the changes. Each signed link is single-use and expires after the chosen
lifetime. After a customer submits a response, **Change your feedback** opens a
fresh single-use link; the original link can no longer be used. Changes apply
to new resolution cycles. Turning surveys off cancels invitations that have not
yet been sent.

Customers can opt out from a survey email. An opt-out applies to later survey
invitations for that customer in the workspace. If a conversation is reopened,
its old invitation link is no longer valid. Any earlier response remains in the
history for that resolution cycle; a later resolution has its own survey and
history.

Only an eligible customer with a verified address receives a survey. Imported
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
workspace's configured sending setup and the selected survey language; make sure
outbound email is configured before enabling invitations.
