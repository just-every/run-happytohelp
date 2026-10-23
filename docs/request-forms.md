# Customer request forms

Request forms collect the details your team needs alongside a customer's subject
and message. Publish several forms, such as Order problem, Refund and Technical,
using the same custom ticket fields your team uses in the inbox.

## Build and publish a form

1. Define the custom fields in **Settings → Tickets**. Supported types are text,
   whole number, decimal, date, dropdown, multi-select, checkbox and
   pattern-validated text. Choose bounds, choices and validation there.
2. Open **Settings → Request forms** and choose **New request form**. Enter the
   **Form name**, **Description**, **Default language code** and **Submit button
   label**.
3. Under **Fields & conditions**, add ticket fields in the order customers should
   complete them. Subject and Message are always required. Choose **Require** for
   any additional field the customer must complete. A field required by its ticket
   definition remains required on the form.
4. To ask a follow-up question only for certain answers, select **Show only when a
   condition matches**. Choose an earlier field and a comparison: **Equals**,
   **Does not equal**, **Includes** for a multi-select, or **Has a value**. For
   example, show a required Order number only when Request type equals Order
   problem. A required conditional field is required only while it is shown.
5. Under **Languages**, edit the customer labels, help text and choice labels.
   Choose **Add language** to add translations of those labels, the form name,
   description and submit button. Empty translations use the default wording;
   translating a choice label preserves its stored value.
6. Select **Publish this form**, then **Create form** or **Save changes**. Leave
   it unpublished to keep a draft. Deleting a form removes it from customer use;
   requests already submitted remain in the inbox.

Only owners and admins manage forms. A public form can use only fields available
to every role; fields with restricted read or write roles cannot be added. If a
field becomes restricted later, its form is no longer offered publicly.

## Send a request

Customers open `/help/:project/requests`, choose a published form and language,
and complete its questions. Signed-in customers can also start at
`/portal/:project/requests/new`. The widget's request-form link opens the same
customer flow. See [Customer portal](customer-portal.md) for sign-in and replies.

Visitors first verify their email through the portal sign-in link. A bot check is
required for anonymous submissions. A verified customer session lets a signed-in
customer submit without Turnstile, even when the installation has no Turnstile
keys. Anonymous submissions need both `FORMS_TURNSTILE_SITE_KEY` and the private
`FORMS_TURNSTILE_SECRET_KEY`, as well as working outbound email. Without either
Turnstile key, or when verification cannot be completed, anonymous requests are
refused; there is no bypass. Request and message rate limits also apply.

The server validates the selected form, field types, required answers, bounds,
patterns and conditions. A refused submission identifies the failing field.
Sending an unknown field or an answer to a hidden conditional question is also
refused. Accepted custom answers are stored as typed ticket values for the
inbox and the existing ticket-field filters and rules. Changing a form does not
rewrite values on earlier requests.

## Route requests and apply service commitments

Workflow conditions can match `form_id` and `field:<ticket-field-id>` together,
so two forms with the same answer can route to different teams. The form ID is
read from the admitted submission, rather than supplied as a ticket attribute.

The SLA policy API at `/api/dashboard/projects/:projectId/sla-policies` accepts
`conditions.form_ids` (any listed form) and `conditions.fields` (all listed typed
answers). For example, `fields: {"priority-field-id": "urgent"}` matches that
exact stored answer. Numbers and booleans retain their types; multi-select lists
match their complete stored list in order. Empty conditions match any value.
References must belong to the workspace, field values must pass the field's
validation, and restricted fields cannot be used. If a field becomes restricted,
its values no longer select that SLA. Existing policies without these conditions
keep their behavior. The settings screen displays these conditions and preserves
them when editing a policy; configure these two conditions through the API.

## API reference

Public form definitions are available through `GET /api/forms/:projectId` and
`GET /api/forms/:projectId/:formId`. Use `?locale=es`, for example, to request an
available translation. Responses include the localized labels, stable field and
choice values, required flags, conditions, validation and available locales.

Submit with `POST /api/forms/:projectId/:formId/submissions`. The request has
`subject`, `message`, `fields` keyed by ticket-field ID, and a unique `localId`.
Anonymous requests supply `turnstileToken` from the bot check, but a successful
bot check alone does not create a request: the customer must still verify their
email. Signed-in submissions use the portal cookie established by email
verification and do not require `turnstileToken`. Without that verified session,
the API returns `email_verification_required` after a successful bot check; it
does not accept an email address as proof.
The customer's identity comes from the portal session, rather than a contact ID
supplied in the body.

Workspace management uses `/api/forms/projects/:projectId/forms`: `GET` lists
forms and eligible ticket fields, `POST` creates a form, and `PUT`, `PATCH` or `DELETE`
on `/:formId` changes or deletes it. Updates include the last read `updatedAt`;
a stale form or changed field definition is refused. These routes require the native workspace
session and current permissions. A form definition contains `title`,
`description`, `submitLabel`, `locale`, `enabled`, `fields` and `translations`.
Each field references `fieldId` and `required`, with an optional `condition`
containing `fieldId`, `operator` and, except for `present`, `value`. Translations
are keyed by locale; their `fields` entries are keyed by field ID, including
`subject` and `message`, and contain `label`, `description` and choice `options`.

Order/account lookup fields and a form version-history management screen are not
available. Form fields reuse the current ticket-field permissions and validation; they do not introduce a separate field
catalogue or grant access to company requests.
